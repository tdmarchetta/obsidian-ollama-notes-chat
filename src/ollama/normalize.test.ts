import { describe, expect, it } from "vitest";
import { normalize } from "./OllamaClient";

describe("normalize (base URL scheme allow-list, ADR-007 H1)", () => {
	it("accepts http and https URLs unchanged", () => {
		expect(normalize("http://localhost:11434")).toBe("http://localhost:11434");
		expect(normalize("https://ollama.example.com")).toBe("https://ollama.example.com");
	});

	it("trims surrounding whitespace and trailing slashes", () => {
		expect(normalize("  http://localhost:11434/  ")).toBe("http://localhost:11434");
		expect(normalize("http://localhost:11434///")).toBe("http://localhost:11434");
	});

	it("returns empty string for empty or whitespace input", () => {
		expect(normalize("")).toBe("");
		expect(normalize("   ")).toBe("");
	});

	it("rejects a schemeless host (parses as a bogus scheme)", () => {
		// "localhost:11434" parses with protocol "localhost:" — the <0.5.2 hazard.
		expect(normalize("localhost:11434")).toBe("");
	});

	it("rejects non-http(s) schemes that would otherwise reach fetch()", () => {
		expect(normalize("file:///etc/passwd")).toBe("");
		expect(normalize("javascript:alert(1)")).toBe("");
		expect(normalize("ftp://example.com")).toBe("");
		expect(normalize("app://obsidian.md")).toBe("");
	});

	it("returns empty string for a malformed URL", () => {
		expect(normalize("not a url")).toBe("");
	});
});
