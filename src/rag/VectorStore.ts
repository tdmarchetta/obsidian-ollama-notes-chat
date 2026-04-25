import { DataAdapter } from "obsidian";

export interface IndexedChunk {
	heading?: string;
	text: string;
	embedding: number[];
}

export interface IndexedNote {
	mtime: number;
	chunks: IndexedChunk[];
}

export interface VectorStoreFile {
	schemaVersion: number;
	embedderModel: string;
	embeddingDim: number;
	notes: Record<string, IndexedNote>;
}

export interface SearchHit {
	notePath: string;
	chunk: IndexedChunk;
	score: number;
}

export interface VectorStoreStats {
	notes: number;
	chunks: number;
}

const CURRENT_INDEX_SCHEMA = 1;

export class VectorStore {
	private adapter: DataAdapter;
	private path: string;
	private notes: Map<string, IndexedNote> = new Map();
	private embedderModel = "";
	private embeddingDim = 0;
	private loaded = false;

	constructor(adapter: DataAdapter, path: string) {
		this.adapter = adapter;
		this.path = path;
	}

	isLoaded(): boolean {
		return this.loaded;
	}

	getEmbedderModel(): string {
		return this.embedderModel;
	}

	getEmbeddingDim(): number {
		return this.embeddingDim;
	}

	setEmbedderModel(model: string, dim: number): void {
		this.embedderModel = model;
		this.embeddingDim = dim;
	}

	async load(): Promise<void> {
		this.loaded = true;
		if (!(await this.adapter.exists(this.path))) return;
		try {
			const raw = await this.adapter.read(this.path);
			const parsed = JSON.parse(raw) as Partial<VectorStoreFile>;
			if (!parsed || typeof parsed !== "object") return;
			if (parsed.schemaVersion !== CURRENT_INDEX_SCHEMA) return;
			this.embedderModel = typeof parsed.embedderModel === "string" ? parsed.embedderModel : "";
			this.embeddingDim = typeof parsed.embeddingDim === "number" ? parsed.embeddingDim : 0;
			const notes = parsed.notes ?? {};
			// Validate every entry before adoption — a tampered or truncated
			// index.json should be discarded rather than feeding bad floats into
			// cosine math that would silently return garbage hits.
			for (const [path, note] of Object.entries(notes)) {
				if (typeof path !== "string" || path.length === 0) continue;
				// Skip dangerous key names defensively even though Map.set is safe.
				if (path === "__proto__" || path === "constructor" || path === "prototype") continue;
				if (!note || typeof note !== "object" || !Array.isArray(note.chunks)) continue;
				const mtime = typeof note.mtime === "number" && Number.isFinite(note.mtime) ? note.mtime : 0;
				const validChunks: IndexedChunk[] = [];
				for (const chunk of note.chunks) {
					if (!isValidIndexedChunk(chunk)) continue;
					validChunks.push(chunk);
				}
				if (validChunks.length === 0) continue;
				this.notes.set(path, { mtime, chunks: validChunks });
			}
		} catch (err) {
			console.warn("[ollama-notes-chat] vector index load failed, starting empty", err);
			this.notes.clear();
			this.embedderModel = "";
			this.embeddingDim = 0;
		}
	}

	async save(): Promise<void> {
		const data: VectorStoreFile = {
			schemaVersion: CURRENT_INDEX_SCHEMA,
			embedderModel: this.embedderModel,
			embeddingDim: this.embeddingDim,
			notes: Object.fromEntries(this.notes),
		};
		const serialized = JSON.stringify(data);
		const tmp = `${this.path}.tmp`;
		const backup = `${this.path}.bak`;
		// Crash-recoverable atomic write: write tmp, move existing aside to
		// .bak, rename tmp into place, then drop .bak. If the rename-into-
		// place fails the catch puts .bak back so we never have a window
		// where neither the live file nor the backup exists. The previous
		// remove-then-rename sequence had exactly that gap and would lose
		// the entire index on a mid-write crash, forcing a full re-embed
		// of the vault on next launch.
		await this.adapter.write(tmp, serialized);
		const hadOld = await this.adapter.exists(this.path);
		if (hadOld) await this.adapter.rename(this.path, backup);
		try {
			await this.adapter.rename(tmp, this.path);
		} catch (err) {
			if (hadOld) {
				try {
					await this.adapter.rename(backup, this.path);
				} catch {
					// Recovery itself failed — the original write error is
					// the more useful one to surface, so swallow this.
				}
			}
			throw err;
		}
		if (hadOld && (await this.adapter.exists(backup))) {
			await this.adapter.remove(backup);
		}
	}

	upsert(notePath: string, chunks: IndexedChunk[], mtime: number): void {
		this.notes.set(notePath, { mtime, chunks });
	}

	remove(notePath: string): boolean {
		return this.notes.delete(notePath);
	}

	rename(oldPath: string, newPath: string): void {
		const entry = this.notes.get(oldPath);
		if (!entry) return;
		this.notes.delete(oldPath);
		this.notes.set(newPath, entry);
	}

	getMtime(notePath: string): number | undefined {
		return this.notes.get(notePath)?.mtime;
	}

	hasNote(notePath: string): boolean {
		return this.notes.has(notePath);
	}

	clear(): void {
		this.notes.clear();
	}

	knownPaths(): string[] {
		return Array.from(this.notes.keys());
	}

	stats(): VectorStoreStats {
		let chunks = 0;
		for (const n of this.notes.values()) chunks += n.chunks.length;
		return { notes: this.notes.size, chunks };
	}

	topK(queryVec: number[], k: number): SearchHit[] {
		const hits: SearchHit[] = [];
		const qn = norm(queryVec);
		if (qn === 0) return hits;
		for (const [notePath, note] of this.notes) {
			for (const chunk of note.chunks) {
				if (chunk.embedding.length !== queryVec.length) continue;
				const cn = norm(chunk.embedding);
				if (cn === 0) continue;
				const score = dot(queryVec, chunk.embedding) / (qn * cn);
				hits.push({ notePath, chunk, score });
			}
		}
		hits.sort((a, b) => b.score - a.score);
		return hits.slice(0, k);
	}
}

function isValidIndexedChunk(x: unknown): x is IndexedChunk {
	if (!x || typeof x !== "object") return false;
	const c = x as Partial<IndexedChunk>;
	if (typeof c.text !== "string") return false;
	if (c.heading !== undefined && typeof c.heading !== "string") return false;
	if (!Array.isArray(c.embedding) || c.embedding.length === 0) return false;
	for (const n of c.embedding) {
		if (typeof n !== "number" || !Number.isFinite(n)) return false;
	}
	return true;
}

function dot(a: number[], b: number[]): number {
	let s = 0;
	for (let i = 0; i < a.length; i++) s += a[i] * b[i];
	return s;
}

function norm(a: number[]): number {
	let s = 0;
	for (let i = 0; i < a.length; i++) s += a[i] * a[i];
	return Math.sqrt(s);
}
