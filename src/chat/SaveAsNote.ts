import { App, Notice, TFile, normalizePath } from "obsidian";
import { Conversation } from "./Conversation";

export async function saveConversationAsNote(
	app: App,
	conversation: Conversation,
	folder: string,
	filenameTemplate: string,
	activeTitle?: string,
): Promise<TFile> {
	const folderPath = normalizePath(folder.replace(/^\/+|\/+$/g, "") || "Chats");
	await ensureFolder(app, folderPath);

	const filename = sanitizeFilename(
		fillFilenameTemplate(filenameTemplate, activeTitle),
	);
	const path = uniquePath(app, `${folderPath}/${filename}.md`);
	const content = renderMarkdown(conversation, activeTitle);
	const file = await app.vault.create(path, content);
	new Notice(`Saved chat to ${file.path}`);
	return file;
}

function fillFilenameTemplate(template: string, activeTitle?: string): string {
	const now = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
	const time = `${pad(now.getHours())}${pad(now.getMinutes())}`;
	return template
		.replaceAll("{{date}}", date)
		.replaceAll("{{time}}", time)
		.replaceAll("{{title}}", activeTitle ?? "chat");
}

function sanitizeFilename(name: string): string {
	return (
		name
			.replace(/[\\/:*?"<>|]/g, "-")
			.replace(/\s+/g, " ")
			.trim() || "chat"
	);
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

function renderMarkdown(conversation: Conversation, activeTitle?: string): string {
	const lines: string[] = [];
	lines.push("---");
	lines.push(`created: ${new Date(conversation.createdAt).toISOString()}`);
	lines.push(`updated: ${new Date(conversation.updatedAt).toISOString()}`);
	if (activeTitle) lines.push(`source: "[[${activeTitle}]]"`);
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
