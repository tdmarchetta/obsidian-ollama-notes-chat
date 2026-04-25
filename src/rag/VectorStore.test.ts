import { describe, expect, it } from "vitest";
import type { DataAdapter } from "obsidian";
import { VectorStore } from "./VectorStore";

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
	rename(oldPath: string, newPath: string): Promise<void> {
		this.renameCalls.push([oldPath, newPath]);
		const v = this.files.get(oldPath);
		if (v === undefined) {
			return Promise.reject(new Error(`not found: ${oldPath}`));
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
		this.files.delete(oldPath);
		this.files.set(newPath, v);
		return Promise.resolve();
	}
}

const PATH = "index.json";

describe("VectorStore.save", () => {
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

describe("VectorStore.load", () => {
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
