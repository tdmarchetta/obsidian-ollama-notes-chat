import { afterEach, describe, expect, it, vi } from "vitest";
import type { App, WorkspaceLeaf } from "obsidian";
import type OllamaChatPlugin from "../../main";
import { ChatView } from "./ChatView";
import { Conversation } from "../chat/Conversation";
import { ConversationStore } from "../chat/ConversationStore";
import { DEFAULT_SETTINGS } from "../settings/Settings";
import { buildContext, type BuiltContext } from "../context/NoteContext";

vi.mock("../context/NoteContext", async (importOriginal) => ({
	...await importOriginal<typeof import("../context/NoteContext")>(),
	buildContext: vi.fn(),
}));

// Keep real conversation/send logic; replace only rendering and external I/O.
interface ViewHarness {
	conv: Conversation;
	inputEl: { value: string };
	streaming: boolean;
	sendMessage(): Promise<void>;
	stopGeneration(): void;
	newChat(): Promise<void>;
	switchToConversation(id: string): Promise<void>;
	clearConversation(): void;
	deleteConversationFromView(id: string): Promise<void>;
}
const emptyContext: BuiltContext = { text: "", sourceNote: null, truncated: false, contributingNotes: [] };
function setup() {
	const store = new ConversationStore([]);
	const requests: unknown[] = [];
	const plugin = {
		store,
		settings: { ...DEFAULT_SETTINGS, model: "test", defaultContextMode: "none", toolsEnabled: false },
		ollama: { chatStream: async function* (request: unknown) { requests.push(request); yield { type: "delta", text: "reply" }; } },
		saveActiveConversation: (conv: Conversation) => { store.upsert(conv.toSnapshot()); return Promise.resolve(); },
		createConversation: () => { store.createEmpty(); return Promise.resolve(); },
		deleteConversation: (id: string) => Promise.resolve(store.delete(id).nextActiveId),
		switchConversation: (id: string) => { store.setActive(id); return Promise.resolve(); },
	} as unknown as OllamaChatPlugin;
	const view = new ChatView({} as WorkspaceLeaf, plugin);
	Object.assign(view, {
		app: {} as App,
		inputEl: { value: "question" }, completionsEl: { hide() {} },
		...Object.fromEntries([
			"renderMessage", "renderAllMessages", "refreshEmptyState", "autosizeInput", "updateStatus",
			"scrollToBottom", "setSendButtonState", "scheduleMarkdownRender", "flushMarkdownRender",
			"refreshTitle", "maybeAutoSave", "focusInput",
		].map((name) => [name, () => {}])),
	});
	return { view: view as unknown as ViewHarness, store, requests, plugin };
}
afterEach(() => vi.resetAllMocks());

describe("chat request lifecycle", () => {
	it("does not send twice while context is still loading", async () => {
		let resolve!: (context: BuiltContext) => void;
		vi.mocked(buildContext).mockReturnValue(new Promise((r) => { resolve = r; }));
		const { view, requests } = setup();
		const first = view.sendMessage();
		const second = view.sendMessage();
		resolve(emptyContext);
		await Promise.all([first, second]);
		expect(requests).toHaveLength(1);
		expect(view.conv.messages.map((m) => m.content)).toEqual(["question", "reply"]);
	});

	it("stopping during context loading prevents the request and preserves the draft", async () => {
		let resolve!: (context: BuiltContext) => void;
		vi.mocked(buildContext).mockReturnValue(new Promise((r) => { resolve = r; }));
		const { view, requests } = setup();
		const send = view.sendMessage();
		view.stopGeneration();
		resolve(emptyContext);
		await send;
		expect(requests).toEqual([]);
		expect(view.conv.messages).toEqual([]);
		expect(view.inputEl.value).toBe("question");
		expect(view.streaming).toBe(false);
	});

	it("keeps the current chat while its context is loading", async () => {
		let resolve!: (context: BuiltContext) => void;
		vi.mocked(buildContext).mockReturnValue(new Promise((r) => { resolve = r; }));
		const { view } = setup();
		const id = view.conv.id;
		const send = view.sendMessage();
		await view.newChat();
		resolve(emptyContext);
		await send;
		expect(view.conv.id).toBe(id);
	});

	it("recovers from a context read failure without losing the draft", async () => {
		vi.mocked(buildContext).mockRejectedValueOnce(new Error("read failed")).mockResolvedValue(emptyContext);
		const { view, requests } = setup();
		await expect(view.sendMessage()).resolves.toBeUndefined();
		expect(view.inputEl.value).toBe("question");
		expect(view.streaming).toBe(false);
		await view.sendMessage();
		expect(requests).toHaveLength(1);
	});
});


describe("history deletion", () => {
	it("deleting another chat does not discard the active response in progress", async () => {
		const { view, store } = setup();
		const other = new Conversation();
		other.addUser("old chat");
		store.upsert(other.toSnapshot());
		view.conv.addUser("current question");
		view.conv.addAssistant("partial answer");
		view.streaming = true;
		await view.deleteConversationFromView(other.id);
		expect(store.get(other.id)).toBeUndefined();
		expect(view.conv.messages.map((m) => m.content)).toEqual(["current question", "partial answer"]);
	});
});


it.each(["new", "switch", "delete"] as const)("preserves the draft while a %s chat transition is saving", async (operation) => {
	vi.mocked(buildContext).mockResolvedValue(emptyContext);
	const { view, store, requests, plugin } = setup();
	const target = new Conversation();
	target.addUser("other question");
	store.upsert(target.toSnapshot());
	let finish!: () => void;
	const saved = new Promise<void>((resolve) => { finish = resolve; });
	plugin.createConversation = async () => {
		const snap = store.createEmpty();
		await saved;
		return snap;
	};
	plugin.switchConversation = async (id: string) => { store.setActive(id); await saved; };
	plugin.deleteConversation = async (id: string) => {
		const next = store.delete(id).nextActiveId;
		await saved;
		return next;
	};
	const transition = operation === "new" ? view.newChat()
		: operation === "switch" ? view.switchToConversation(target.id)
		: view.deleteConversationFromView(view.conv.id);
	await view.sendMessage();
	finish();
	await transition;
	expect(requests).toEqual([]);
	expect(view.inputEl.value).toBe("question");
});
