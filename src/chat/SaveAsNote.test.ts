import { describe, expect, it } from "vitest";
import { Conversation } from "./Conversation";
import {
	renderMarkdown,
	sanitizeFilename,
	sanitizeFolder,
} from "./SaveAsNote";

describe("sanitizeFilename", () => {
	it("passes through a normal name", () => {
		expect(sanitizeFilename("normal")).toBe("normal");
	});

	it("strips path separators", () => {
		expect(sanitizeFilename("a/b/c")).toBe("a-b-c");
	});

	it("neutralizes traversal segments by replacing the slash", () => {
		// `..` then `/` then `etc` → `/` becomes `-`, leading dots are
		// stripped, so we end up with "-etc". The leading hyphen is
		// cosmetic — the security-relevant property is that the original
		// `/` is gone, so this can't act as a path component anymore.
		expect(sanitizeFilename("../etc")).toBe("-etc");
	});

	it("falls back to 'chat' for an all-dot name", () => {
		expect(sanitizeFilename("...")).toBe("chat");
	});

	it("strips control chars", () => {
		expect(sanitizeFilename("ab")).toBe("a-b");
	});

	it("falls back to 'chat' for empty input", () => {
		expect(sanitizeFilename("")).toBe("chat");
	});
});

describe("sanitizeFolder", () => {
	it("falls back to 'Chats' for an explicit '..' segment", () => {
		expect(sanitizeFolder("..")).toBe("Chats");
		expect(sanitizeFolder("a/../b")).toBe("Chats");
	});

	it("passes a normal nested folder", () => {
		expect(sanitizeFolder("Chats/Daily")).toBe("Chats/Daily");
	});

	it("strips leading and trailing slashes", () => {
		expect(sanitizeFolder("/Chats/")).toBe("Chats");
	});

	it("falls back to 'Chats' for empty input", () => {
		expect(sanitizeFolder("")).toBe("Chats");
		expect(sanitizeFolder("   ")).toBe("Chats");
	});
});

describe("renderMarkdown", () => {
	const stubConv = (): Conversation =>
		new Conversation({
			id: "c1",
			title: "Test",
			titleManuallySet: false,
			messages: [],
			createdAt: 0,
			updatedAt: 0,
		});

	it("emits a YAML frontmatter and an empty body when there are no messages", () => {
		const out = renderMarkdown(stubConv());
		expect(out.startsWith("---\ncreated: ")).toBe(true);
		expect(out).toContain("tags: [ollama-chat]");
		// Two `---` lines: open and close.
		expect(out.match(/^---$/gm)?.length).toBe(2);
	});

	it("escapes `\"`, `\\\\`, and `]]` in the source title", () => {
		const out = renderMarkdown(stubConv(), 'has " quote and \\ backslash and ]] bracket');
		expect(out).toContain('source: "[[has \\" quote and \\\\ backslash and ]\\] bracket]]"');
	});

	// V5 — vertical whitespace in the title (CR / LF) used to drop into the
	// YAML quoted scalar verbatim, producing a multi-line value that some
	// downstream YAML readers mis-handle. Collapse CR/LF runs to a single
	// space before escaping.
	it("collapses CR/LF in the title onto a single line (V5)", () => {
		const out = renderMarkdown(stubConv(), "Test\n---\nadmin: true");
		// Only the two frontmatter delimiters should match `^---$`. If the
		// title's embedded `---` had leaked onto its own line it would push
		// that count to 3 and the YAML block would prematurely close.
		expect(out.match(/^---$/gm)?.length).toBe(2);
		// The source line should be a single physical line.
		const sourceLine = out
			.split("\n")
			.find((l) => l.startsWith("source:"));
		expect(sourceLine).toBeDefined();
		expect(sourceLine).toContain("Test");
		expect(sourceLine).toContain("admin: true");
		// And it should not contain a literal newline (we asserted above
		// it's a single split-line entry, but be explicit about CR too).
		expect(sourceLine).not.toMatch(/[\r\n]/);
	});

	it("handles CRLF in the title the same as LF (V5)", () => {
		const out = renderMarkdown(stubConv(), "Test\r\nsecond");
		const sourceLine = out
			.split("\n")
			.find((l) => l.startsWith("source:"));
		expect(sourceLine).not.toMatch(/[\r\n]/);
		expect(sourceLine).toContain("Test second");
	});
});
