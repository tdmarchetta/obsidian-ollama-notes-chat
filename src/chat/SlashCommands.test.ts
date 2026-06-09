import { describe, expect, it } from "vitest";
import { expandTemplate, matchingCompletions, parseSlash } from "./SlashCommands";
import type { SlashCommand } from "../settings/Settings";

const commands: SlashCommand[] = [
	{ name: "summarize", template: "Summarize: {{input}}" },
	{ name: "expand", template: "Expand:\n{{input}}\nContext:\n{{context}}" },
];

describe("parseSlash", () => {
	it("returns null when the input is not a slash command", () => {
		expect(parseSlash("hello", commands)).toBeNull();
	});

	it("matches a command and returns the trimmed remainder", () => {
		const m = parseSlash("/expand  some idea  ", commands);
		expect(m?.command.name).toBe("expand");
		expect(m?.rest).toBe("some idea");
	});

	it("is case-insensitive on the command name", () => {
		expect(parseSlash("/SUMMARIZE x", commands)?.command.name).toBe("summarize");
	});

	it("returns an empty rest when only the command is given", () => {
		const m = parseSlash("/summarize", commands);
		expect(m?.command.name).toBe("summarize");
		expect(m?.rest).toBe("");
	});

	it("returns null for an unknown command", () => {
		expect(parseSlash("/nope stuff", commands)).toBeNull();
	});

	it("returns null for a bare slash", () => {
		expect(parseSlash("/", commands)).toBeNull();
	});

	it("tolerates leading whitespace before the slash", () => {
		expect(parseSlash("   /summarize hi", commands)?.command.name).toBe("summarize");
	});
});

describe("expandTemplate", () => {
	it("substitutes {{input}}", () => {
		expect(expandTemplate("Q: {{input}}", { input: "why" })).toBe("Q: why");
	});

	it("substitutes every occurrence of {{input}}", () => {
		expect(expandTemplate("{{input}}-{{input}}", { input: "x" })).toBe("x-x");
	});

	it("fills {{context}} with an empty string when omitted", () => {
		expect(expandTemplate("[{{context}}]", { input: "" })).toBe("[]");
	});

	it("substitutes {{context}} when provided", () => {
		expect(expandTemplate("{{input}} / {{context}}", { input: "a", context: "b" })).toBe("a / b");
	});
});

describe("matchingCompletions", () => {
	it("returns nothing when the input is not a slash command", () => {
		expect(matchingCompletions("sum", commands)).toEqual([]);
	});

	it("returns all commands for a bare slash", () => {
		expect(matchingCompletions("/", commands).map((c) => c.name)).toEqual([
			"summarize",
			"expand",
		]);
	});

	it("filters by case-insensitive prefix", () => {
		expect(matchingCompletions("/SU", commands).map((c) => c.name)).toEqual(["summarize"]);
	});

	it("returns nothing once a space is typed", () => {
		expect(matchingCompletions("/summarize ", commands)).toEqual([]);
	});

	it("returns an empty list when no command matches the prefix", () => {
		expect(matchingCompletions("/zzz", commands)).toEqual([]);
	});
});
