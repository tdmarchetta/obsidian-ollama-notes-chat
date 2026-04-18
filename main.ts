import { Editor, MarkdownView, Menu, Notice, Plugin, WorkspaceLeaf } from "obsidian";
import { OllamaClient } from "./src/ollama/OllamaClient";
import { ChatView, VIEW_TYPE_CHAT } from "./src/view/ChatView";
import { OllamaChatSettings, mergeSettings } from "./src/settings/Settings";
import { OllamaChatSettingTab } from "./src/settings/SettingsTab";
import { ConversationSnapshot } from "./src/chat/Conversation";

interface PersistedData {
	settings?: Partial<OllamaChatSettings>;
	conversation?: ConversationSnapshot;
}

export default class OllamaChatPlugin extends Plugin {
	settings!: OllamaChatSettings;
	ollama!: OllamaClient;

	private persistedConversation: ConversationSnapshot | null = null;

	async onload(): Promise<void> {
		await this.loadPersisted();
		this.ollama = new OllamaClient(this.settings.baseUrl);

		this.registerView(VIEW_TYPE_CHAT, (leaf) => new ChatView(leaf, this));

		this.addRibbonIcon("messages-square", "Open Ollama Notes Chat", () => {
			void this.activateView();
		});

		this.addCommand({
			id: "open-panel",
			name: "Open panel",
			callback: () => void this.activateView(),
		});

		this.addCommand({
			id: "clear-conversation",
			name: "Clear conversation",
			callback: () => {
				this.persistedConversation = null;
				void this.saveConversationRaw(null);
				for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT)) {
					const view = leaf.view;
					if (view instanceof ChatView) view.onSettingsChanged();
				}
				new Notice("Ollama Notes Chat conversation cleared");
			},
		});

		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor, view: MarkdownView) => {
				const selection = editor.getSelection();
				if (!selection) return;
				menu.addItem((item) =>
					item
						.setTitle("Ask Ollama Notes Chat about selection")
						.setIcon("messages-square")
						.onClick(async () => {
							await this.activateView();
							const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT)[0];
							const chat = leaf?.view;
							if (chat instanceof ChatView) {
								chat.prefillInput(selection);
							}
						}),
				);
			}),
		);

		this.addSettingTab(new OllamaChatSettingTab(this.app, this));
	}

	// ---------- persistence ----------

	private async loadPersisted(): Promise<void> {
		const raw = (await this.loadData()) as PersistedData | null;
		this.settings = mergeSettings(raw?.settings);
		this.persistedConversation = raw?.conversation ?? null;
	}

	async saveSettings(): Promise<void> {
		await this.savePersisted();
		this.ollama?.setBaseUrl(this.settings.baseUrl);
		this.notifyViews();
	}

	async saveConversation(conv: { toSnapshot: () => ConversationSnapshot }): Promise<void> {
		this.persistedConversation = conv.toSnapshot();
		await this.savePersisted();
	}

	async loadConversation(): Promise<ConversationSnapshot | null> {
		return this.persistedConversation;
	}

	private async saveConversationRaw(snapshot: ConversationSnapshot | null): Promise<void> {
		this.persistedConversation = snapshot;
		await this.savePersisted();
	}

	private async savePersisted(): Promise<void> {
		const data: PersistedData = {
			settings: this.settings,
			conversation: this.persistedConversation ?? undefined,
		};
		await this.saveData(data);
	}

	// ---------- views ----------

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_CHAT)[0] ?? null;
		if (!leaf) {
			leaf = workspace.getRightLeaf(false);
			if (!leaf) return;
			await leaf.setViewState({ type: VIEW_TYPE_CHAT, active: true });
		}
		workspace.revealLeaf(leaf);
	}

	notifyViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT)) {
			const view = leaf.view;
			if (view instanceof ChatView) view.onSettingsChanged();
		}
	}
}
