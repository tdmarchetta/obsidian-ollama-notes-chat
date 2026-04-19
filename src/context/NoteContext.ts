import { App, MarkdownView, TFile } from "obsidian";
import { OllamaClient } from "../ollama/OllamaClient";
import { VectorStore } from "../rag/VectorStore";
import { ContextMode, OllamaChatSettings } from "../settings/Settings";

export type RetrievalStatus = "ok" | "empty-index" | "no-model" | "no-query" | "embed-failed";

export interface BuiltContext {
	text: string;
	sourceNote: TFile | null;
	truncated: boolean;
	contributingNotes: TFile[];
	retrievalStatus?: RetrievalStatus;
}

export interface PerNoteFrontmatterOverride {
	systemPrompt?: string;
	model?: string;
	rewriteSystemPrompt?: string;
	rewriteDisabled?: boolean;
	toolsDisabled?: boolean;
}

export interface RetrievalDeps {
	query?: string;
	vectorStore?: VectorStore;
	ollama?: OllamaClient;
}

export async function buildContext(
	app: App,
	mode: ContextMode,
	settings: OllamaChatSettings,
	retrieval?: RetrievalDeps,
): Promise<BuiltContext> {
	const active = app.workspace.getActiveFile();

	if (mode === "retrieval") {
		return buildRetrievalContext(app, settings, active, retrieval);
	}

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
	if (typeof ai.rewriteSystemPrompt === "string") out.rewriteSystemPrompt = ai.rewriteSystemPrompt;
	if (typeof ai.rewriteDisabled === "boolean") out.rewriteDisabled = ai.rewriteDisabled;
	if (typeof ai.toolsDisabled === "boolean") out.toolsDisabled = ai.toolsDisabled;
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

async function buildRetrievalContext(
	app: App,
	settings: OllamaChatSettings,
	active: TFile | null,
	deps: RetrievalDeps | undefined,
): Promise<BuiltContext> {
	const base: BuiltContext = {
		text: "",
		sourceNote: active,
		truncated: false,
		contributingNotes: [],
	};
	if (!settings.embedderModel) return { ...base, retrievalStatus: "no-model" };
	const query = deps?.query?.trim();
	if (!query) return { ...base, retrievalStatus: "no-query" };
	if (!deps?.vectorStore || !deps.ollama) {
		return { ...base, retrievalStatus: "empty-index" };
	}
	if (deps.vectorStore.stats().chunks === 0) {
		return { ...base, retrievalStatus: "empty-index" };
	}
	let queryVec: number[];
	try {
		const result = await deps.ollama.embed(settings.embedderModel, query);
		queryVec = result[0];
	} catch (err) {
		console.warn("[ollama-notes-chat] query embed failed", err);
		return { ...base, retrievalStatus: "embed-failed" };
	}
	const hits = deps.vectorStore.topK(queryVec, settings.ragTopK);
	if (hits.length === 0) {
		return { ...base, retrievalStatus: "empty-index" };
	}
	const blocks: string[] = [];
	const contributors: TFile[] = [];
	const seenPaths = new Set<string>();
	for (const hit of hits) {
		const citation = formatCitation(hit.notePath, hit.chunk.heading);
		blocks.push(`From ${citation}:\n${hit.chunk.text.trim()}\n`);
		if (!seenPaths.has(hit.notePath)) {
			seenPaths.add(hit.notePath);
			const f = app.vault.getAbstractFileByPath(hit.notePath);
			if (f instanceof TFile) contributors.push(f);
		}
	}
	const sourceForContext = contributors[0] ?? active;
	if (!sourceForContext) return { ...base, retrievalStatus: "empty-index" };
	const finalized = finalize(blocks, contributors, sourceForContext, settings.truncationLimit);
	return { ...finalized, retrievalStatus: "ok" };
}

function formatCitation(notePath: string, heading?: string): string {
	const basename = notePath.replace(/\.md$/, "").split("/").pop() ?? notePath;
	if (heading && heading.length > 0) {
		return `[[${basename}#${heading}]]`;
	}
	return `[[${basename}]]`;
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

