import { App, MarkdownView, TFile } from "obsidian";
import { ContextMode, OllamaChatSettings } from "../settings/Settings";

export interface BuiltContext {
	text: string;
	sourceNote: TFile | null;
	truncated: boolean;
	contributingNotes: TFile[];
}

export interface PerNoteFrontmatterOverride {
	systemPrompt?: string;
	model?: string;
}

export async function buildContext(
	app: App,
	mode: ContextMode,
	settings: OllamaChatSettings,
): Promise<BuiltContext> {
	const active = app.workspace.getActiveFile();

	if (mode === "none" || !active) {
		return { text: "", sourceNote: active, truncated: false, contributingNotes: [] };
	}

	if (mode === "current-selection") {
		const sel = getActiveSelection(app);
		if (sel && sel.trim().length > 0) {
			const block = formatBlock(active, sel, "selection");
			return finalize([block], [active], active, settings.truncationLimit);
		}
	}

	const activeBody = await readCleanBody(app, active, settings.includeFrontmatter);
	const activeBlock = formatBlock(active, activeBody, "note");

	if (mode === "current-note" || mode === "current-selection") {
		return finalize([activeBlock], [active], active, settings.truncationLimit);
	}

	// linked-notes: add one-hop linked notes
	const linked = resolveLinkedNotes(app, active);
	const blocks = [activeBlock];
	const contributors: TFile[] = [active];
	for (const file of linked) {
		const body = await readCleanBody(app, file, settings.includeFrontmatter);
		if (body.trim().length === 0) continue;
		blocks.push(formatBlock(file, body, "linked note"));
		contributors.push(file);
	}
	return finalize(blocks, contributors, active, settings.truncationLimit);
}

export function getPerNoteOverride(
	app: App,
	file: TFile | null,
): PerNoteFrontmatterOverride {
	if (!file) return {};
	const fm = app.metadataCache.getFileCache(file)?.frontmatter as
		| Record<string, unknown>
		| undefined;
	const ai = fm?.ai as Record<string, unknown> | undefined;
	if (!ai || typeof ai !== "object") return {};
	const out: PerNoteFrontmatterOverride = {};
	if (typeof ai.systemPrompt === "string") out.systemPrompt = ai.systemPrompt;
	if (typeof ai.model === "string") out.model = ai.model;
	return out;
}

function getActiveSelection(app: App): string | null {
	const view = app.workspace.getActiveViewOfType(MarkdownView);
	if (!view) return null;
	const editor = view.editor;
	if (!editor) return null;
	const sel = editor.getSelection();
	return sel.length > 0 ? sel : null;
}

async function readCleanBody(
	app: App,
	file: TFile,
	includeFrontmatter: boolean,
): Promise<string> {
	const raw = await app.vault.cachedRead(file);
	if (includeFrontmatter) return raw;
	return stripFrontmatter(raw);
}

function stripFrontmatter(raw: string): string {
	if (!raw.startsWith("---")) return raw;
	const end = raw.indexOf("\n---", 3);
	if (end < 0) return raw;
	const after = raw.indexOf("\n", end + 4);
	return after < 0 ? "" : raw.slice(after + 1);
}

function formatBlock(file: TFile, body: string, label: string): string {
	return `---\n${label}: ${file.path}\n---\n${body.trimEnd()}\n`;
}

function resolveLinkedNotes(app: App, file: TFile): TFile[] {
	const cache = app.metadataCache.getFileCache(file);
	const links = cache?.links ?? [];
	const seen = new Set<string>();
	const out: TFile[] = [];
	for (const l of links) {
		const target = app.metadataCache.getFirstLinkpathDest(l.link, file.path);
		if (!target || target.path === file.path) continue;
		if (seen.has(target.path)) continue;
		if (target.extension !== "md") continue;
		seen.add(target.path);
		out.push(target);
	}
	return out;
}

function finalize(
	blocks: string[],
	contributors: TFile[],
	source: TFile,
	limit: number,
): BuiltContext {
	const header =
		"The following block(s) are the user's Obsidian note context. Refer to them when answering.\n\n";
	const joined = header + blocks.join("\n");
	if (joined.length <= limit) {
		return {
			text: joined,
			sourceNote: source,
			truncated: false,
			contributingNotes: contributors,
		};
	}
	const notice = `\n\n[Context truncated from ${joined.length.toLocaleString()} to ${limit.toLocaleString()} characters — some content may be missing.]`;
	const head = joined.slice(0, limit - notice.length);
	return {
		text: head + notice,
		sourceNote: source,
		truncated: true,
		contributingNotes: contributors,
	};
}

