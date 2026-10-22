import { describe, expect, it, vi } from "vitest";
import { setTimeout as scheduleTimeout } from "node:timers";
import type { DataAdapter } from "obsidian";
import { VectorStore } from "./VectorStore";

vi.stubGlobal("window", { setTimeout: scheduleTimeout });

// In-memory DataAdapter so we can drive save() / load() without a real vault.
// We only implement the surface VectorStore actually touches.
class FakeAdapter implements Partial<DataAdapter> {
	files = new Map<string, string>();
	renameCalls: Array<[string, string]> = [];

	exists(p: string): Promise<boolean> {
		return Promise.resolve(this.files.has(p));
	}
	read(p: string): Promise<string> {
		const v = this.files.get(p);
		if (v === undefined) {
			return Promise.reject(new Error(`not found: ${p}`));
		}
		return Promise.resolve(v);
	}
	write(p: string, data: string): Promise<void> {
		this.files.set(p, data);
		return Promise.resolve();
	}
	append(p: string, data: string): Promise<void> {
		this.files.set(p, (this.files.get(p) ?? "") + data);
		return Promise.resolve();
	}
	rename(oldPath: string, newPath: string): Promise<void> {
		this.renameCalls.push([oldPath, newPath]);
		const v = this.files.get(oldPath);
		if (v === undefined) {
			return Promise.reject(new Error(`not found: ${oldPath}`));
		}
		if (this.files.has(newPath)) {
			return Promise.reject(new Error(`Destination file already exists: ${newPath}`));
		}
		this.files.delete(oldPath);
		this.files.set(newPath, v);
		return Promise.resolve();
	}
	remove(p: string): Promise<void> {
		this.files.delete(p);
		return Promise.resolve();
	}
}

// Same surface plus a knob to make the Nth rename call throw, so we can
// simulate a crash between the move-aside and move-into-place steps.
class FaultyAdapter extends FakeAdapter {
	failOnRename: number | null = null;

	override rename(oldPath: string, newPath: string): Promise<void> {
		this.renameCalls.push([oldPath, newPath]);
		if (this.failOnRename === this.renameCalls.length) {
			return Promise.reject(new Error(`simulated rename failure on call ${this.failOnRename}`));
		}
		const v = this.files.get(oldPath);
		if (v === undefined) {
			return Promise.reject(new Error(`not found: ${oldPath}`));
		}
		if (this.files.has(newPath)) {
			return Promise.reject(new Error(`Destination file already exists: ${newPath}`));
		}
		this.files.delete(oldPath);
		this.files.set(newPath, v);
		return Promise.resolve();
	}
}

const PATH = "index.json";

