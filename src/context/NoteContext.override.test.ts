import { describe, expect, it } from "vitest";
import { describeActiveOverride } from "./NoteContext";

describe("describeActiveOverride (note-override badge labels)", () => {
	it("returns nothing when no chat-relevant field is overridden", () => {
		expect(describeActiveOverride({})).toEqual([]);
		// rewrite* and toolsDisabled don't change a chat send, so they don't
		// trigger the badge.
		expect(
			describeActiveOverride({ rewriteSystemPrompt: "x", rewriteDisabled: true, toolsDisabled: true }),
		).toEqual([]);
	});

	it("labels system-prompt and model overrides", () => {
		expect(describeActiveOverride({ systemPrompt: "be terse" })).toEqual(["system prompt"]);
		expect(describeActiveOverride({ model: "llama3.1:70b" })).toEqual(["model"]);
		expect(
			describeActiveOverride({ systemPrompt: "be terse", model: "llama3.1:70b" }),
		).toEqual(["system prompt", "model"]);
	});

	it("treats an empty-string override as present (it still replaces the global value)", () => {
		expect(describeActiveOverride({ systemPrompt: "" })).toEqual(["system prompt"]);
	});
});
