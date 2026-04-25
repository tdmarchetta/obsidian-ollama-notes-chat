import { App, Notice, TFile, normalizePath } from "obsidian";
import { Conversation } from "./Conversation";

export async function saveConversationAsNote(
	app: App,
	conversation: Conversation,
	folder: string,
	filenameTemplate: string,
	activeTitle?: string,
): Promise<TFile> {
	const folderPath = sanitizeFolder(folder);
	await ensureFolder(app, folderPath);

	const filename = sanitizeFilename(
		fillFilenameTemplate(filenameTemplate, activeTitle),
	);
	const combined = normalizePath(`${folderPath}/${filename}.md`);
	// Post-normalization escape check: Obsidian's normalizePath collapses
	// "." / ".." segments, so if a malicious filenameTemplate ever slipped a
	// traversal past sanitizeFilename we want the final path to still sit
	// under folderPath.
	if (!combined.startsWith(`${folderPath}/`)) {
		throw new Error("Refusing to save: resolved path escapes target folder.");
	}
	const path = uniquePath(app, combined);
	const content = renderMarkdown(conversation, activeTitle);
	const file = await app.vault.create(path, content);
	new Notice(`Saved chat to ${file.path}`);
	return file;
}

// The next three helpers and renderMarkdown are exported so unit tests can
// exercise the path/filename/YAML-safety logic without spinning up a real
// vault. They remain implementation details — main.ts and ChatView only
// reach into saveConversationAsNote().
export function sanitizeFolder(folder: string): string {
	const stripped = folder.replace(/^\/+|\/+$/g, "").trim();
	if (!stripped) return "Chats";
	// Reject any ".." segment explicitly — normalizePath does not strip
	// upward traversal, it just collapses slashes — then run through the
	// Obsidian normalizer to clean up the rest.
	const unified = stripped.replace(/\\/g, "/");
	const segments = unified.split("/");
	if (segments.some((s) => s === "..")) return "Chats";
	const normalized = normalizePath(unified);
	if (!normalized || normalized === "/" || normalized.startsWith("..")) return "Chats";
	return normalized;
}

function fillFilenameTemplate(template: string, activeTitle?: string): string {
	const now = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
	const time = `${pad(now.getHours())}${pad(now.getMinutes())}`;
	// Pre-sanitize the user-provided title before interpolation so the
	// replacement value cannot smuggle path separators or control chars.
	const safeTitle = sanitizeInterpolatedValue(activeTitle ?? "chat");
	return template
		.replaceAll("{{date}}", date)
		.replaceAll("{{time}}", time)
		.replaceAll("{{title}}", safeTitle);
}

function sanitizeInterpolatedValue(value: string): string {
	// Strip anything that would let the value act as a path segment or
	// filename-reserved glyph on any supported filesystem.
	// eslint-disable-next-line no-control-regex
	return value.replace(/[\\/:*?"<>|\x00-\x1f]/g, "-").trim() || "chat";
}

export function sanitizeFilename(name: string): string {
	// Collapse illegal glyphs and control chars, then strip leading dots so a
	// template like "{{title}}" evaluated to "../secret" cannot produce a
	// dotfile or traverse after concat with the folder.
	const cleaned = name
		// eslint-disable-next-line no-control-regex
		.replace(/[\\/:*?"<>|\x00-\x1f]/g, "-")
		.replace(/\s+/g, " ")
		.replace(/^[.\s]+/, "")
		.replace(/[.\s]+$/, "")
		.trim();
	return cleaned || "chat";
}

async function ensureFolder(app: App, folderPath: string): Promise<void> {
	const existing = app.vault.getAbstractFileByPath(folderPath);
	if (existing) return;
	try {
		await app.vault.createFolder(folderPath);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (!/already exists/i.test(msg)) throw err;
	}
}

function uniquePath(app: App, basePath: string): string {
	if (!app.vault.getAbstractFileByPath(basePath)) return basePath;
	const dot = basePath.lastIndexOf(".");
	const stem = basePath.slice(0, dot);
	const ext = basePath.slice(dot);
	let i = 2;
	while (app.vault.getAbstractFileByPath(`${stem} (${i})${ext}`)) i++;
	return `${stem} (${i})${ext}`;
}

export function renderMarkdown(conversation: Conversation, activeTitle?: string): string {
	const lines: string[] = [];
	lines.push("---");
	lines.push(`created: ${new Date(conversation.createdAt).toISOString()}`);
	lines.push(`updated: ${new Date(conversation.updatedAt).toISOString()}`);
	if (activeTitle) {
		// Escape `"`, `\`, and wikilink-closing `]]` so an unusual filename
		// can't break out of the YAML string or escape the wikilink target.
		// Collapse any vertical whitespace (CR/LF) to a single space FIRST —
		// YAML technically tolerates a multi-line double-quoted scalar, but
		// downstream Obsidian metadata-cache readers and third-party tools
		// have been known to mis-render it, so keep the value on one line.
		const safe = activeTitle
			.replace(/[\r\n]+/g, " ")
			.replace(/\\/g, "\\\\")
			.replace(/"/g, '\\"')
			.replace(/\]\]/g, "]\\]");
		lines.push(`source: "[[${safe}]]"`);
	}
	lines.push("tags: [ollama-chat]");
	lines.push("---");
	lines.push("");

	for (const m of conversation.messages) {
		if (m.role === "system") continue;
		const label = m.role === "user" ? "You" : "Ollama";
		const meta: string[] = [];
		if (m.role === "assistant" && m.model) meta.push(m.model);
		if (m.stopped) meta.push("stopped");
		const metaStr = meta.length ? ` _(${meta.join(" · ")})_` : "";
		lines.push(`### ${label}${metaStr}`);
		lines.push("");
		lines.push(m.content.trimEnd());
		lines.push("");
	}

	return lines.join("\n");
}
