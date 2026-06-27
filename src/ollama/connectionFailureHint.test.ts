import { describe, expect, it } from "vitest";
import { connectionFailureHint } from "./OllamaClient";

describe("connectionFailureHint (network guidance)", () => {
	it("recommends the scoped origin, never the wildcard, on a fetch failure", () => {
		const hint = connectionFailureHint("Failed to fetch");
		expect(hint).toContain("OLLAMA_ORIGINS=app://obsidian.md");
		// The wildcard exposes the server to any web page — it must not be the
		// value the in-app error toast nudges users to copy.
		expect(hint).not.toContain("OLLAMA_ORIGINS=*");
	});

	it("fires for the known network-level error shapes", () => {
		expect(connectionFailureHint("NetworkError when attempting to fetch")).not.toBe("");
		expect(connectionFailureHint("TypeError: failed")).not.toBe("");
	});

	it("stays silent for non-network errors (e.g. HTTP status)", () => {
		expect(connectionFailureHint("Ollama /api/tags returned 404")).toBe("");
		expect(connectionFailureHint("")).toBe("");
	});
});