describe("VectorStore.save", () => {
	it("serializes overlapping writes and persists the latest state", async () => {
		const adapter = new FakeAdapter();
		const store = new VectorStore(adapter as unknown as DataAdapter, PATH);
		await store.save();
		store.upsert("a.md", [{ text: "a", embedding: [1] }], 1);
		const first = store.save();
		store.upsert("b.md", [{ text: "b", embedding: [1] }], 2);
		await Promise.all([first, store.save()]);
		const loaded = new VectorStore(adapter as unknown as DataAdapter, PATH);
		await loaded.load();
		expect(loaded.knownPaths()).toEqual(["a.md", "b.md"]);
		expect([...adapter.files.keys()]).toEqual([PATH]);
	});

	it("replaces a stale backup left after a successful rename", async () => {
		const adapter = new FakeAdapter();
		const store = new VectorStore(adapter as unknown as DataAdapter, PATH);
		await store.save();
		adapter.files.set(`${PATH}.bak`, adapter.files.get(PATH)!);
		store.upsert("new.md", [{ text: "new", embedding: [1] }], 2);
		await store.save();
		const loaded = new VectorStore(adapter as unknown as DataAdapter, PATH);
		await loaded.load();
		expect(loaded.hasNote("new.md")).toBe(true);
		expect(adapter.files.has(`${PATH}.bak`)).toBe(false);
	});

	it("allows a later save after a failed transaction", async () => {
		const adapter = new FaultyAdapter();
		const store = new VectorStore(adapter as unknown as DataAdapter, PATH);
		await store.save();
		adapter.failOnRename = adapter.renameCalls.length + 2;
		await expect(store.save()).rejects.toThrow(/simulated rename failure/);
		adapter.failOnRename = null;
		store.upsert("retry.md", [{ text: "retry", embedding: [1] }], 3);
		await store.save();
		const loaded = new VectorStore(adapter as unknown as DataAdapter, PATH);
		await loaded.load();
		expect(loaded.hasNote("retry.md")).toBe(true);
	});

	it("writes a fresh file when none exists", async () => {
		const adapter = new FakeAdapter();
		const store = new VectorStore(adapter as unknown as DataAdapter, PATH);
		store.setEmbedderModel("test-embed", 4);
		await store.save();

		expect(adapter.files.has(PATH)).toBe(true);
		expect(adapter.files.has(`${PATH}.tmp`)).toBe(false);
		expect(adapter.files.has(`${PATH}.bak`)).toBe(false);
		const parsed = JSON.parse(adapter.files.get(PATH) ?? "") as {
			schemaVersion: number;
			embedderModel: string;
			embeddingDim: number;
		};
		expect(parsed.schemaVersion).toBe(1);
		expect(parsed.embedderModel).toBe("test-embed");
		expect(parsed.embeddingDim).toBe(4);
	});

	it("overwrites an existing file via the backup path and cleans up", async () => {
		const adapter = new FakeAdapter();
		adapter.files.set(PATH, JSON.stringify({ schemaVersion: 1, old: true }));

		const store = new VectorStore(adapter as unknown as DataAdapter, PATH);
		store.setEmbedderModel("new", 8);
		await store.save();

		expect(adapter.files.has(PATH)).toBe(true);
		expect(adapter.files.has(`${PATH}.tmp`)).toBe(false);
		expect(adapter.files.has(`${PATH}.bak`)).toBe(false);
		const parsed = JSON.parse(adapter.files.get(PATH) ?? "") as {
			embedderModel: string;
		};
		expect(parsed.embedderModel).toBe("new");
	});

	// V7 — the original sequence (write tmp → remove existing → rename tmp)
	// had a window where neither the live file nor a backup existed. A
	// crash there meant losing the entire index. The new sequence keeps a
	// .bak around through the dangerous step and restores it if the second
	// rename fails.
	it("restores the previous file when rename-into-place fails (V7)", async () => {
		const adapter = new FaultyAdapter();
		const original = JSON.stringify({ schemaVersion: 1, marker: "original" });
		adapter.files.set(PATH, original);

		// Sequence with hadOld=true:
		//   1. write(tmp)         (no rename)
		//   2. rename(path, bak)  ← rename #1
		//   3. rename(tmp, path)  ← rename #2 — fail this one
		//   4. rename(bak, path)  ← rename #3 — recovery
		adapter.failOnRename = 2;

		const store = new VectorStore(adapter as unknown as DataAdapter, PATH);
		store.setEmbedderModel("new", 4);

		await expect(store.save()).rejects.toThrow(/simulated rename failure/);

		// Live path holds the original content again.
		expect(adapter.files.get(PATH)).toBe(original);
		// Backup is gone (renamed back).
		expect(adapter.files.has(`${PATH}.bak`)).toBe(false);
		// We expect three rename attempts total: aside, into-place (fails),
		// and recovery back-from-bak.
		expect(adapter.renameCalls).toHaveLength(3);
	});

	it("round-trips through load(): save then load gives back the same model + dim", async () => {
		const adapter = new FakeAdapter();
		const store1 = new VectorStore(adapter as unknown as DataAdapter, PATH);
		store1.setEmbedderModel("e1", 3);
		store1.upsert("Note.md", [{ text: "hi", embedding: [1, 0, 0] }], 1234);
		await store1.save();

		const store2 = new VectorStore(adapter as unknown as DataAdapter, PATH);
		await store2.load();
		expect(store2.getEmbedderModel()).toBe("e1");
		expect(store2.getEmbeddingDim()).toBe(3);
		expect(store2.hasNote("Note.md")).toBe(true);
		expect(store2.getMtime("Note.md")).toBe(1234);
	});
});

// Several MiB in one note catches whole-note as well as whole-index stringify.
function largeChunks() {
	return Array.from({ length: 160 }, (_, i) => ({
		heading: `Section ${i}`,
		text: "x".repeat(16384),
		embedding: [1, 0, 0],
	}));
}

