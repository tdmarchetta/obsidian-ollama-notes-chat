import { Editor, MarkdownView, Menu, Notice, Plugin, WorkspaceLeaf } from "obsidian";
import { OllamaClient } from "./src/ollama/OllamaClient";
import { ChatView, VIEW_TYPE_CHAT } from "./src/view/ChatView";
import { OllamaChatSettings, mergeSettings } from "./src/settings/Settings";
import { OllamaChatSettingTab } from "./src/settings/SettingsTab";
import { Conversation, ConversationSnapshot, deriveAutoTitle, newId } from "./src/chat/Conversation";
import { ConversationStore } from "./src/chat/ConversationStore";

const CURRENT_SCHEMA_VERSION = 2;

interface PersistedData {
	settings?: Partial<OllamaChatSettings>;
	conversations?: ConversationSnapshot[];
	activeConversationId?: string | null;
	schemaVersion?: number;
}

interface LegacyPersistedData extends PersistedData {
	conversation?: ConversationSnapshot;
}

export default class OllamaChatPlugin extends Plugin {
	settings!: OllamaChatSettings;
	ollama!: OllamaClient;
	store!: ConversationStore;

	async onload(): Promise<void> {
		await this.loadPersisted();
		this.ollama = new OllamaClient(this.settings.baseUrl);

		this.registerView(VIEW_TYPE_CHAT, (leaf) => new ChatView(leaf, this));

		this.addRibbonIcon("messages-square", "Open Ollama notes chat", () => {
			void this.activateView();
		});

		this.addCommand({
			id: "open-panel",
			name: "Open panel",
			callback: () => void this.activateView(),
		});

		this.addCommand({
			id: "new-chat",
			name: "New chat",
			callback: () => void this.createConversationAndFocus(),
		});

		this.addCommand({
			id: "open-history",
			name: "Open chat history",
			callback: () => void this.openHistoryInActiveView(),
		});

		this.addCommand({
			id: "clear-conversation",
			name: "Clear active conversation",
			callback: () => {
				const active = this.store.getActive();
				if (!active) {
					new Notice("No active conversation");
					return;
				}
				const cleared: ConversationSnapshot = {
					...active,
					title: active.titleManuallySet ? active.title : "",
					messages: [],
					updatedAt: Date.now(),
				};
				this.store.upsert(cleared);
				void this.savePersisted();
				this.notifyViews();
				new Notice("Active conversation cleared");
			},
		});

		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor, _view: MarkdownView) => {
				const selection = editor.getSelection();
				if (!selection) return;
				menu.addItem((item) =>
					item
						.setTitle("Ask Ollama notes chat about selection")
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
		const raw = (await this.loadData()) as LegacyPersistedData | null;
		this.settings = mergeSettings(raw?.settings);

		let conversations = (raw?.conversations ?? []).slice();
		let activeId: string | null | undefined = raw?.activeConversationId ?? null;
		let migrated = false;

		const needsMigration = !raw?.schemaVersion || raw.schemaVersion < CURRENT_SCHEMA_VERSION;
		if (needsMigration && raw?.conversation) {
			const legacy = raw.conversation;
			if (isLegacyConversationValid(legacy)) {
				const promoted: ConversationSnapshot = {
					id: newId(),
					title: deriveAutoTitle(legacy.messages) ?? "Previous chat",
					titleManuallySet: false,
					messages: legacy.messages,
					createdAt: legacy.createdAt,
					updatedAt: legacy.updatedAt,
				};
				conversations = [promoted, ...conversations];
				if (!activeId) activeId = promoted.id;
				migrated = true;
			} else {
				console.warn("[ollama-notes-chat] legacy conversation failed validation; skipping migration");
				migrated = true;
			}
		}

		this.store = new ConversationStore(conversations, activeId);

		if (migrated) await this.savePersisted();
	}

	async saveSettings(): Promise<void> {
		await this.savePersisted();
		this.ollama?.setBaseUrl(this.settings.baseUrl);
		this.notifyViews();
	}

	async saveActiveConversation(conv: Conversation): Promise<void> {
		this.store.upsert(conv.toSnapshot());
		await this.savePersisted();
	}

	async switchConversation(id: string): Promise<void> {
		this.store.setActive(id);
		await this.savePersisted();
		this.notifyViews();
	}

	async createConversation(): Promise<ConversationSnapshot> {
		const active = this.store.getActive();
		if (active && active.messages.length === 0) {
			this.store.setActive(active.id);
			return active;
		}
		const snap = this.store.createEmpty();
		await this.savePersisted();
		this.notifyViews();
		return snap;
	}

	async renameConversation(id: string, title: string): Promise<void> {
		const trimmed = title.trim();
		if (!trimmed) return;
		this.store.rename(id, trimmed);
		await this.savePersisted();
		this.notifyViews();
	}

	async deleteConversation(id: string): Promise<string | null> {
		const { nextActiveId } = this.store.delete(id);
		let finalActive = nextActiveId;
		if (!finalActive) {
			const fresh = this.store.createEmpty();
			finalActive = fresh.id;
		}
		await this.savePersisted();
		this.notifyViews();
		return finalActive;
	}

	private async savePersisted(): Promise<void> {
		const { conversations, activeConversationId } = this.store.toPersistable();
		const data: PersistedData = {
			settings: this.settings,
			conversations,
			activeConversationId,
			schemaVersion: CURRENT_SCHEMA_VERSION,
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
		void workspace.revealLeaf(leaf);
	}

	private async createConversationAndFocus(): Promise<void> {
		await this.activateView();
		await this.createConversation();
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT)) {
			const view = leaf.view;
			if (view instanceof ChatView) view.focusInput();
		}
	}

	private async openHistoryInActiveView(): Promise<void> {
		await this.activateView();
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT)) {
			const view = leaf.view;
			if (view instanceof ChatView) view.openHistoryDrawer();
		}
	}

	notifyViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT)) {
			const view = leaf.view;
			if (view instanceof ChatView) view.onSettingsChanged();
		}
	}
}

function isLegacyConversationValid(x: unknown): x is ConversationSnapshot {
	if (!x || typeof x !== "object") return false;
	const s = x as Partial<ConversationSnapshot>;
	return (
		Array.isArray(s.messages) &&
		typeof s.createdAt === "number" &&
		typeof s.updatedAt === "number"
	);
}
