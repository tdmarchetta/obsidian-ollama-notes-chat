import { App, TFile, type DataAdapter } from "obsidian";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { OllamaClient } from "../ollama/OllamaClient";
import { DEFAULT_SETTINGS, type OllamaChatSettings } from "../settings/Settings";
import { Indexer } from "./Indexer";
import { VectorStore } from "./VectorStore";

// Indexer schedules work via window.setTimeout / window.clearTimeout, which
// don't exist in vitest's node environment — bridge them to node's timers.
vi.stubGlobal("window", {
	setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
	clearTimeout: (h: number) => clearTimeout(h),
});

class FakeAdapter {
	files = new Map<string, string>();
	async read(path: string): Promise<string> {
		const v = this.files.get(path);
		if (v === undefined) throw new Error(`ENOENT: ${path}`);
		return Promise.resolve(v);
	}
	async write(path: string, data: string): Promise<void> {
		this.files.set(path, data);
		return Promise.resolve();
	}
	async exists(path: string): Promise<boolean> {
		return Promise.resolve(this.files.has(path));
	}
	async rename(oldPath: string, newPath: string): Promise<void> {
		const v = this.files.get(oldPath);
		if (v === undefined) throw new Error(`ENOENT: ${oldPath}`);
		if (this.files.has(newPath)) throw new Error(`Destination file already exists: ${newPath}`);
		this.files.set(newPath, v);
		this.files.delete(oldPath);
		return Promise.resolve();
	}
	async remove(path: string): Promise<void> {
		this.files.delete(path);
		return Promise.resolve();
	}
}

function md(path: string, mtime: number): TFile {
	const f = new TFile();
	f.path = path;
	f.name = path.split("/").pop() ?? path;
	f.extension = "md";
	f.stat = { mtime, size: 0, ctime: 0 };
	return f;
}

type EmbedFn = (model: string, texts: string[]) => Promise<number[][]>;

interface Harness {
	adapter: FakeAdapter;
	indexer: Indexer;
	store: VectorStore;
	embed: Mock<EmbedFn>;
	files: TFile[];
	contents: Map<string, string>;
	settings: OllamaChatSettings;
}

function makeHarness(settingsOverride: Partial<OllamaChatSettings> = {}): Harness {
	const files: TFile[] = [];
	const contents = new Map<string, string>();
	const app = {
		vault: {
			getMarkdownFiles: () => files,
			getAbstractFileByPath: (path: string) => files.find((file) => file.path === path) ?? null,
			cachedRead: async (f: TFile) => Promise.resolve(contents.get(f.path) ?? ""),
		},
	} as unknown as App;
	const embed = vi.fn<EmbedFn>(async (_model, texts) =>
		Promise.resolve(texts.map(() => [1, 0, 0])),
	);
	const ollama = { embed } as unknown as OllamaClient;
	const settings: OllamaChatSettings = {
		...DEFAULT_SETTINGS,
		embedderModel: "test-embed",
		...settingsOverride,
	};
	const adapter = new FakeAdapter();
	const store = new VectorStore(adapter as unknown as DataAdapter, "idx/index.json");
	const indexer = new Indexer(app, ollama, settings, store);
	return { adapter, indexer, store, embed, files, contents, settings };
}

function addNote(h: Harness, path: string, body: string, mtime: number): TFile {
	const f = md(path, mtime);
	h.files.push(f);
	h.contents.set(path, body);
	return f;
}

