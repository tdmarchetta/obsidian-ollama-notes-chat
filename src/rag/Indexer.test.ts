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
	const store = new VectorStore(new FakeAdapter() as unknown as DataAdapter, "idx/index.json");
	const indexer = new Indexer(app, ollama, settings, store);
	return { indexer, store, embed, files, contents, settings };
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
