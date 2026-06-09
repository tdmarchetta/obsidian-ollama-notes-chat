import { TFile } from "obsidian";
import { describe, expect, it } from "vitest";
import { finalize } from "./NoteContext";

function file(path: string): TFile {
	const f = new TFile();
	f.path = path;
	return f;
}

describe("finalize", () => {
	it("joins blocks under a context header when within the limit", () => {
		const src = file("a.md");
		const out = finalize(["block one", "block two"], [src], src, 10_000);
		expect(out.truncated).toBe(false);
		expect(out.sourceNote).toBe(src);
		expect(out.contributingNotes).toEqual([src]);
		expect(out.text).toContain("the user's Obsidian note context");
		expect(out.text).toContain("block one\nblock two"); // blocks joined with a single "\n"
	});

	it("truncates and appends a notice when over the limit", () => {
		const src = file("big.md");
		const out = finalize(["x".repeat(500)], [src], src, 200);
		expect(out.truncated).toBe(true);
		expect(out.text.length).toBeLessThanOrEqual(200);
		expect(out.text).toContain("Context truncated");
		expect(out.text.endsWith("characters — some content may be missing.]")).toBe(true);
	});

	it("preserves source and contributors when truncating", () => {
		const a = file("a.md");
		const b = file("b.md");
		const out = finalize(["y".repeat(400)], [a, b], a, 150);
		expect(out.truncated).toBe(true);
		expect(out.sourceNote).toBe(a);
		expect(out.contributingNotes).toEqual([a, b]);
	});

	it("does not truncate when exactly at the limit", () => {
		const src = file("a.md");
		const within = finalize(["zzz"], [src], src, 100_000);
		const exact = finalize(["zzz"], [src], src, within.text.length);
		expect(exact.truncated).toBe(false);
		expect(exact.text).toBe(within.text);
	});
});