describe("VectorStore responsive persistence", () => {
	it("lets a timer run during a large note save and bounds each storage write", async () => {
		let heartbeat = false;
		const sizes: number[] = [];
		class RecordingAdapter extends FakeAdapter {
			override write(p: string, data: string): Promise<void> {
				sizes.push(data.length);
				return super.write(p, data);
			}
			override append(p: string, data: string): Promise<void> {
				sizes.push(data.length);
				return super.append(p, data);
			}
		}
		const adapter = new RecordingAdapter();
		const store = new VectorStore(adapter as unknown as DataAdapter, PATH);
		store.upsert("large.md", largeChunks(), 1);
		window.setTimeout(() => { heartbeat = true; }, 0);
		await store.save();
		expect(heartbeat).toBe(true);
		expect(Math.max(...sizes)).toBeLessThanOrEqual(1024 * 1024);
		const loaded = new VectorStore(adapter as unknown as DataAdapter, PATH);
		await loaded.load();
		expect(loaded.stats()).toEqual({ notes: 1, chunks: 160 });
	});

	it("coalesces queued requests and keeps each published snapshot consistent", async () => {
		let release!: () => void;
		let entered!: () => void;
		const gate = new Promise<void>((resolve) => { release = resolve; });
		const started = new Promise<void>((resolve) => { entered = resolve; });
		const published: unknown[] = [];
		class GatedAdapter extends FakeAdapter {
			writes = 0;
			override async write(p: string, data: string): Promise<void> {
				if (++this.writes === 1) {
					entered();
					await gate;
				}
				await super.write(p, data);
			}
			override async rename(a: string, b: string): Promise<void> {
				await super.rename(a, b);
				if (b === PATH) published.push(JSON.parse(this.files.get(PATH)!));
			}
		}
		const adapter = new GatedAdapter();
		const store = new VectorStore(adapter as unknown as DataAdapter, PATH);
		store.setEmbedderModel("before", 3);
		store.upsert("old.md", largeChunks(), 1);
		const first = store.save();
		await started;
		store.clear();
		store.setEmbedderModel("after", 1);
		store.upsert("new.md", [{ text: "latest", embedding: [1] }], 2);
		let settled = false;
		const queued = Array.from({ length: 12 }, () => store.save());
		void queued[0]!.then(() => { settled = true; });
		await Promise.resolve();
		expect(settled).toBe(false);
		release();
		await Promise.all([first, ...queued]);
		expect(published).toHaveLength(2);
		expect(published[0]).toMatchObject({
			embedderModel: "before", embeddingDim: 3,
			notes: { "old.md": { mtime: 1, chunks: largeChunks() } },
		});
		expect(published[1]).toEqual({
			schemaVersion: 1, embedderModel: "after", embeddingDim: 1,
			notes: { "new.md": { mtime: 2, chunks: [{ text: "latest", embedding: [1] }] } },
		});
		expect(settled).toBe(true);
	});

	it("preserves the live index after an append failure and permits a retry", async () => {
		class FailingAppendAdapter extends FakeAdapter {
			fail = true;
			override append(p: string, data: string): Promise<void> {
				if (this.fail) return Promise.reject(new Error("append failed"));
				return super.append(p, data);
			}
		}
		const adapter = new FailingAppendAdapter();
		const original = JSON.stringify({ schemaVersion: 1, marker: "original" });
		adapter.files.set(PATH, original);
		const store = new VectorStore(adapter as unknown as DataAdapter, PATH);
		store.upsert("large.md", largeChunks(), 1);
		await expect(store.save()).rejects.toThrow("append failed");
		expect(adapter.files.get(PATH)).toBe(original);
		expect(adapter.files.has(`${PATH}.bak`)).toBe(false);
		adapter.fail = false;
		await store.save();
		const loaded = new VectorStore(adapter as unknown as DataAdapter, PATH);
		await loaded.load();
		expect(loaded.stats()).toEqual({ notes: 1, chunks: 160 });
	});

	it("round-trips escaped paths, headings and Unicode across storage boundaries", async () => {
		// Real adapters encode each call independently; string concatenation
		// alone would hide a surrogate pair split across two append calls.
		class EncodingAdapter extends FakeAdapter {
			override write(p: string, data: string): Promise<void> {
				return super.write(p, new TextDecoder().decode(new TextEncoder().encode(data)));
			}
			override append(p: string, data: string): Promise<void> {
				return super.append(p, new TextDecoder().decode(new TextEncoder().encode(data)));
			}
		}
		const adapter = new EncodingAdapter();
		const store = new VectorStore(adapter as unknown as DataAdapter, PATH);
		const text = "😀漢字\"\n".repeat(70000);
		const notePath = "folder/quoted \" emoji😀.md";
		store.upsert(notePath, [{ heading: "\n\"😀", text, embedding: [1, 2] }], 17);
		await store.save();
		const loaded = new VectorStore(adapter as unknown as DataAdapter, PATH);
		await loaded.load();
		expect(loaded.topK([1, 2], 1)[0]).toMatchObject({
			notePath, chunk: { heading: "\n\"😀", text, embedding: [1, 2] },
		});
	});
});