describe("Indexer.start", () => {
	let h: Harness;
	beforeEach(() => {
		h = makeHarness();
	});

	it("emits an error and does nothing without an embedder model", async () => {
		const h2 = makeHarness({ embedderModel: "" });
		addNote(h2, "a.md", "hello", 1);
		const seen: string[] = [];
		h2.indexer.onProgress((p) => {
			if (p.error) seen.push(p.error);
		});
		await h2.indexer.start();
		expect(seen).toContain("No embedder model configured");
		expect(h2.embed).not.toHaveBeenCalled();
	});

	it("indexes new markdown files and records their mtimes", async () => {
		addNote(h, "a.md", "alpha body", 10);
		addNote(h, "b.md", "beta body", 20);
		await h.indexer.start();
		expect(h.store.hasNote("a.md")).toBe(true);
		expect(h.store.hasNote("b.md")).toBe(true);
		expect(h.store.getMtime("a.md")).toBe(10);
		expect(h.store.getMtime("b.md")).toBe(20);
	});

	it("sets the embedding dimension from the first embedded chunk", async () => {
		addNote(h, "a.md", "alpha", 1);
		await h.indexer.start();
		expect(h.store.getEmbeddingDim()).toBe(3);
		expect(h.store.getEmbedderModel()).toBe("test-embed");
	});

	it("re-embeds only files whose mtime advanced", async () => {
		const a = addNote(h, "a.md", "alpha", 10);
		addNote(h, "b.md", "beta", 10);
		await h.indexer.start();
		const callsAfterFirst = h.embed.mock.calls.length;

		a.stat.mtime = 99;
		h.contents.set("a.md", "alpha v2");
		await h.indexer.start();

		const newCalls = h.embed.mock.calls.slice(callsAfterFirst);
		expect(newCalls).toHaveLength(1);
		expect(newCalls[0]![1][0]).toContain("alpha v2");
	});

	it("removes notes that no longer exist in the vault", async () => {
		addNote(h, "a.md", "alpha", 1);
		addNote(h, "b.md", "beta", 1);
		await h.indexer.start();
		h.files.splice(0, 1); // delete a.md from the vault
		await h.indexer.start();
		expect(h.store.hasNote("a.md")).toBe(false);
		expect(h.store.hasNote("b.md")).toBe(true);
	});

	it("drops a note that becomes empty (no chunks)", async () => {
		const a = addNote(h, "a.md", "alpha", 1);
		await h.indexer.start();
		expect(h.store.hasNote("a.md")).toBe(true);
		a.stat.mtime = 2;
		h.contents.set("a.md", "   \n  ");
		await h.indexer.start();
		expect(h.store.hasNote("a.md")).toBe(false);
	});

	it("rebuilds when the stored embedder model differs from settings", async () => {
		h.store.setEmbedderModel("old-model", 3);
		h.store.upsert("ghost.md", [{ text: "g", embedding: [1, 0, 0] }], 1);
		addNote(h, "a.md", "alpha", 1);
		await h.indexer.start();
		expect(h.store.getEmbedderModel()).toBe("test-embed");
		expect(h.store.hasNote("ghost.md")).toBe(false); // cleared by the rebuild
		expect(h.store.hasNote("a.md")).toBe(true);
	});

	it("stops indexing remaining files once cancelled", async () => {
		for (let i = 0; i < 5; i++) addNote(h, `n${i}.md`, `body ${i}`, 1);
		h.embed.mockImplementation(async (_m, texts) => {
			h.indexer.cancel(); // cancel as soon as the first embed lands
			return Promise.resolve(texts.map(() => [1, 0, 0]));
		});
		await h.indexer.start();
		const indexedCount = [0, 1, 2, 3, 4].filter((i) => h.store.hasNote(`n${i}.md`)).length;
		expect(indexedCount).toBe(1); // the in-flight file completes; the rest are skipped
		expect(h.indexer.isRunning()).toBe(false);
	});
});

