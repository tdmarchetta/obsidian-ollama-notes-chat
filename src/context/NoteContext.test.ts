import { describe, expect, it } from "vitest";
import { formatCitation } from "./NoteContext";

describe("formatCitation", () => {
	it("uses a clean basename link when the name is unambiguous", () => {
		expect(formatCitation("Projects/Roadmap.md", "Q3")).toBe("[[Roadmap#Q3]]");
	});

	it("drops the heading when none is given", () => {
		expect(formatCitation("Projects/Roadmap.md")).toBe("[[Roadmap]]");
	});

	it("path-qualifies with an alias when the basename is ambiguous", () => {
		expect(formatCitation("Work/Notes/Index.md", "Goals", true)).toBe(
			"[[Work/Notes/Index#Goals|Index#Goals]]",
		);
	});

	it("path-qualifies without a heading when ambiguous", () => {
		expect(formatCitation("Work/Notes/Index.md", undefined, true)).toBe(
			"[[Work/Notes/Index|Index]]",
		);
	});

	it("handles a root-level note path", () => {
		expect(formatCitation("Index.md", "Top", true)).toBe("[[Index#Top|Index#Top]]");
	});
});
