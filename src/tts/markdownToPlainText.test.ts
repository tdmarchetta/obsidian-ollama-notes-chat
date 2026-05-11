import { describe, it, expect } from "vitest";
import { markdownToPlainText } from "./markdownToPlainText";

describe("markdownToPlainText", () => {
	it("returns empty for empty input", () => {
		expect(markdownToPlainText("")).toBe("");
	});

	it("strips fenced code blocks entirely", () => {
		const input = "before\n```js\nconst x = 1;\n```\nafter";
		expect(markdownToPlainText(input)).toBe("before\n\nafter");
	});

	it("keeps inline code content, drops backticks", () => {
		expect(markdownToPlainText("call `foo()` here")).toBe("call foo() here");
	});

	it("reduces links to their display text", () => {
		expect(markdownToPlainText("see [the docs](https://example.com)")).toBe("see the docs");
	});

	it("reduces wikilinks to their target or alias", () => {
		expect(markdownToPlainText("see [[Note A]]")).toBe("see Note A");
		expect(markdownToPlainText("see [[Note A|the first one]]")).toBe("see the first one");
	});

	it("strips bold, italic, strikethrough", () => {
		expect(markdownToPlainText("**bold** _italic_ ~~gone~~")).toBe("bold italic gone");
	});

	it("strips heading hashes", () => {
		expect(markdownToPlainText("# Title\n## Sub\nbody")).toBe("Title\nSub\nbody");
	});

	it("strips list markers", () => {
		expect(markdownToPlainText("- one\n- two\n1. first\n2. second")).toBe("one\ntwo\nfirst\nsecond");
	});

	it("strips blockquote markers", () => {
		expect(markdownToPlainText("> quoted line")).toBe("quoted line");
	});

	it("strips simple HTML tags but keeps inner text", () => {
		expect(markdownToPlainText("hello <em>world</em>")).toBe("hello world");
	});

	it("drops alt text for images with empty alt", () => {
		expect(markdownToPlainText("look ![](url) here")).toBe("look  here");
	});

	it("keeps alt text for images with content", () => {
		expect(markdownToPlainText("look ![a cat](url) here")).toBe("look a cat here");
	});

	it("collapses runs of blank lines", () => {
		expect(markdownToPlainText("a\n\n\n\nb")).toBe("a\n\nb");
	});
});