describe("Indexer file events", () => {
	it("persists debounced note edits so they survive a reload", async () => {
		vi.useFakeTimers();
		try {
			const h = makeHarness();
			const f = addNote(h, "a.md", "updated body", 9);
			h.indexer.scheduleFileUpdate(f);
			await vi.advanceTimersByTimeAsync(4000);
			const loaded = new VectorStore(h.adapter as unknown as DataAdapter, "idx/index.json");
			await loaded.load();
			expect(loaded.getMtime("a.md")).toBe(9);
			expect(loaded.topK([1, 0, 0], 1)[0]?.chunk.text).toBe("updated body");
		} finally {
			vi.useRealTimers();
		}
	});

	it("persists removal when a modified note becomes empty", async () => {
		vi.useFakeTimers();
		try {
			const h = makeHarness();
			h.store.upsert("a.md", [{ text: "old", embedding: [1, 0, 0] }], 1);
			await h.store.save();
			const f = addNote(h, "a.md", "", 9);
			h.indexer.scheduleFileUpdate(f);
			await vi.advanceTimersByTimeAsync(4000);
			const loaded = new VectorStore(h.adapter as unknown as DataAdapter, "idx/index.json");
			await loaded.load();
			expect(loaded.hasNote("a.md")).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});

	it("indexFile ignores non-markdown files", async () => {
		const h = makeHarness();
		const f = md("image.png", 1);
		f.extension = "png";
		await h.indexer.indexFile(f);
		expect(h.embed).not.toHaveBeenCalled();
	});

	it("removeFile drops the note from the store", async () => {
		const h = makeHarness();
		const f = addNote(h, "a.md", "alpha", 1);
		await h.indexer.indexFile(f);
		expect(h.store.hasNote("a.md")).toBe(true);
		h.indexer.removeFile("a.md");
		expect(h.store.hasNote("a.md")).toBe(false);
	});

	it("renameFile carries the entry to the new path", async () => {
		const h = makeHarness();
		const f = addNote(h, "a.md", "alpha", 1);
		await h.indexer.indexFile(f);
		h.indexer.renameFile("a.md", "moved/a.md");
		expect(h.store.hasNote("a.md")).toBe(false);
		expect(h.store.hasNote("moved/a.md")).toBe(true);
	});

	it("scheduleFileUpdate debounces repeated edits into one reindex", async () => {
		vi.useFakeTimers();
		try {
			const h = makeHarness();
			const f = addNote(h, "a.md", "alpha", 1);
			h.indexer.scheduleFileUpdate(f);
			h.indexer.scheduleFileUpdate(f); // second edit resets the timer
			await vi.advanceTimersByTimeAsync(2500);
			expect(h.embed).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("cancelDebounced clears pending timers", async () => {
		vi.useFakeTimers();
		try {
			const h = makeHarness();
			const f = addNote(h, "a.md", "alpha", 1);
			h.indexer.scheduleFileUpdate(f);
			h.indexer.cancelDebounced();
			await vi.advanceTimersByTimeAsync(5000);
			expect(h.embed).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});
});

// Hold the external embedding response while real file events run.
function deferredEmbedding(h: Harness) {
	let release!: (vectors: number[][]) => void;
	let entered!: () => void;
	const started = new Promise<void>((resolve) => { entered = resolve; });
	h.embed.mockImplementationOnce(() => {
		entered();
		return new Promise<number[][]>((resolve) => { release = resolve; });
	});
	return { started, release: () => release([[1, 0, 0]]) };
}

describe("Indexer rename scheduling", () => {
	it("reindexes the new path when rename invalidates an in-flight edit", async () => {
		vi.useFakeTimers();
		const h = makeHarness();
		try {
			h.store.upsert("note.md", [{ text: "old content", embedding: [1, 0, 0] }], 1);
			const file = addNote(h, "note.md", "edited content", 2);
			const pending = deferredEmbedding(h);
			const job = h.indexer.indexFile(file);
			await pending.started;
			h.contents.delete("note.md");
			h.contents.set("renamed.md", "edited content");
			file.path = "renamed.md";
			h.indexer.renameFile("note.md", file.path);
			pending.release();
			await job;
			await vi.advanceTimersByTimeAsync(4000);
			expect(h.store.hasNote("note.md")).toBe(false);
			expect(h.store.getMtime("renamed.md")).toBe(2);
			expect(h.store.topK([1, 0, 0], 1)[0]?.chunk.text).toBe("edited content");
			const loaded = new VectorStore(h.adapter as unknown as DataAdapter, "idx/index.json");
			await loaded.load();
			expect(loaded.hasNote("note.md")).toBe(false);
			expect(loaded.topK([1, 0, 0], 1)[0]?.chunk.text).toBe("edited content");
		} finally {
			h.indexer.cancelDebounced();
			vi.useRealTimers();
		}
	});

	it("cancels the old-path debounce when requeuing a renamed note", async () => {
		vi.useFakeTimers();
		const h = makeHarness();
		try {
			const file = addNote(h, "note.md", "body", 1);
			h.indexer.scheduleFileUpdate(file);
			await vi.advanceTimersByTimeAsync(1000);
			h.contents.delete("note.md");
			h.contents.set("renamed.md", "body");
			file.path = "renamed.md";
			h.indexer.renameFile("note.md", file.path);
			await vi.advanceTimersByTimeAsync(1001);
			expect(h.store.hasNote("renamed.md")).toBe(false);
			await vi.advanceTimersByTimeAsync(2000);
			expect(h.store.hasNote("note.md")).toBe(false);
			expect(h.store.topK([1, 0, 0], 1)[0]?.chunk.text).toBe("body");
		} finally {
			h.indexer.cancelDebounced();
			vi.useRealTimers();
		}
	});

	it("does not start automatic embedding on rename when auto-index is off", async () => {
		vi.useFakeTimers();
		const h = makeHarness({ ragAutoIndex: false });
		try {
			h.store.upsert("note.md", [{ text: "indexed content", embedding: [1, 0, 0] }], 1);
			const file = addNote(h, "note.md", "unindexed edits", 2);
			h.contents.delete("note.md");
			h.contents.set("renamed.md", "unindexed edits");
			file.path = "renamed.md";
			h.indexer.renameFile("note.md", file.path);
			await vi.advanceTimersByTimeAsync(4000);
			expect(h.store.hasNote("note.md")).toBe(false);
			expect(h.store.topK([1, 0, 0], 1)[0]?.chunk.text).toBe("indexed content");
			expect(h.embed).not.toHaveBeenCalled();
		} finally {
			h.indexer.cancelDebounced();
			vi.useRealTimers();
		}
	});
});

describe("Indexer stale embedding responses", () => {
	it("does not put a deleted note back into retrieval after its embedding completes", async () => {
		const h = makeHarness();
		const file = addNote(h, "private.md", "deleted content", 1);
		const pending = deferredEmbedding(h);
		const job = h.indexer.indexFile(file);
		await pending.started;
		h.files.splice(0, 1);
		h.contents.delete(file.path);
		h.indexer.removeFile(file.path);
		pending.release();
		await job;
		expect(h.store.hasNote("private.md")).toBe(false);
		h.indexer.cancelDebounced();
	});

	it("does not stamp an old read with a newer file modification time", async () => {
		const h = makeHarness();
		const file = addNote(h, "note.md", "old content", 1);
		const pending = deferredEmbedding(h);
		const job = h.indexer.indexFile(file);
		await pending.started;
		file.stat.mtime = 2;
		h.contents.set(file.path, "new content");
		pending.release();
		await job;
		expect(h.store.getMtime(file.path)).toBeUndefined();
		await h.indexer.start();
		expect(h.store.topK([1, 0, 0], 1)[0]?.chunk.text).toBe("new content");
		expect(h.store.getMtime(file.path)).toBe(2);
		h.indexer.cancelDebounced();
	});

	it("does not overwrite a newer completed embedding with an older response", async () => {
		const h = makeHarness();
		const file = addNote(h, "note.md", "old content", 1);
		const pending = deferredEmbedding(h);
		const oldJob = h.indexer.indexFile(file);
		await pending.started;
		file.stat.mtime = 2;
		h.contents.set(file.path, "new content");
		await h.indexer.indexFile(file);
		pending.release();
		await oldJob;
		expect(h.store.topK([1, 0, 0], 1)[0]?.chunk.text).toBe("new content");
		expect(h.store.getMtime(file.path)).toBe(2);
		h.indexer.cancelDebounced();
	});

	it("does not label a previous model's vectors as the newly selected model", async () => {
		const h = makeHarness();
		const file = addNote(h, "note.md", "body", 1);
		const pending = deferredEmbedding(h);
		const job = h.indexer.indexFile(file);
		await pending.started;
		h.settings.embedderModel = "new-model";
		h.indexer.updateSettings(h.settings);
		h.store.clear();
		h.store.setEmbedderModel("new-model", 0);
		pending.release();
		await job;
		expect(h.store.hasNote(file.path)).toBe(false);
		expect(h.store.getEmbeddingDim()).toBe(0);
		h.indexer.cancelDebounced();
	});

	it("does not commit an in-flight response after plugin shutdown cancels work", async () => {
		const h = makeHarness();
		const file = addNote(h, "note.md", "body", 1);
		const pending = deferredEmbedding(h);
		const job = h.indexer.indexFile(file);
		await pending.started;
		h.indexer.cancel();
		h.indexer.cancelDebounced();
		pending.release();
		await job;
		expect(h.store.hasNote(file.path)).toBe(false);
		h.indexer.cancelDebounced();
	});
});
