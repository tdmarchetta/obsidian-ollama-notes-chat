import { describe, expect, it } from "vitest";
import { stripFences } from "./RewriteCommand";

describe("stripFences", () => {
	it("returns plain text unchanged", () => {
		expect(stripFences("hello")).toBe("hello");
	});

	it("strips a bare backtick fence", () => {
		expect(stripFences("```\nhello\n```")).toBe("hello");
	});

	it("strips a backtick fence with a language tag", () => {
		expect(stripFences("```python\nx = 1\n```")).toBe("x = 1");
	});

	// V2 — tilde fences are valid markdown and some models prefer them.
	it("strips a bare tilde fence (V2)", () => {
		expect(stripFences("~~~\nhello\n~~~")).toBe("hello");
	});

	it("strips a tilde fence with a language tag (V2)", () => {
		expect(stripFences("~~~markdown\nhi\n~~~")).toBe("hi");
	});

	it("leaves an unclosed fence alone", () => {
		expect(stripFences("```\nonly opening")).toBe("```\nonly opening");
	});

	it("does not strip mismatched fence characters", () => {
		// Opens with backticks, closes with tildes — that's not a real fence.
		// The backreference in the regex requires the same character on both
		// ends, so we pass through untouched.
		expect(stripFences("```\nbody\n~~~")).toBe("```\nbody\n~~~");
	});
});
