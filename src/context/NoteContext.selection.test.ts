import { describe, expect, it } from "vitest";
import { MarkdownView, TFile, type App } from "obsidian";
import { buildContext } from "./NoteContext";
import { DEFAULT_SETTINGS } from "../settings/Settings";

function setup(selection: string, recentPath = "note.md", focused = false) {
	const active = new TFile();
	active.path = "note.md";
	const recentFile = new TFile();
	recentFile.path = recentPath;
	const view = Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, {
		file: recentFile,
		editor: { getSelection: () => selection },
	});
	const app = {
		workspace: {
			getActiveFile: () => active,
			getActiveViewOfType: () => focused ? view : null,
			getMostRecentLeaf: () => ({ view }),
		},
		vault: { cachedRead: () => Promise.resolve("whole note body") },
	} as unknown as App;
	return app;
}

describe("current selection context", () => {
	it("uses the recent note selection after the chat sidebar takes focus", async () => {
		const ctx = await buildContext(setup("selected paragraph"), "current-selection", DEFAULT_SETTINGS);
		expect(ctx.text).toContain("selected paragraph");
		expect(ctx.text).not.toContain("whole note body");
		expect(ctx.sourceNote?.path).toBe("note.md");
	});

	it("keeps using a selection in the focused note editor", async () => {
		const ctx = await buildContext(setup("selected paragraph", "note.md", true), "current-selection", DEFAULT_SETTINGS);
		expect(ctx.text).toContain("selected paragraph");
		expect(ctx.text).not.toContain("whole note body");
	});

	it("does not attach a different note's selection to the active source note", async () => {
		const ctx = await buildContext(setup("unrelated selection", "other.md"), "current-selection", DEFAULT_SETTINGS);
		expect(ctx.text).toContain("whole note body");
		expect(ctx.text).not.toContain("unrelated selection");
	});

	it("keeps the whole-note fallback when the recent editor has no selection", async () => {
		const ctx = await buildContext(setup(""), "current-selection", DEFAULT_SETTINGS);
		expect(ctx.text).toContain("whole note body");
	});
});
