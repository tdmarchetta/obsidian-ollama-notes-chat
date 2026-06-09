import { describe, expect, it } from "vitest";
import { stripFrontmatter } from "./frontmatter";

describe("stripFrontmatter", () => {
	it("removes a leading YAML block and returns the body", () => {
		expect(stripFrontmatter("---\ntitle: Hi\n---\nBody here")).toBe("Body here");
	});

	it("returns the input unchanged when there is no frontmatter", () => {
		expect(stripFrontmatter("# Heading\nText")).toBe("# Heading\nText");
	});

	it("returns the input unchanged when the block is never closed", () => {
		const raw = "---\ntitle: Hi\nstill going";
		expect(stripFrontmatter(raw)).toBe(raw);
	});

	it("yields an empty string when a closed block runs to EOF with no body", () => {
		expect(stripFrontmatter("---\ntitle: Hi\n---")).toBe("");
	});

	it("only strips the first block, leaving a later --- in the body intact", () => {
		expect(stripFrontmatter("---\na: 1\n---\nBefore\n---\nAfter")).toBe("Before\n---\nAfter");
	});

	it("does not treat a horizontal rule mid-document as frontmatter", () => {
		const raw = "Intro\n---\nMore";
		expect(stripFrontmatter(raw)).toBe(raw);
	});
});
