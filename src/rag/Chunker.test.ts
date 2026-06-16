import { describe, expect, it } from "vitest";
import { chunkMarkdown, type ChunkOptions } from "./Chunker";

const opts = (chunkSize: number, overlap: number): ChunkOptions => ({ chunkSize, overlap });

describe("chunkMarkdown", () => {
	it("returns a single chunk for short headingless text", () => {
		expect(chunkMarkdown("Just a sentence.", opts(800, 100))).toEqual([
			{ heading: undefined, text: "Just a sentence." },
		]);
	});

	it("strips leading frontmatter before chunking", () => {
		const chunks = chunkMarkdown("---\ntitle: T\n---\nBody text", opts(800, 100));
		expect(chunks).toHaveLength(1);
		expect(chunks[0]!.text).toBe("Body text");
	});

	it("splits into sections by H1–H3 headings", () => {
		const md = "# One\nalpha\n## Two\nbeta\n### Three\ngamma";
		expect(chunkMarkdown(md, opts(800, 100))).toEqual([
			{ heading: "One", text: "alpha" },
			{ heading: "Two", text: "beta" },
			{ heading: "Three", text: "gamma" },
		]);
	});

	it("captures content before the first heading with no heading", () => {
		const chunks = chunkMarkdown("intro line\n# Head\nbody", opts(800, 100));
		expect(chunks[0]).toEqual({ heading: undefined, text: "intro line" });
		expect(chunks[1]).toEqual({ heading: "Head", text: "body" });
	});

	it("strips ATX closing hashes from headings", () => {
		expect(chunkMarkdown("## Title ##\ntext", opts(800, 100))[0]!.heading).toBe("Title");
	});

	it("does not treat H4+ as a heading", () => {
		const chunks = chunkMarkdown("#### Not a heading\ntext", opts(800, 100));
		expect(chunks).toHaveLength(1);
		expect(chunks[0]!.heading).toBeUndefined();
		expect(chunks[0]!.text).toBe("#### Not a heading\ntext");
	});

	it("skips heading-only sections with no body", () => {
		expect(chunkMarkdown("# Empty\n\n# Full\nbody", opts(800, 100))).toEqual([
			{ heading: "Full", text: "body" },
		]);
	});

	it("skips an all-whitespace document", () => {
		expect(chunkMarkdown("   \n\n  ", opts(800, 100))).toEqual([]);
	});

	it("slides a window with overlap over a long section", () => {
		// 25 chars, no spaces so trim() can't perturb the slice boundaries.
		const body = "abcdefghijklmnopqrstuvwxy";
		const chunks = chunkMarkdown(body, opts(10, 4)); // step = windowSize - overlap = 6
		expect(chunks.map((c) => c.text)).toEqual([
			"abcdefghij",
			"ghijklmnop",
			"mnopqrstuv",
			"stuvwxy",
		]);
	});

	it("propagates the section heading onto every window", () => {
		const chunks = chunkMarkdown("# H\nabcdefghijklmnopqrstuvwxy", opts(10, 4));
		expect(chunks.length).toBeGreaterThan(1);
		expect(chunks.every((c) => c.heading === "H")).toBe(true);
	});
});
