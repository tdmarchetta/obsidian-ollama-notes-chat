import { App, TFile, TFolder, normalizePath } from "obsidian";
import type { ToolSpec } from "../ollama/OllamaClient";

export interface ToolContext {
	app: App;
}

export interface Tool {
	spec: ToolSpec;
	run(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

export class InvalidArgumentsError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InvalidArgumentsError";
	}
}

const READ_CAP_BYTES = 32 * 1024;

function requireString(args: Record<string, unknown>, key: string): string {
	const v = args[key];
	if (typeof v !== "string") {
		throw new InvalidArgumentsError(`missing or non-string "${key}" argument`);
	}
	return v;
}

// Exported for unit testing. Validates and normalizes a vault-relative path
// supplied by the model. Rejects null bytes, absolute paths, and any single-
// or double-dot segment before running through Obsidian's normalizer (which
// collapses slashes but does NOT strip upward traversal — that's why the
// explicit segment check is the actual defense, not belt-and-braces).
export function sanitizePath(raw: string): string {
	const trimmed = raw.trim();
	if (trimmed === "" || trimmed === "/") return "";
	// Reject null bytes outright — they truncate strings in some underlying
	// OS calls and are never legitimate in a vault path.
	if (trimmed.includes("\0")) {
		throw new InvalidArgumentsError(`path contains a null byte: "${raw}"`);
	}
	// Fold Windows-style separators to posix before segment checks so a
	// model returning "..\\notes" can't bypass the ".." guard.
	const unified = trimmed.replace(/\\/g, "/");
	if (unified.startsWith("/")) {
		throw new InvalidArgumentsError(`path must be vault-relative, not absolute: "${raw}"`);
	}
	const segments = unified.split("/");
	if (segments.includes("..") || segments.includes(".")) {
		throw new InvalidArgumentsError(`path segment "." / ".." is not allowed: "${raw}"`);
	}
	// Final belt-and-braces: run through Obsidian's normalizer and make sure
	// the shape is unchanged (no upward traversal collapsed in).
	const normalized = normalizePath(unified.replace(/\/+$/, ""));
	if (normalized === "/" || normalized.startsWith("..")) {
		throw new InvalidArgumentsError(`invalid path after normalization: "${raw}"`);
	}
	return normalized;
}

const readNote: Tool = {
	spec: {
		type: "function",
		function: {
			name: "read_note",
			description:
				"Read the full markdown content of a note in the user's Obsidian vault. Paths are vault-relative (e.g. 'Ideas/monads.md').",
			parameters: {
				type: "object",
				properties: {
					path: {
						type: "string",
						description: "Vault-relative path to a markdown file, including the .md extension.",
					},
				},
				required: ["path"],
			},
		},
	},
	async run(args, ctx) {
		const rawPath = requireString(args, "path");
		const path = sanitizePath(rawPath);
		if (path === "") {
			throw new InvalidArgumentsError(`"path" cannot be empty`);
		}
		const file = ctx.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			throw new InvalidArgumentsError(`note not found: "${path}"`);
		}
		if (file.extension !== "md") {
			throw new InvalidArgumentsError(`not a markdown file: "${path}"`);
		}
		const raw = await ctx.app.vault.cachedRead(file);
		const truncated = raw.length > READ_CAP_BYTES;
		const content = truncated
			? raw.slice(0, READ_CAP_BYTES) +
			  `\n\n…[truncated, ${raw.length - READ_CAP_BYTES} more chars]`
			: raw;
		return JSON.stringify({
			path: file.path,
			size: raw.length,
			mtime: file.stat.mtime,
			truncated,
			content,
		});
	},
};

const listFolder: Tool = {
	spec: {
		type: "function",
		function: {
			name: "list_folder",
			description:
				"List markdown files and subfolders directly under a vault folder. Use path='' for the vault root.",
			parameters: {
				type: "object",
				properties: {
					path: {
						type: "string",
						description:
							"Vault-relative folder path. Empty string or '/' refers to the vault root.",
					},
				},
				required: ["path"],
			},
		},
	},
	async run(args, ctx) {
		const rawPath = requireString(args, "path");
		const path = sanitizePath(rawPath);
		let folder: TFolder;
		if (path === "") {
			folder = ctx.app.vault.getRoot();
		} else {
			const f = ctx.app.vault.getAbstractFileByPath(path);
			if (!(f instanceof TFolder)) {
				throw new InvalidArgumentsError(`folder not found: "${path}"`);
			}
			folder = f;
		}
		const folders: string[] = [];
		const notes: string[] = [];
		for (const child of folder.children) {
			// Skip dotfile children defensively — `.obsidian/`, `.git/`,
			// `.trash/`, user-created `.private/`, etc. shouldn't be exposed
			// to a model just because it asked for a directory listing.
			// Whether Obsidian's adapter exposes `.obsidian/` here is
			// adapter-dependent; this filter is cheap and forward-compatible.
			if (child.name.startsWith(".")) continue;
			if (child instanceof TFolder) {
				folders.push(child.path);
			} else if (child instanceof TFile && child.extension === "md") {
				notes.push(child.path);
			}
		}
		folders.sort();
		notes.sort();
		return JSON.stringify({ path: folder.path, folders, notes });
	},
};

export function buildVaultToolRegistry(): Map<string, Tool> {
	const registry = new Map<string, Tool>();
	registry.set(readNote.spec.function.name, readNote);
	registry.set(listFolder.spec.function.name, listFolder);
	return registry;
}

export function vaultToolSpecs(registry: Map<string, Tool>): ToolSpec[] {
	return Array.from(registry.values()).map((t) => t.spec);
}
