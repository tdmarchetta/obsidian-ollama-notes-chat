import { describe, expect, it } from "vitest";
import { noteBasename } from "./noteBasename";

describe("noteBasename", () => {
	it("returns the basename of a nested path without the .md extension", () => {
		expect(noteBasename("A/B/Project Roadmap.md")).toBe("Project Roadmap");
	});

	it("handles a path with no folders", () => {
		expect(noteBasename("Inbox.md")).toBe("Inbox");
	});

	it("strips the extension case-insensitively", () => {
		expect(noteBasename("Notes/Daily.MD")).toBe("Daily");
	});

	it("keeps a non-md filename intact", () => {
		expect(noteBasename("Attachments/diagram.canvas")).toBe("diagram.canvas");
	});

	it("returns null for a path ending in a slash", () => {
		expect(noteBasename("Folder/")).toBeNull();
	});

	it("returns null for an empty string", () => {
		expect(noteBasename("")).toBeNull();
	});
});
