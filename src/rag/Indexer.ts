import { App, Notice, TFile } from "obsidian";
import { OllamaClient } from "../ollama/OllamaClient";
import { OllamaChatSettings } from "../settings/Settings";
import { chunkMarkdown } from "./Chunker";
import { IndexedChunk, VectorStore } from "./VectorStore";

export type IndexPhase = "idle" | "scanning" | "embedding" | "saving";

export interface IndexProgress {
	phase: IndexPhase;
	indexed: number;
	total: number;
	currentPath?: string;
	error?: string;
}

type ProgressListener = (p: IndexProgress) => void;

const EMBED_BATCH = 20;
const SAVE_EVERY_FILES = 50;
const DEBOUNCE_MS = 2000;

export class Indexer {
	private app: App;
	private ollama: OllamaClient;
	private settings: OllamaChatSettings;
	private store: VectorStore;

	private running = false;
	private cancelled = false;
	private listeners: Set<ProgressListener> = new Set();
	private progress: IndexProgress = { phase: "idle", indexed: 0, total: 0 };

	private debounceTimers: Map<string, number> = new Map();

	constructor(
		app: App,
		ollama: OllamaClient,
		settings: OllamaChatSettings,
		store: VectorStore,
	) {
		this.app = app;
		this.ollama = ollama;
		this.settings = settings;
		this.store = store;
	}

	updateSettings(settings: OllamaChatSettings): void {
		this.settings = settings;
	}

	isRunning(): boolean {
		return this.running;
	}

	getProgress(): IndexProgress {
		return this.progress;
	}

	onProgress(cb: ProgressListener): () => void {
		this.listeners.add(cb);
		return () => this.listeners.delete(cb);
	}

	cancel(): void {
		this.cancelled = true;
	}

	async start(): Promise<void> {
		if (this.running) return;
		if (!this.settings.embedderModel) {
			this.emit({ phase: "idle", indexed: 0, total: 0, error: "No embedder model configured" });
			return;
		}
		this.running = true;
		this.cancelled = false;
		try {
			await this.ensureCompatible();
			await this.syncIncremental();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.warn("[ollama-notes-chat] indexer error", err);
			this.emit({ ...this.progress, phase: "idle", error: msg });
		} finally {
			this.running = false;
			this.cancelled = false;
			this.emit({ ...this.progress, phase: "idle" });
		}
	}

	async reindexAll(): Promise<void> {
		if (this.running) {
			this.cancel();
			while (this.running) await sleep(50);
		}
		this.store.clear();
		this.store.setEmbedderModel(this.settings.embedderModel, 0);
		await this.store.save();
		await this.start();
	}

	async indexFile(file: TFile): Promise<void> {
		if (file.extension !== "md") return;
		if (!this.settings.embedderModel) return;
		await this.embedAndStore(file);
	}

	removeFile(path: string): void {
		if (this.store.remove(path)) {
			void this.store.save();
		}
	}

	renameFile(oldPath: string, newPath: string): void {
		this.store.rename(oldPath, newPath);
		void this.store.save();
	}

	scheduleFileUpdate(file: TFile): void {
		if (file.extension !== "md") return;
		if (!this.settings.ragAutoIndex) return;
		if (!this.settings.embedderModel) return;
		const existing = this.debounceTimers.get(file.path);
		if (existing !== undefined) window.clearTimeout(existing);
		const handle = window.setTimeout(() => {
			this.debounceTimers.delete(file.path);
			void this.indexFile(file).catch((err) => {
				console.warn("[ollama-notes-chat] incremental index failed", file.path, err);
			});
		}, DEBOUNCE_MS);
		this.debounceTimers.set(file.path, handle);
	}

	cancelDebounced(): void {
		for (const h of this.debounceTimers.values()) window.clearTimeout(h);
		this.debounceTimers.clear();
	}

	private async ensureCompatible(): Promise<void> {
		const storedModel = this.store.getEmbedderModel();
		if (storedModel && storedModel !== this.settings.embedderModel) {
			new Notice(
				`Embedder changed (${storedModel} → ${this.settings.embedderModel}). Rebuilding index.`,
				5000,
			);
			this.store.clear();
			this.store.setEmbedderModel(this.settings.embedderModel, 0);
			await this.store.save();
		} else if (!storedModel) {
			this.store.setEmbedderModel(this.settings.embedderModel, 0);
		}
	}

	private async syncIncremental(): Promise<void> {
		this.emit({ phase: "scanning", indexed: 0, total: 0 });
		const files = this.app.vault.getMarkdownFiles();
		const knownPaths = new Set(this.store.knownPaths());
		const currentPaths = new Set(files.map((f) => f.path));

		let removed = false;
		for (const known of knownPaths) {
			if (!currentPaths.has(known)) {
				this.store.remove(known);
				removed = true;
			}
		}

		const toIndex: TFile[] = [];
		for (const file of files) {
			const storedMtime = this.store.getMtime(file.path);
			if (storedMtime === undefined || storedMtime < file.stat.mtime) {
				toIndex.push(file);
			}
		}

		if (toIndex.length === 0 && !removed) {
			this.emit({ phase: "idle", indexed: 0, total: 0 });
			return;
		}

		const total = toIndex.length;
		let indexed = 0;
		this.emit({ phase: "embedding", indexed, total });

		for (let i = 0; i < toIndex.length; i++) {
			if (this.cancelled) break;
			const file = toIndex[i];
			this.emit({ phase: "embedding", indexed, total, currentPath: file.path });
			try {
				await this.embedAndStore(file);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.warn("[ollama-notes-chat] embed failed", file.path, msg);
			}
			indexed++;
			if ((i + 1) % SAVE_EVERY_FILES === 0) {
				this.emit({ phase: "saving", indexed, total });
				await this.store.save();
				this.emit({ phase: "embedding", indexed, total });
			}
			await yieldToEventLoop();
		}

		this.emit({ phase: "saving", indexed, total });
		await this.store.save();
	}

	private async embedAndStore(file: TFile): Promise<void> {
		const raw = await this.app.vault.cachedRead(file);
		const chunks = chunkMarkdown(raw, {
			chunkSize: this.settings.ragChunkSize,
			overlap: this.settings.ragChunkOverlap,
		});
		if (chunks.length === 0) {
			this.store.remove(file.path);
			return;
		}
		const indexed: IndexedChunk[] = [];
		for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
			const batch = chunks.slice(i, i + EMBED_BATCH);
			const embeddings = await this.ollama.embed(
				this.settings.embedderModel,
				batch.map((c) => c.text),
			);
			for (let j = 0; j < batch.length; j++) {
				const embedding = embeddings[j];
				if (!Array.isArray(embedding)) continue;
				indexed.push({
					heading: batch[j].heading,
					text: batch[j].text,
					embedding,
				});
			}
			await yieldToEventLoop();
		}
		if (indexed.length === 0) {
			this.store.remove(file.path);
			return;
		}
		if (this.store.getEmbeddingDim() === 0) {
			this.store.setEmbedderModel(this.settings.embedderModel, indexed[0].embedding.length);
		}
		this.store.upsert(file.path, indexed, file.stat.mtime);
	}

	private emit(p: IndexProgress): void {
		this.progress = p;
		for (const cb of this.listeners) {
			try {
				cb(p);
			} catch {
				// ignore listener errors
			}
		}
	}
}

function yieldToEventLoop(): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}
