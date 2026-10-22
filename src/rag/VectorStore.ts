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
// Bound both synchronous serialization work and adapter writes. A fragment is
// one chunk, never a whole note/index; UTF-16 pairs stay together across writes.
const SAVE_BATCH_CHARS = 256 * 1024;

export class VectorStore {
	private adapter: DataAdapter;
	private path: string;
	private notes: Map<string, IndexedNote> = new Map();
	private embedderModel = "";
	private embeddingDim = 0;
	private loaded = false;
	// All writers share the same temporary and backup paths. Requests arriving
	// during a write share the next snapshot instead of queuing full rewrites.
	private saving = false;
	private pendingSaves: Array<{ resolve: () => void; reject: (reason: unknown) => void }> = [];
	// Per-chunk L2 norms, memoized lazily and keyed by the chunk object so
	// entries GC away when a note is re-chunked (upsert/load build fresh
	// IndexedChunk objects). Never serialized — index.json is unaffected.
	// Saves recomputing √(Σ eᵢ²) for every chunk on every query.
	private normCache: WeakMap<IndexedChunk, number> = new WeakMap();

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
		await this.restoreBackupIfMissing();
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

	save(): Promise<void> {
		const saved = new Promise<void>((resolve, reject) => {
			this.pendingSaves.push({ resolve, reject });
		});
		if (!this.saving) {
			this.saving = true;
			void this.drainSaves();
		}
		return saved;
	}

	private async drainSaves(): Promise<void> {
		try {
			while (this.pendingSaves.length > 0) {
				const requests = this.pendingSaves;
				this.pendingSaves = [];
				try {
					await this.saveNow();
					for (const request of requests) request.resolve();
				} catch (err) {
					for (const request of requests) request.reject(err);
				}
			}
		} finally {
			this.saving = false;
		}
	}

	private async restoreBackupIfMissing(): Promise<void> {
		const backup = `${this.path}.bak`;
		if (!(await this.adapter.exists(this.path)) && (await this.adapter.exists(backup))) {
			await this.adapter.rename(backup, this.path);
		}
	}

	private async saveNow(): Promise<void> {
		// Capture before the first await. Upsert/load replace note objects;
		// remove/rename/clear change the Map, so this shallow snapshot stays
		// consistent while later edits queue another save.
		const notes = Array.from(this.notes);
		const model = this.embedderModel;
		const dim = this.embeddingDim;
		await this.restoreBackupIfMissing();
		const tmp = `${this.path}.tmp`;
		const backup = `${this.path}.bak`;
		// Crash-recoverable atomic write: write tmp, move existing aside to
		// .bak, rename tmp into place, then drop .bak. If the rename-into-
		// place fails the catch puts .bak back so we never have a window
		// where neither the live file nor the backup exists. The previous
		// remove-then-rename sequence had exactly that gap and would lose
		// the entire index on a mid-write crash, forcing a full re-embed
		// of the vault on next launch.
		await this.writeTemporary(tmp, serializeSnapshot(model, dim, notes));
		const hadOld = await this.adapter.exists(this.path);
		if (hadOld) {
			// A crash after tmp became the live file can leave the previous
			// backup behind. Remove it only while a live copy still exists.
			if (await this.adapter.exists(backup)) await this.adapter.remove(backup);
			await this.adapter.rename(this.path, backup);
		}
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

	private async writeTemporary(path: string, fragments: Iterable<string>): Promise<void> {
		let buffer = "";
		let first = true;
		const flush = async () => {
			if (first) {
				await this.adapter.write(path, buffer);
				first = false;
			} else {
				await this.adapter.append(path, buffer);
			}
			buffer = "";
		};
		for (const fragment of fragments) {
			let start = 0;
			while (start < fragment.length) {
				let end = Math.min(start + SAVE_BATCH_CHARS - buffer.length, fragment.length);
				// Each append is UTF-8 encoded separately by the adapter. Never
				// split a surrogate pair into two replacement characters.
				if (end < fragment.length && end > start) {
					const last = fragment.charCodeAt(end - 1);
					const next = fragment.charCodeAt(end);
					if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end--;
				}
				if (end === start) {
					await flush();
					await yieldToEventLoop();
					continue;
				}
				buffer += fragment.slice(start, end);
				start = end;
				if (buffer.length === SAVE_BATCH_CHARS) {
					await flush();
					await yieldToEventLoop();
				}
			}
		}
		if (buffer.length > 0) await flush();
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
				const cn = this.chunkNorm(chunk);
				if (cn === 0) continue;
				const score = dot(queryVec, chunk.embedding) / (qn * cn);
				hits.push({ notePath, chunk, score });
			}
		}
		hits.sort((a, b) => b.score - a.score);
		return hits.slice(0, k);
	}

	private chunkNorm(chunk: IndexedChunk): number {
		const hit = this.normCache.get(chunk);
		if (hit !== undefined) return hit;
		const n = norm(chunk.embedding);
		this.normCache.set(chunk, n);
		return n;
	}
}

function* serializeSnapshot(
	model: string,
	dim: number,
	notes: Array<[string, IndexedNote]>,
): Generator<string> {
	const header = JSON.stringify({
		schemaVersion: CURRENT_INDEX_SCHEMA,
		embedderModel: model,
		embeddingDim: dim,
	});
	yield `${header.slice(0, -1)},"notes":{`;
	let firstNote = true;
	for (const [path, note] of notes) {
		yield `${firstNote ? "" : ","}${JSON.stringify(path)}:{"mtime":${JSON.stringify(note.mtime)},"chunks":[`;
		firstNote = false;
		let firstChunk = true;
		for (const chunk of note.chunks) {
			yield `${firstChunk ? "" : ","}${JSON.stringify(chunk)}`;
			firstChunk = false;
		}
		yield "]}";
	}
	yield "}}";
}

function yieldToEventLoop(): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, 0));
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

// The `?? 0` fallbacks never fire — callers pre-check equal lengths and loops
// stay in-bounds — they only satisfy noUncheckedIndexedAccess.
function dot(a: number[], b: number[]): number {
	let s = 0;
	for (let i = 0; i < a.length; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
	return s;
}

function norm(a: number[]): number {
	let s = 0;
	for (let i = 0; i < a.length; i++) {
		const x = a[i] ?? 0;
		s += x * x;
	}
	return Math.sqrt(s);
}
