import { describe, expect, it } from "vitest";
import { normalizePath } from "obsidian";

// Sanity check that vitest can run, that the obsidian alias resolves
// to our stub, and that tsc type-checks the test files. If this passes,
// the rest of the audit's tests can build on it.
describe("test scaffold smoke", () => {
	it("vitest runs", () => {
		expect(1 + 1).toBe(2);
	});

	it("obsidian alias resolves to the stub", () => {
		expect(normalizePath("a//b/")).toBe("a/b");
		expect(normalizePath("a\\b")).toBe("a/b");
	});
});
