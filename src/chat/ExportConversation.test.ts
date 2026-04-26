import { describe, expect, it, vi } from "vitest";
import { App } from "obsidian";
import type { ConversationSnapshot } from "./Conversation";
import {
	renderJson,
	filterByDateRange,
	exportToMarkdown,
	exportToJson,
} from "./ExportConversation";

function makeApp(existingPaths: string[] = []) {
	const create = vi.fn().mockResolvedValue({ path: "fake/path.md" });
	const createFolder = vi.fn().mockResolvedValue(undefined);
	const getAbstractFileByPath = vi.fn((p: string) =>
		existingPaths.includes(p) ? {} : null,
	);
	const app = {
		vault: { getAbstractFileByPath, create, createFolder },
	} as unknown as App;
	return { app, create };
}

function makeSnapshot(overrides: Partial<ConversationSnapshot> = {}): ConversationSnapshot {
	return {
		id: "test-id",
		title: "Test Conversation",
		titleManuallySet: false,
		messages: [
			{
				id: "m1",
				role: "user",
				content: "Hello",
				createdAt: 1000,
			},
		],
		createdAt: 1000,
		updatedAt: 1000,
		...overrides,
	};
}

// 2026-01-15 UTC midnight
const JAN_15_START = new Date("2026-01-15T00:00:00.000Z").getTime();
// 2026-01-15 UTC end-of-day
const JAN_15_END = new Date("2026-01-15T23:59:59.999Z").getTime();
// 2026-01-20 UTC end-of-day
const JAN_20_END = new Date("2026-01-20T23:59:59.999Z").getTime();

describe("renderJson", () => {
	it("round-trips a snapshot array", () => {
		const snap = makeSnapshot();
		const result = JSON.parse(renderJson([snap])) as ConversationSnapshot[];
		expect(result).toHaveLength(1);
		expect(result[0].id).toBe("test-id");
		expect(result[0].title).toBe("Test Conversation");
	});

	it("handles an empty array", () => {
		expect(JSON.parse(renderJson([]))).toEqual([]);
	});

	it("uses 2-space indentation", () => {
		const result = renderJson([makeSnapshot()]);
		expect(result).toContain('  "id"');
	});
});

describe("filterByDateRange", () => {
	const snaps = [
		makeSnapshot({ id: "before", updatedAt: JAN_15_START - 1 }),
		makeSnapshot({ id: "start-exact", updatedAt: JAN_15_START }),
		makeSnapshot({ id: "mid", updatedAt: JAN_15_START + 10000 }),
		makeSnapshot({ id: "end-exact", updatedAt: JAN_15_END }),
		makeSnapshot({ id: "after", updatedAt: JAN_15_END + 1 }),
	];

	it("includes snapshots within the range (inclusive on both ends)", () => {
		const result = filterByDateRange(snaps, "2026-01-15", "2026-01-15");
		const ids = result.map((s) => s.id);
		expect(ids).toContain("start-exact");
		expect(ids).toContain("mid");
		expect(ids).toContain("end-exact");
	});

	it("excludes snapshots outside the range", () => {
		const result = filterByDateRange(snaps, "2026-01-15", "2026-01-15");
		const ids = result.map((s) => s.id);
		expect(ids).not.toContain("before");
		expect(ids).not.toContain("after");
	});

	it("returns empty array when no snapshots match", () => {
		const result = filterByDateRange(snaps, "2030-01-01", "2030-01-02");
		expect(result).toHaveLength(0);
	});

	it("spans multiple days correctly", () => {
		const multiSnaps = [
			makeSnapshot({ id: "jan15", updatedAt: JAN_15_START }),
			makeSnapshot({ id: "jan20", updatedAt: JAN_20_END }),
		];
		const result = filterByDateRange(multiSnaps, "2026-01-15", "2026-01-20");
		expect(result.map((s) => s.id)).toEqual(["jan15", "jan20"]);
	});

	it("throws TypeError for an invalid start date", () => {
		expect(() => filterByDateRange(snaps, "not-a-date", "2026-01-15")).toThrow(TypeError);
		expect(() => filterByDateRange(snaps, "not-a-date", "2026-01-15")).toThrow(
			"Invalid date range",
		);
	});

	it("throws TypeError for an invalid end date", () => {
		expect(() => filterByDateRange(snaps, "2026-01-15", "bad")).toThrow(TypeError);
	});
});

describe("exportToMarkdown", () => {
	it("calls vault.create once per snapshot", async () => {
		const { app, create } = makeApp();
		const snaps = [makeSnapshot({ id: "a" }), makeSnapshot({ id: "b" })];
		const count = await exportToMarkdown(app, snaps, "Chats", "{{date}} — {{title}}");
		expect(count).toBe(2);
		expect(create).toHaveBeenCalledTimes(2);
	});

	it("returns 0 and makes no vault calls for an empty array", async () => {
		const { app, create } = makeApp();
		const count = await exportToMarkdown(app, [], "Chats", "{{date}} — {{title}}");
		expect(count).toBe(0);
		expect(create).not.toHaveBeenCalled();
	});

	it("created paths start with the sanitized folder", async () => {
		const { app, create } = makeApp();
		await exportToMarkdown(app, [makeSnapshot()], "Chats/Exports", "{{date}} — {{title}}");
		const calledPath = create.mock.calls[0][0] as string;
		expect(calledPath.startsWith("Chats/Exports/")).toBe(true);
	});

	it("sanitizes a traversal folder to 'Chats'", async () => {
		const { app, create } = makeApp();
		await exportToMarkdown(app, [makeSnapshot()], "../evil", "{{title}}");
		const calledPath = create.mock.calls[0][0] as string;
		expect(calledPath.startsWith("Chats/")).toBe(true);
	});
});

describe("exportToJson", () => {
	it("calls vault.create exactly once", async () => {
		const { app, create } = makeApp();
		await exportToJson(app, [makeSnapshot(), makeSnapshot({ id: "b" })], "Chats");
		expect(create).toHaveBeenCalledTimes(1);
	});

	it("filename matches the ollama-export-YYYY-MM-DD.json pattern", async () => {
		const { app, create } = makeApp();
		await exportToJson(app, [makeSnapshot()], "Chats");
		const calledPath = create.mock.calls[0][0] as string;
		expect(calledPath).toMatch(/ollama-export-\d{4}-\d{2}-\d{2}\.json$/);
	});

	it("written content is valid JSON containing the snapshots", async () => {
		const snap = makeSnapshot();
		const { app, create } = makeApp();
		await exportToJson(app, [snap], "Chats");
		const content = create.mock.calls[0][1] as string;
		const parsed = JSON.parse(content) as ConversationSnapshot[];
		expect(parsed).toHaveLength(1);
		expect(parsed[0].id).toBe("test-id");
	});

	it("deduplicates filename when path already exists", async () => {
		const existingDate = new Date();
		const pad = (n: number) => String(n).padStart(2, "0");
		const d = `${existingDate.getFullYear()}-${pad(existingDate.getMonth() + 1)}-${pad(existingDate.getDate())}`;
		const { app } = makeApp([`Chats/ollama-export-${d}.json`]);
		const path = await exportToJson(app, [makeSnapshot()], "Chats");
		expect(path).not.toBe(`Chats/ollama-export-${d}.json`);
	});
});
