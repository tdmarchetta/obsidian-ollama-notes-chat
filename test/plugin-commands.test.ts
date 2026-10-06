import { setTimeout } from "node:timers";
import { describe, expect, it, vi } from "vitest";
import type { App, Command, PluginManifest, WorkspaceLeaf } from "obsidian";
import OllamaChatPlugin from "../main";
import { ChatView } from "../src/view/ChatView";
import { Conversation } from "../src/chat/Conversation";
import { DEFAULT_SETTINGS } from "../src/settings/Settings";

function setup() {
	const conv = new Conversation();
	conv.addUser("existing question");
	conv.addAssistant("existing answer");
	const commands = new Map<string, Command>();
	const plugin = new OllamaChatPlugin({} as App, {} as PluginManifest);
	let view: ChatView;
	Object.assign(plugin, {
		manifest: { id: "ollama-notes-chat" },
		app: { vault: { adapter: {}, on() {} }, workspace: {
			onLayoutReady() {}, on() {}, getLeavesOfType: () => [{ view }], revealLeaf() {},
		} },
		loadData: () => Promise.resolve({ settings: DEFAULT_SETTINGS, conversations: [conv.toSnapshot()], activeConversationId: conv.id, schemaVersion: 2 }),
		saveData: () => Promise.resolve(),
		registerEvent() {}, registerView() {}, addRibbonIcon() {}, addSettingTab() {}, registerEditorExtension() {},
		addCommand: (cmd: Command) => { commands.set(cmd.id, cmd); },
	});
	return plugin.onload().then(() => {
		view = new ChatView({} as WorkspaceLeaf, plugin);
		Object.assign(view, Object.fromEntries([
			"renderAllMessages", "updateStatus", "refreshTitle", "focusInput", "onSettingsChanged",
		].map((name) => [name, () => {}])));
		return { plugin, commands, view: view as unknown as { conv: Conversation; streaming: boolean } };
	});
}

describe("chat commands", () => {
	it("refuses a new chat during a response", async () => {
		const { plugin, view, commands } = await setup();
		view.streaming = true;
		const active = plugin.store.getActiveId();
		commands.get("new-chat")!.callback!();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(plugin.store.getActiveId()).toBe(active);
	});

	it("clearing a chat clears the live view as well as the saved conversation", async () => {
		const { plugin, view, commands } = await setup();
		commands.get("clear-conversation")!.callback!();
		await vi.waitFor(() => expect(plugin.store.getActive()!.messages).toEqual([]));
		expect(view.conv.messages).toEqual([]);
	});

	it("refuses to clear the active chat during a response", async () => {
		const { plugin, view, commands } = await setup();
		view.streaming = true;
		commands.get("clear-conversation")!.callback!();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(plugin.store.getActive()!.messages.map((m) => m.content)).toEqual(["existing question", "existing answer"]);
	});
});
