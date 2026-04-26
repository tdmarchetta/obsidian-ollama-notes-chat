import { App, normalizePath } from "obsidian";
import { Conversation, type ConversationSnapshot } from "./Conversation";
import {
	renderMarkdown,
	sanitizeFolder,
	sanitizeFilename,
	fillFilenameTemplate,
	ensureFolder,
	uniquePath,
} from "./SaveAsNote";

export function renderJson(snapshots: ConversationSnapshot[]): string {
	return JSON.stringify(snapshots, null, 2);
}

export function filterByDateRange(
	snapshots: ConversationSnapshot[],
	startDate: string,
	endDate: string,
): ConversationSnapshot[] {
	const startMs = new Date(startDate + "T00:00:00.000Z").getTime();
	const endMs = new Date(endDate + "T23:59:59.999Z").getTime();
	if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
		throw new TypeError("Invalid date range");
	}
	return snapshots.filter((s) => s.updatedAt >= startMs && s.updatedAt <= endMs);
}

export async function exportToMarkdown(
	app: App,
	snapshots: ConversationSnapshot[],
	folder: string,
	filenameTemplate: string,
): Promise<number> {
	if (snapshots.length === 0) return 0;
	const folderPath = sanitizeFolder(folder);
	await ensureFolder(app, folderPath);
	let count = 0;
	for (const snap of snapshots) {
		const conv = Conversation.fromSnapshot(snap);
		const filename = sanitizeFilename(fillFilenameTemplate(filenameTemplate, conv.title));
		const combined = normalizePath(`${folderPath}/${filename}.md`);
		if (!combined.startsWith(`${folderPath}/`)) {
			throw new Error("Refusing to export: resolved path escapes target folder.");
		}
		const path = uniquePath(app, combined);
		const content = renderMarkdown(conv, conv.title || undefined);
		await app.vault.create(path, content);
		count++;
	}
	return count;
}

export async function exportToJson(
	app: App,
	snapshots: ConversationSnapshot[],
	folder: string,
): Promise<string> {
	const folderPath = sanitizeFolder(folder);
	await ensureFolder(app, folderPath);
	const now = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
	const filename = `ollama-export-${date}.json`;
	const combined = normalizePath(`${folderPath}/${filename}`);
	if (!combined.startsWith(`${folderPath}/`)) {
		throw new Error("Refusing to export: resolved path escapes target folder.");
	}
	const path = uniquePath(app, combined);
	await app.vault.create(path, renderJson(snapshots));
	return path;
}
