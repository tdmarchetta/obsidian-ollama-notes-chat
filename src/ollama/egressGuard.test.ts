import { describe, expect, it } from "vitest";
import { OllamaClient } from "./OllamaClient";

const REMOTE = "http://192.168.7.43:11434";
const LOCAL = "http://localhost:11434";

// The obsidian stub's requestUrl throws "requestUrl is not available in vitest",
// so a call that PASSES the egress guard rejects with that message — letting us
// tell "blocked by the guard" apart from "reached the network layer".
const REACHED_NETWORK = /requestUrl is not available/;
const BLOCKED = /privacy setting/i;

describe("OllamaClient egress guard (allowRemoteHost)", () => {
	it("blocks every request path to a non-local host when disabled", async () => {
		const c = new OllamaClient(REMOTE, false);
		await expect(c.listModels()).rejects.toThrow(BLOCKED);
		await expect(c.embed("m", "x")).rejects.toThrow(BLOCKED);
		await expect(c.chatOnce({ messages: [], model: "m" })).rejects.toThrow(BLOCKED);
		// Streaming runs its guard synchronously at first .next(), before any fetch.
		await expect(c.chatStream({ messages: [], model: "m" }).next()).rejects.toThrow(BLOCKED);
	});

	it("names the blocked host so the user knows what was refused", async () => {
		await expect(new OllamaClient(REMOTE, false).listModels()).rejects.toThrow(/192\.168\.7\.43/);
	});

	it("allows a loopback host even when disabled — data stays on this machine", async () => {
		// Passes the guard and reaches the (stubbed) network layer; not blocked.
		await expect(new OllamaClient(LOCAL, false).listModels()).rejects.toThrow(REACHED_NETWORK);
	});

	it("allows a remote host once explicitly enabled, and the setter toggles it back", async () => {
		const c = new OllamaClient(REMOTE, true);
		await expect(c.listModels()).rejects.toThrow(REACHED_NETWORK);
		c.setAllowRemoteHost(false);
		await expect(c.listModels()).rejects.toThrow(BLOCKED);
	});

	it("defaults to disabled when the flag is omitted from the constructor", async () => {
		await expect(new OllamaClient(REMOTE).listModels()).rejects.toThrow(BLOCKED);
	});
});
