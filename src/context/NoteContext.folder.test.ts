import { describe, expect, it } from "vitest";
import { TFile, TFolder } from "obsidian";
import { collectFolderNotes } from "./NoteContext";

function makeFile(path: string, parent: TFolder | null, ext = "md"): TFile {
	const f = new TFile();
	f.path = path;
	f.name = path.split("/").pop() ?? path;
	f.extension = ext;
	f.parent = parent;
	return f;
}

function makeFolder(path: string, parent: TFolder | null = null): TFolder {
	const f = new TFolder();
	f.path = path;
	f.name = path.split("/").pop() ?? path;
	f.parent = parent;
	f.children = [];
	return f;
}

describe("collectFolderNotes", () => {
	it("returns the active note first, then siblings sorted by path", () => {
		const dir = makeFolder("Projects");
		const active = makeFile("Projects/Mmm.md", dir);
		const a = makeFile("Projects/Aaa.md", dir);
		const z = makeFile("Projects/Zzz.md", dir);
		dir.children = [active, z, a];

		const result = collectFolderNotes(active, { recursive: false });
		// Active is always first even though "Aaa" sorts ahead of it.
		expect(result.map((f) => f.path)).toEqual([
			"Projects/Mmm.md",
			"Projects/Aaa.md",
			"Projects/Zzz.md",
		]);
	});

	it("skips non-markdown files", () => {
		const dir = makeFolder("Projects");
		const active = makeFile("Projects/Note.md", dir);
		const img = makeFile("Projects/diagram.png", dir, "png");
		dir.children = [active, img];

		const result = collectFolderNotes(active, { recursive: false });
		expect(result.map((f) => f.path)).toEqual(["Projects/Note.md"]);
	});

	it("includes subfolder notes only when recursive", () => {
		const dir = makeFolder("Projects");
		const sub = makeFolder("Projects/Sub", dir);
		const active = makeFile("Projects/Note.md", dir);
		const deep = makeFile("Projects/Sub/Deep.md", sub);
		sub.children = [deep];
		dir.children = [active, sub];

		expect(
			collectFolderNotes(active, { recursive: false }).map((f) => f.path),
		).toEqual(["Projects/Note.md"]);
		expect(
			collectFolderNotes(active, { recursive: true }).map((f) => f.path),
		).toEqual(["Projects/Note.md", "Projects/Sub/Deep.md"]);
	});

	it("does not duplicate the active note when it is listed twice", () => {
		const dir = makeFolder("Projects");
		const active = makeFile("Projects/Note.md", dir);
		dir.children = [active, active];

		const result = collectFolderNotes(active, { recursive: true });
		expect(result.map((f) => f.path)).toEqual(["Projects/Note.md"]);
	});

	it("returns only the active note when it has no parent folder", () => {
		const active = makeFile("Orphan.md", null);
		expect(
			collectFolderNotes(active, { recursive: true }).map((f) => f.path),
		).toEqual(["Orphan.md"]);
	});
});
