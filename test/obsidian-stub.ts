// Minimal stand-in for the `obsidian` runtime so vitest can import the
// plugin's source modules without the full Electron host. We only ship
// the surface area the unit tests actually touch — keep it small.

/**
 * Mirrors the subset of Obsidian's normalizePath the plugin relies on:
 * fold backslashes to forward, collapse repeated slashes, drop trailing
 * slash. Crucially does NOT URL-decode and does NOT collapse "."/".."
 * segments — that's what our defense-in-depth rejection in sanitizePath
 * relies on and the production normalizePath behaves the same way.
 */
export function normalizePath(p: string): string {
	let s = p.replace(/\\/g, "/").replace(/\/+/g, "/");
	if (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
	return s;
}

export class TAbstractFile {
	name = "";
	path = "";
	parent: TFolder | null = null;
}

export class TFile extends TAbstractFile {
	extension = "";
	stat: { mtime: number; size: number; ctime: number } = {
		mtime: 0,
		size: 0,
		ctime: 0,
	};
}

export class TFolder extends TAbstractFile {
	children: TAbstractFile[] = [];
}

export class Notice {
	constructor(_message: string, _timeout?: number) {
		// no-op in tests
	}
	hide(): void {
		// no-op
	}
}

export interface DataAdapter {
	read(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
	exists(path: string): Promise<boolean>;
	rename(oldPath: string, newPath: string): Promise<void>;
	remove(path: string): Promise<void>;
}

export function requestUrl(_opts: unknown): Promise<unknown> {
	throw new Error("requestUrl is not available in vitest");
}

// Empty class stubs for type-only imports. Tests that need real behavior
// from these construct their own fakes locally.
export class App {}
export class Plugin {}
export class PluginSettingTab {}
export class Setting {}
export class Modal {}
export class MarkdownView {}
export class Menu {}
export class Editor {}
export class WorkspaceLeaf {}
export class ItemView {}
export class FuzzySuggestModal {}

// requestUrl response shape (only used as a type at the call sites).
export interface RequestUrlResponse {
	status: number;
	json: unknown;
	text: string;
}