describe("VectorStore.load", () => {
	it("recovers the backup when a crash interrupted the final rename", async () => {
		const adapter = new FakeAdapter();
		const original = new VectorStore(adapter as unknown as DataAdapter, PATH);
		original.setEmbedderModel("e", 1);
		original.upsert("saved.md", [{ text: "saved", embedding: [1] }], 7);
		await original.save();
		await adapter.rename(PATH, `${PATH}.bak`);
		adapter.files.set(`${PATH}.tmp`, "interrupted write");
		const loaded = new VectorStore(adapter as unknown as DataAdapter, PATH);
		await loaded.load();
		expect(loaded.hasNote("saved.md")).toBe(true);
		expect(loaded.getEmbedderModel()).toBe("e");
		expect(adapter.files.has(PATH)).toBe(true);
		await loaded.save();
		expect([...adapter.files.keys()]).toEqual([PATH]);
	});

	it("silently drops chunks with non-finite embedding values", async () => {
		const adapter = new FakeAdapter();
		adapter.files.set(
			PATH,
			JSON.stringify({
				schemaVersion: 1,
				embedderModel: "e",
				embeddingDim: 3,
				notes: {
					"good.md": {
						mtime: 1,
						chunks: [{ text: "ok", embedding: [1, 2, 3] }],
					},
					"bad.md": {
						mtime: 1,
						// NaN slips through JSON only as `null`, so simulate the
						// runtime-corruption case by hand-crafting an "Infinity"
						// string. JSON.parse of "Infinity" throws — but a chunk
						// with NaN-as-null in its embedding will fail the finite
						// check and be skipped.
						chunks: [{ text: "skip", embedding: [1, null, 3] }],
					},
				},
			}),
		);

		const store = new VectorStore(adapter as unknown as DataAdapter, PATH);
		await store.load();

		expect(store.hasNote("good.md")).toBe(true);
		// bad.md had only one chunk, and that chunk was invalid → no chunks
		// remain → the whole note is dropped.
		expect(store.hasNote("bad.md")).toBe(false);
	});
});

describe("VectorStore.topK", () => {
	function seeded(): VectorStore {
		const store = new VectorStore(new FakeAdapter() as unknown as DataAdapter, PATH);
		store.upsert("a.md", [{ text: "a", embedding: [1, 0, 0] }], 1);
		store.upsert("b.md", [{ text: "b", embedding: [0, 1, 0] }], 1);
		store.upsert("c.md", [{ text: "c", embedding: [1, 1, 0] }], 1);
		return store;
	}

	it("ranks by cosine similarity and respects k", () => {
		const store = seeded();
		const hits = store.topK([1, 0, 0], 2);
		expect(hits).toHaveLength(2);
		expect(hits[0]!.notePath).toBe("a.md");
		expect(hits[0]!.score).toBeCloseTo(1, 6); // identical direction
		expect(hits[1]!.notePath).toBe("c.md");
		expect(hits[1]!.score).toBeCloseTo(1 / Math.SQRT2, 6); // 45° apart
	});

	it("returns identical results across repeated queries (norm cache is transparent)", () => {
		const store = seeded();
		const first = store.topK([1, 0, 0], 3);
		const second = store.topK([1, 0, 0], 3);
		expect(second.map((h) => [h.notePath, h.score])).toEqual(
			first.map((h) => [h.notePath, h.score]),
		);
	});

	it("reflects a re-chunk: re-upserting a note recomputes its norm", () => {
		const store = seeded();
		expect(store.topK([1, 0, 0], 1)[0]!.notePath).toBe("a.md");
		// Replace a.md's chunk with an orthogonal embedding. A norm cached by
		// path (rather than by the chunk object) would mis-score this; the
		// WeakMap keys on the fresh chunk object, so the norm is recomputed.
		store.upsert("a.md", [{ text: "a2", embedding: [0, 0, 1] }], 2);
		const hits = store.topK([1, 0, 0], 3);
		expect(hits[0]!.notePath).toBe("c.md");
		expect(hits.find((h) => h.notePath === "a.md")?.score).toBeCloseTo(0, 6);
	});

	it("returns an empty list for a zero-norm query", () => {
		expect(seeded().topK([0, 0, 0], 3)).toEqual([]);
	});

	it("skips chunks whose embedding length differs from the query", () => {
		// 4-dim query vs. all-3-dim index → nothing comparable.
		expect(seeded().topK([1, 0, 0, 0], 3)).toEqual([]);
	});
});
