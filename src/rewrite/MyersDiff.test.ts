import { describe, expect, it } from "vitest";
import { diff, tokenize } from "./MyersDiff";

describe("tokenize", () => {
	it("returns empty array for empty input", () => {
		expect(tokenize("")).toEqual([]);
	});

	it("splits on whitespace runs and keeps them as separate tokens", () => {
		expect(tokenize("hello world")).toEqual(["hello", " ", "world"]);
	});
});

describe("diff", () => {
	it("collapses identical input into a single equal token", () => {
		const out = diff("hello world", "hello world");
		expect(out).toEqual([{ type: "equal", text: "hello world" }]);
	});

	it("emits an insert run when text is appended", () => {
		const out = diff("hello", "hello world");
		expect(out).toEqual([
			{ type: "equal", text: "hello" },
			{ type: "insert", text: " world" },
		]);
	});

	it("emits a delete run when text is removed", () => {
		const out = diff("hello world", "hello");
		expect(out).toEqual([
			{ type: "equal", text: "hello" },
			{ type: "delete", text: " world" },
		]);
	});

	// V1 — Without CRLF normalization the tokenizer would see the line
	// endings as different whitespace tokens and emit insert/delete pairs
	// for every newline. After the fix both sides normalize to LF before
	// tokenizing, so a content-identical rewrite produces a single equal.
	it("ignores LF/CRLF differences (V1)", () => {
		const lfToCrlf = diff("a\nb", "a\r\nb");
		expect(lfToCrlf).toEqual([{ type: "equal", text: "a\nb" }]);

		const crlfToLf = diff("a\r\nb", "a\nb");
		expect(crlfToLf).toEqual([{ type: "equal", text: "a\nb" }]);
	});
});
