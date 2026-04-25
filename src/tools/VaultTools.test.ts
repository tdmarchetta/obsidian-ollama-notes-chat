import { describe, expect, it } from "vitest";
import { App, TFile, TFolder } from "obsidian";
import {
	buildVaultToolRegistry,
	InvalidArgumentsError,
	sanitizePath,
} from "./VaultTools";

describe("sanitizePath", () => {
	it("treats empty and root as empty (= vault root)", () => {
		expect(sanitizePath("")).toBe("");
		expect(sanitizePath("/")).toBe("");
	});

	it("passes through a normal vault-relative path", () => {
		expect(sanitizePath("Notes/foo.md")).toBe("Notes/foo.md");
	});

	it("folds backslashes to forward slashes", () => {
		expect(sanitizePath("Notes\\foo.md")).toBe("Notes/foo.md");
	});

	it("rejects null bytes", () => {
		expect(() => sanitizePath("a\0b.md")).toThrow(InvalidArgumentsError);
	});

	it("rejects absolute paths", () => {
		expect(() => sanitizePath("/abs/path.md")).toThrow(InvalidArgumentsError);
	});

	it("rejects literal '..' segments", () => {
		expect(() => sanitizePath("../escape.md")).toThrow(InvalidArgumentsError);
		expect(() => sanitizePath("a/../b.md")).toThrow(InvalidArgumentsError);
	});

	it("rejects literal '.' segments", () => {
		expect(() => sanitizePath("./a.md")).toThrow(InvalidArgumentsError);
		expect(() => sanitizePath("a/./b.md")).toThrow(InvalidArgumentsError);
	});

	it("rejects backslash-escaped traversal", () => {
		// Backslashes fold to forward, then segment check catches the "..".
		expect(() => sanitizePath("..\\escape.md")).toThrow(InvalidArgumentsError);
	});
});

// Build a fake TFolder with mixed visible / hidden children. The stub
// classes from test/obsidian-stub.ts are the same constructors the
// source uses (vitest aliases obsidian → stub), so `instanceof` works.
function fakeFolder(
	path: string,
	children: Array<{
		kind: "folder" | "md" | "non-md";
		name: string;
	}>,
): TFolder {
	const folder = new TFolder();
	folder.path = path;
	folder.name = path === "" ? "" : path.split("/").pop() ?? "";
	folder.children = children.map(({ kind, name }) => {
		const childPath = path === "" ? name : `${path}/${name}`;
		if (kind === "folder") {
			const f = new TFolder();
			f.name = name;
			f.path = childPath;
			return f;
		}
		const f = new TFile();
		f.name = name;
		f.path = childPath;
		f.extension = kind === "md" ? "md" : "txt";
		return f;
	});
	return folder;
}

function fakeApp(root: TFolder): App {
	return {
		vault: {
			getRoot: () => root,
			getAbstractFileByPath: () => null,
		},
	} as unknown as App;
}

describe("list_folder tool", () => {
	const registry = buildVaultToolRegistry();
	const listFolder = registry.get("list_folder");
	if (!listFolder) throw new Error("list_folder not registered");

	it("returns markdown notes and subfolders, sorted", async () => {
		const root = fakeFolder("", [
			{ kind: "folder", name: "Zeta" },
			{ kind: "folder", name: "Alpha" },
			{ kind: "md", name: "two.md" },
			{ kind: "md", name: "one.md" },
		]);
		const result = await listFolder.run({ path: "" }, { app: fakeApp(root) });
		const parsed = JSON.parse(result) as {
			folders: string[];
			notes: string[];
		};
		expect(parsed.folders).toEqual(["Alpha", "Zeta"]);
		expect(parsed.notes).toEqual(["one.md", "two.md"]);
	});

	it("excludes non-markdown files", async () => {
		const root = fakeFolder("", [
			{ kind: "md", name: "note.md" },
			{ kind: "non-md", name: "image.png" },
		]);
		const result = await listFolder.run({ path: "" }, { app: fakeApp(root) });
		const parsed = JSON.parse(result) as { notes: string[] };
		expect(parsed.notes).toEqual(["note.md"]);
	});

	// V4 — defense-in-depth dotfile filter. `.obsidian/`, `.git/`, and any
	// user-created `.private/` shouldn't surface to a model just because it
	// asked for a folder listing.
	it("hides dotfile folders and notes (V4)", async () => {
		const root = fakeFolder("", [
			{ kind: "folder", name: ".obsidian" },
			{ kind: "folder", name: ".git" },
			{ kind: "folder", name: ".private" },
			{ kind: "folder", name: "Visible" },
			{ kind: "md", name: ".hidden.md" },
			{ kind: "md", name: "open.md" },
		]);
		const result = await listFolder.run({ path: "" }, { app: fakeApp(root) });
		const parsed = JSON.parse(result) as {
			folders: string[];
			notes: string[];
		};
		expect(parsed.folders).toEqual(["Visible"]);
		expect(parsed.notes).toEqual(["open.md"]);
	});
});
