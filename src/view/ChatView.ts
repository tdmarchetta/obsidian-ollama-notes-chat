import {
	ItemView,
	MarkdownRenderer,
	MarkdownView,
	Notice,
	WorkspaceLeaf,
	setIcon,
	setTooltip,
} from "obsidian";
import type OllamaChatPlugin from "../../main";
import { Conversation, Message } from "../chat/Conversation";
import { buildContext, getPerNoteOverride } from "../context/NoteContext";
import { ChatMessage } from "../ollama/OllamaClient";
import { ContextMode, contextLimitForModel } from "../settings/Settings";
import { saveConversationAsNote } from "../chat/SaveAsNote";
import { expandTemplate, matchingCompletions, parseSlash } from "../chat/SlashCommands";
import { StatsModal } from "./StatsModal";
import { HistoryDrawer } from "./HistoryDrawer";

export const VIEW_TYPE_CHAT = "ollama-notes-chat-view";

const CONTEXT_MODE_ORDER: ContextMode[] = [
	"current-note",
	"current-selection",
	"linked-notes",
	"retrieval",
	"none",
];

const CONTEXT_MODE_LABEL: Record<ContextMode, string> = {
	none: "No context",
	"current-note": "Current note",
	"current-selection": "Current selection",
	"linked-notes": "Current + linked notes",
	retrieval: "Retrieved passages",
};

export class ChatView extends ItemView {
	private plugin: OllamaChatPlugin;
	private conv: Conversation;
	private contextMode: ContextMode;

	private abortController: AbortController | null = null;
	private streaming = false;

	private titleEl!: HTMLElement;
	private subheaderEl!: HTMLElement;
	private listEl!: HTMLElement;
	private emptyStateEl!: HTMLElement;
	private inputEl!: HTMLTextAreaElement;
	private statusLineEl!: HTMLElement;
	private sendBtn!: HTMLButtonElement;
	private completionsEl!: HTMLElement;

	private historyDrawer: HistoryDrawer | null = null;

	private markdownContainers = new WeakMap<Message, HTMLElement>();
	private pendingRenderTimer: number | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: OllamaChatPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.conv = plugin.store.hydrateActive();
		this.contextMode = plugin.settings.defaultContextMode;
	}

	getViewType(): string {
		return VIEW_TYPE_CHAT;
	}

	getDisplayText(): string {
		return "Ollama notes chat";
	}

	getIcon(): string {
		return "messages-square";
	}

	onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass("ollama-chat-view");
		this.applyFontSize();

		const header = root.createDiv({ cls: "ollama-chat-header" });

		const leftActions = header.createDiv({ cls: "ollama-chat-header-left" });
		this.iconButton(leftActions, "panel-left-open", "Chat history", () =>
			this.toggleHistoryDrawer(),
		);

		this.titleEl = header.createDiv({ cls: "ollama-chat-title" });
		this.titleEl.setAttr("role", "button");
		this.titleEl.setAttr("tabindex", "0");
		this.titleEl.addEventListener("click", () => this.startTitleRename());
		this.titleEl.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter" || evt.key === " ") {
				evt.preventDefault();
				this.startTitleRename();
			}
		});
		this.refreshTitle();

		const actions = header.createDiv({ cls: "ollama-chat-header-actions" });

		this.iconButton(actions, "plus", "New chat", () => void this.newChat());
		this.iconButton(actions, "trash-2", "Clear active chat", () => this.clearConversation());
		this.iconButton(actions, "download", "Save as note", () => void this.saveAsNote());
		this.iconButton(actions, "settings", "Open plugin settings", () => this.openSettings());

		this.subheaderEl = root.createDiv({ cls: "ollama-chat-subheader" });
		this.subheaderEl.setAttr("role", "button");
		this.subheaderEl.setAttr("tabindex", "0");
		setTooltip(this.subheaderEl, "Click to cycle context mode");
		this.subheaderEl.addEventListener("click", () => this.cycleContextMode());
		this.subheaderEl.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter" || evt.key === " ") {
				evt.preventDefault();
				this.cycleContextMode();
			}
		});

		this.listEl = root.createDiv({ cls: "ollama-chat-list" });
		this.emptyStateEl = this.listEl.createDiv({ cls: "ollama-chat-empty" });
		this.buildEmptyState();
		this.registerDomEvent(this.listEl, "click", (evt) => this.handleLinkClick(evt));

		const inputWrap = root.createDiv({ cls: "ollama-chat-input-wrap" });
		this.completionsEl = inputWrap.createDiv({ cls: "ollama-chat-completions" });
		this.completionsEl.hide();

		const composer = inputWrap.createDiv({ cls: "ollama-chat-composer" });
		this.inputEl = composer.createEl("textarea", {
			cls: "ollama-chat-input",
			attr: { rows: "1", placeholder: "Ask about this note…" },
		});
		this.inputEl.addEventListener("keydown", (evt) => this.onInputKeydown(evt));
		this.inputEl.addEventListener("input", () => {
			this.autosizeInput();
			this.updateCompletions();
			this.updateStatus();
		});
		this.sendBtn = composer.createEl("button", {
			cls: "ollama-chat-send",
			attr: { "aria-label": "Send" },
		});
		setIcon(this.sendBtn, "arrow-up");
		this.sendBtn.addEventListener("click", () => void this.onSendOrStop());

		const statusRow = inputWrap.createDiv({ cls: "ollama-chat-status-row" });
		this.statusLineEl = statusRow.createSpan({ cls: "ollama-chat-status" });

		this.refreshSubheader();
		this.updateStatus();
		this.updateInputPlaceholder();

		this.conv = this.plugin.store.hydrateActive();
		this.renderAllMessages();
		this.refreshEmptyState();
		this.refreshTitle();
		this.scrollToBottom();
		return Promise.resolve();
	}

	onClose(): Promise<void> {
		this.stopGeneration();
		this.historyDrawer?.destroy();
		this.historyDrawer = null;
		return Promise.resolve();
	}

	onSettingsChanged(): void {
		this.applyFontSize();
		this.refreshSubheader();
		this.updateStatus();
		this.updateInputPlaceholder();
		this.maybeRehydrateActive();
		this.historyDrawer?.scheduleRefresh();
	}

	focusInput(): void {
		this.inputEl?.focus();
	}

	openHistoryDrawer(): void {
		this.ensureHistoryDrawer();
		this.historyDrawer?.open();
	}

	prefillInput(text: string, send = false): void {
		this.inputEl.value = text;
		this.autosizeInput();
		this.updateStatus();
		this.inputEl.focus();
		if (send) void this.sendMessage();
	}

	// ---------- rendering ----------

	private buildEmptyState(): void {
		this.emptyStateEl.empty();
		this.emptyStateEl.createDiv({
			cls: "ollama-chat-empty-title",
			text: "Ask about this note",
		});
		const hint = this.emptyStateEl.createDiv({ cls: "ollama-chat-empty-hint" });
		hint.setText("Ollama streams tokens live. Try a preset:");
		const presets = this.emptyStateEl.createDiv({ cls: "ollama-chat-presets" });
		const picks = this.plugin.settings.slashCommands.slice(0, 4);
		for (const cmd of picks) {
			const btn = presets.createEl("button", {
				cls: "ollama-chat-preset",
				text: `/${cmd.name}`,
			});
			btn.addEventListener("click", () => {
				this.inputEl.value = `/${cmd.name} `;
				this.autosizeInput();
				this.inputEl.focus();
			});
		}
	}

	private refreshEmptyState(): void {
		this.emptyStateEl.toggle(this.conv.isEmpty);
	}

	private refreshSubheader(): void {
		const label = CONTEXT_MODE_LABEL[this.contextMode];
		const model = this.plugin.settings.model || "no model";
		this.subheaderEl.empty();
		this.subheaderEl.createSpan({ text: `Context: ${label}` });
		this.subheaderEl.createSpan({ text: " · " });
		this.subheaderEl.createSpan({ text: model });
	}

	private applyFontSize(): void {
		this.contentEl.removeClass(
			"ollama-font-small",
			"ollama-font-medium",
			"ollama-font-large",
			"ollama-compact",
		);
		const s = this.plugin.settings;
		if (s.fontSize === "small") this.contentEl.addClass("ollama-font-small");
		if (s.fontSize === "medium") this.contentEl.addClass("ollama-font-medium");
		if (s.fontSize === "large") this.contentEl.addClass("ollama-font-large");
		if (s.compactMode) this.contentEl.addClass("ollama-compact");
	}

	private iconButton(
		parent: HTMLElement,
		icon: string,
		tooltip: string,
		onClick: () => void,
	): HTMLButtonElement {
		const btn = parent.createEl("button", { cls: "ollama-chat-icon-btn clickable-icon" });
		setIcon(btn, icon);
		setTooltip(btn, tooltip);
		btn.addEventListener("click", onClick);
		return btn;
	}

	private renderAllMessages(): void {
		const anchor = this.emptyStateEl;
		Array.from(this.listEl.children).forEach((child) => {
			if (child !== anchor) child.remove();
		});
		this.markdownContainers = new WeakMap();
		for (const m of this.conv.messages) {
			if (m.role === "system") continue;
			this.renderMessage(m);
		}
		this.refreshEmptyState();
	}

	private renderMessage(m: Message): HTMLElement {
		const wrap = this.listEl.createDiv({
			cls: `ollama-chat-msg ollama-chat-msg-${m.role}`,
		});

		const label = wrap.createDiv({ cls: "ollama-chat-msg-label" });
		label.setText(m.role === "user" ? "You" : "Ollama");

		const body = wrap.createDiv({ cls: "ollama-chat-msg-body markdown-rendered" });
		this.markdownContainers.set(m, body);
		this.renderMarkdownInto(body, m.content);

		if (m.role === "assistant") {
			const actions = wrap.createDiv({ cls: "ollama-chat-msg-actions" });
			this.iconButton(actions, "copy", "Copy response", () => void this.copyMessage(m));
			this.iconButton(actions, "file-plus", "Insert into note", () => this.insertIntoNote(m));
			this.iconButton(actions, "refresh-cw", "Regenerate", () => void this.regenerate(m));
			this.iconButton(actions, "bar-chart-3", "Response stats", () => this.showStats(m));
		}
		return wrap;
	}

	private showStats(m: Message): void {
		if (!m.stats) {
			new Notice("Stats not available for this response.");
			return;
		}
		new StatsModal(this.app, m.stats, m).open();
	}

	private renderMarkdownInto(el: HTMLElement, markdown: string): void {
		el.empty();
		if (!markdown || markdown.length === 0) {
			el.createDiv({ cls: "ollama-chat-placeholder", text: "…" });
			return;
		}
		const sourcePath = this.app.workspace.getActiveFile()?.path ?? "";
		void MarkdownRenderer.render(this.app, markdown, el, sourcePath, this);
	}

	private handleLinkClick(evt: MouseEvent): void {
		const target = evt.target as HTMLElement | null;
		if (!target) return;
		const anchor = target.closest("a");
		if (!anchor) return;

		// Internal Obsidian link: [[Note]] or [[Note#^block]]
		if (anchor.classList.contains("internal-link")) {
			evt.preventDefault();
			const linkText =
				anchor.getAttribute("data-href") ?? anchor.getAttribute("href") ?? "";
			if (!linkText) return;
			const sourcePath = this.app.workspace.getActiveFile()?.path ?? "";
			void this.app.workspace.openLinkText(linkText, sourcePath, true);
			return;
		}

		// External http(s) link: open in default browser
		if (anchor.classList.contains("external-link")) {
			evt.preventDefault();
			const href = anchor.getAttribute("href");
			if (href) window.open(href, "_blank");
		}
	}

	private scheduleMarkdownRender(m: Message): void {
		if (this.pendingRenderTimer !== null) return;
		this.pendingRenderTimer = window.setTimeout(() => {
			this.pendingRenderTimer = null;
			const el = this.markdownContainers.get(m);
			if (!el) return;
			this.renderMarkdownInto(el, m.content);
			this.scrollToBottom();
		}, 80);
	}

	private flushMarkdownRender(m: Message): void {
		if (this.pendingRenderTimer !== null) {
			window.clearTimeout(this.pendingRenderTimer);
			this.pendingRenderTimer = null;
		}
		const el = this.markdownContainers.get(m);
		if (el) this.renderMarkdownInto(el, m.content);
	}

	private scrollToBottom(): void {
		requestAnimationFrame(() => {
			this.listEl.scrollTop = this.listEl.scrollHeight;
		});
	}

	// ---------- input ----------

	private onInputKeydown(evt: KeyboardEvent): void {
		if (evt.key === "Enter" && !evt.shiftKey && !evt.isComposing) {
			evt.preventDefault();
			void this.onSendOrStop();
			return;
		}
		if (evt.key === "Escape" && this.completionsEl.isShown()) {
			this.completionsEl.hide();
		}
	}

	private autosizeInput(): void {
		const ta = this.inputEl;
		ta.setCssProps({ "--ollama-chat-input-height": "auto" });
		const maxPx = 160;
		ta.setCssProps({
			"--ollama-chat-input-height": `${Math.min(ta.scrollHeight, maxPx)}px`,
		});
	}

	private updateInputPlaceholder(): void {
		let placeholder: string;
		switch (this.contextMode) {
			case "none":
				placeholder = "Ask anything…";
				break;
			case "current-selection":
				placeholder = "Ask about the selection…";
				break;
			case "retrieval":
				placeholder = "Ask your vault…";
				break;
			default:
				placeholder = "Ask about this note…";
		}
		this.inputEl.setAttr("placeholder", placeholder);
	}

	private updateCompletions(): void {
		const matches = matchingCompletions(
			this.inputEl.value,
			this.plugin.settings.slashCommands,
		);
		this.completionsEl.empty();
		if (matches.length === 0) {
			this.completionsEl.hide();
			return;
		}
		this.completionsEl.show();
		for (const cmd of matches) {
			const row = this.completionsEl.createDiv({ cls: "ollama-chat-completion" });
			row.createSpan({ cls: "ollama-chat-completion-name", text: `/${cmd.name}` });
			row.createSpan({
				cls: "ollama-chat-completion-template",
				text: cmd.template.slice(0, 80),
			});
			row.addEventListener("click", () => {
				this.inputEl.value = `/${cmd.name} `;
				this.autosizeInput();
				this.inputEl.focus();
				this.completionsEl.hide();
			});
		}
	}

	private updateStatus(): void {
		const settings = this.plugin.settings;
		const limit = contextLimitForModel(settings, settings.model);
		const chars = this.inputEl.value.length + this.historyChars();
		const tokens = Math.ceil(chars / 4);
		const pct = limit > 0 ? tokens / limit : 0;
		let color = "ok";
		if (pct >= 1) color = "over";
		else if (pct >= 0.8) color = "warn";
		this.statusLineEl.empty();
		this.statusLineEl.removeClass("ollama-status-ok", "ollama-status-warn", "ollama-status-over");
		this.statusLineEl.addClass(`ollama-status-${color}`);
		this.statusLineEl.createSpan({
			text: `${settings.model || "no model"} · ~${tokens.toLocaleString()} / ${limit.toLocaleString()} tok`,
		});
	}

	private historyChars(): number {
		let n = 0;
		for (const m of this.conv.messages) n += m.content.length;
		return n;
	}

	// ---------- actions ----------

	private cycleContextMode(): void {
		const idx = CONTEXT_MODE_ORDER.indexOf(this.contextMode);
		this.contextMode = CONTEXT_MODE_ORDER[(idx + 1) % CONTEXT_MODE_ORDER.length];
		this.refreshSubheader();
		this.updateInputPlaceholder();
	}

	private async onSendOrStop(): Promise<void> {
		if (this.streaming) {
			this.stopGeneration();
			return;
		}
		await this.sendMessage();
	}

	private async sendMessage(): Promise<void> {
		const rawInput = this.inputEl.value.trim();
		if (rawInput.length === 0) return;

		const settings = this.plugin.settings;
		if (!settings.model) {
			new Notice("Pick a model in settings first.");
			return;
		}

		this.completionsEl.hide();

		// Expand slash command if present.
		const match = parseSlash(rawInput, settings.slashCommands);
		const userVisibleText = rawInput;
		const llmText = match
			? expandTemplate(match.command.template, { input: match.rest })
			: rawInput;

		// Build context.
		const ctx = await buildContext(this.app, this.contextMode, settings, {
			query: llmText,
			vectorStore: this.plugin.vectorStore,
			ollama: this.plugin.ollama,
		});
		if (this.contextMode === "retrieval") {
			if (ctx.retrievalStatus === "empty-index") {
				new Notice("Index is empty — run reindex in settings.", 5000);
			} else if (ctx.retrievalStatus === "no-model") {
				new Notice("Pick an embedder model in settings first.", 5000);
			} else if (ctx.retrievalStatus === "embed-failed") {
				new Notice("Embedding failed — check your server is reachable.", 5000);
			}
		}
		const sourcePath = ctx.sourceNote?.path;

		// Per-note frontmatter override.
		const override = getPerNoteOverride(this.app, ctx.sourceNote);
		const model = override.model ?? settings.model;
		const systemPrompt = override.systemPrompt ?? settings.systemPrompt;

		// Add user message.
		const userMsg = this.conv.addUser(userVisibleText, {
			contextSourceNote: sourcePath,
			contextMode: this.contextMode,
		});
		this.renderMessage(userMsg);
		this.refreshEmptyState();

		// Clear input.
		this.inputEl.value = "";
		this.autosizeInput();
		this.updateStatus();

		// Build messages payload.
		const systemMessages: ChatMessage[] = [];
		if (systemPrompt && systemPrompt.trim().length > 0) {
			systemMessages.push({ role: "system", content: systemPrompt });
		}
		if (ctx.text.length > 0) {
			systemMessages.push({ role: "system", content: ctx.text });
		}
		if (ctx.truncated) {
			new Notice("Note context was truncated — content may be incomplete.", 4000);
		}
		const history: ChatMessage[] = this.conv.messages
			.filter((m) => m.role !== "system" && m !== userMsg)
			.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
		const payload: ChatMessage[] = [
			...systemMessages,
			...history,
			{ role: "user", content: llmText },
		];

		// Assistant placeholder.
		const assistant = this.conv.addAssistant("", { model });
		this.renderMessage(assistant);
		this.scrollToBottom();

		// Stream.
		this.streaming = true;
		this.setSendButtonState("stop");
		this.abortController = new AbortController();
		try {
			for await (const evt of this.plugin.ollama.chatStream({
				messages: payload,
				model,
				temperature: settings.temperature,
				maxTokens: settings.maxTokens,
				signal: this.abortController.signal,
			})) {
				if (evt.type === "delta") {
					this.conv.appendToLast(evt.text);
					this.scheduleMarkdownRender(assistant);
				} else if (evt.type === "stats") {
					assistant.stats = evt.stats;
				}
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (this.abortController?.signal.aborted) {
				this.conv.markLastStopped();
			} else {
				this.conv.appendToLast(
					`\n\n> **Error:** ${msg}\n\n_Check your settings and that the Ollama server is reachable._`,
				);
				new Notice(`Ollama error: ${msg}`, 6000);
			}
		} finally {
			this.streaming = false;
			this.abortController = null;
			this.setSendButtonState("send");
			this.flushMarkdownRender(assistant);
			this.updateStatus();
			this.scrollToBottom();
			this.refreshTitle();
			void this.plugin.saveActiveConversation(this.conv);
			this.historyDrawer?.scheduleRefresh();
			this.maybeAutoSave();
		}
	}

	private stopGeneration(): void {
		if (this.abortController) {
			this.abortController.abort();
		}
	}

	private setSendButtonState(state: "send" | "stop"): void {
		this.sendBtn.empty();
		if (state === "stop") {
			setIcon(this.sendBtn, "square");
			this.sendBtn.addClass("ollama-chat-send--stop");
			setTooltip(this.sendBtn, "Stop generating");
		} else {
			setIcon(this.sendBtn, "arrow-up");
			this.sendBtn.removeClass("ollama-chat-send--stop");
			setTooltip(this.sendBtn, "Send");
		}
	}

	private clearConversation(): void {
		if (this.streaming) {
			new Notice("Stop the response before clearing.");
			return;
		}
		this.conv.clear();
		this.renderAllMessages();
		this.updateStatus();
		this.refreshTitle();
		void this.plugin.saveActiveConversation(this.conv);
		this.historyDrawer?.scheduleRefresh();
	}

	private async saveAsNote(): Promise<void> {
		if (this.conv.isEmpty) {
			new Notice("Nothing to save — conversation is empty.");
			return;
		}
		const settings = this.plugin.settings;
		const activeTitle = this.app.workspace.getActiveFile()?.basename;
		try {
			await saveConversationAsNote(
				this.app,
				this.conv,
				settings.saveFolder,
				settings.filenameTemplate,
				activeTitle,
			);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			new Notice(`Save failed: ${msg}`, 6000);
		}
	}

	private maybeAutoSave(): void {
		const n = this.plugin.settings.autoSaveEvery;
		if (n <= 0) return;
		const nonSystem = this.conv.messages.filter((m) => m.role !== "system").length;
		if (nonSystem > 0 && nonSystem % n === 0) void this.saveAsNote();
	}

	private openSettings(): void {
		const appAny = this.app as unknown as {
			setting?: { open: () => void; openTabById: (id: string) => void };
		};
		const s = appAny.setting;
		if (s) {
			s.open();
			s.openTabById(this.plugin.manifest.id);
		}
	}

	private async copyMessage(m: Message): Promise<void> {
		try {
			await navigator.clipboard.writeText(m.content);
			new Notice("Copied to clipboard");
		} catch {
			new Notice("Copy failed");
		}
	}

	private insertIntoNote(m: Message): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) {
			new Notice("No active note to insert into");
			return;
		}
		view.editor.replaceSelection(m.content);
	}

	private async regenerate(m: Message): Promise<void> {
		// Only regen the last assistant message.
		const last = this.conv.last;
		if (!last || last.id !== m.id || last.role !== "assistant") {
			new Notice("Can only regenerate the most recent response");
			return;
		}
		this.conv.removeLast();
		// Find the last user message to reuse as the prompt.
		const lastUser = [...this.conv.messages].reverse().find((mm) => mm.role === "user");
		if (!lastUser) return;
		this.conv.messages = this.conv.messages.filter((mm) => mm.id !== lastUser.id);
		this.renderAllMessages();
		this.inputEl.value = lastUser.content;
		await this.sendMessage();
	}

	// ---------- title / drawer ----------

	private refreshTitle(): void {
		if (!this.titleEl) return;
		this.titleEl.empty();
		const hasTitle = this.conv.title.trim().length > 0;
		const isEmptyChat = this.conv.isEmpty;
		if (hasTitle) {
			this.titleEl.createSpan({ cls: "ollama-chat-title-text", text: this.conv.title });
			setTooltip(this.titleEl, "Click to rename");
			this.titleEl.removeClass("ollama-chat-title--placeholder");
		} else {
			this.titleEl.createSpan({
				cls: "ollama-chat-title-text",
				text: isEmptyChat ? "New chat" : "Untitled",
			});
			this.titleEl.addClass("ollama-chat-title--placeholder");
			setTooltip(this.titleEl, isEmptyChat ? "Send a message to auto-title" : "Click to rename");
		}
	}

	private startTitleRename(): void {
		if (!this.titleEl) return;
		if (this.conv.isEmpty) return;
		const current = this.conv.title;
		const input = document.createElement("input");
		input.type = "text";
		input.value = current;
		input.className = "ollama-chat-title-input";
		this.titleEl.empty();
		this.titleEl.appendChild(input);
		input.focus();
		input.select();

		let done = false;
		const commit = () => {
			if (done) return;
			done = true;
			const next = input.value.trim();
			if (next.length === 0 || next === current) {
				this.refreshTitle();
				return;
			}
			this.conv.setTitle(next);
			this.refreshTitle();
			void this.plugin.saveActiveConversation(this.conv);
			this.historyDrawer?.scheduleRefresh();
		};
		const cancel = () => {
			if (done) return;
			done = true;
			this.refreshTitle();
		};

		input.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter") {
				evt.preventDefault();
				commit();
			} else if (evt.key === "Escape") {
				evt.preventDefault();
				cancel();
			}
		});
		input.addEventListener("blur", commit);
	}

	private ensureHistoryDrawer(): void {
		if (this.historyDrawer) return;
		this.historyDrawer = new HistoryDrawer(this.app, this.contentEl, {
			getRows: () => this.plugin.store.listForDrawer(),
			getActiveId: () => this.plugin.store.getActiveId(),
			onNew: () => void this.newChat(),
			onSelect: (id) => void this.switchToConversation(id),
			onRename: (id, title) => {
				void this.plugin.renameConversation(id, title);
			},
			onDelete: (id) => void this.deleteConversationFromView(id),
		});
	}

	private toggleHistoryDrawer(): void {
		this.ensureHistoryDrawer();
		this.historyDrawer?.toggle();
	}

	private async newChat(): Promise<void> {
		if (this.streaming) {
			new Notice("Stop the response before starting a new chat.");
			return;
		}
		await this.plugin.createConversation();
		this.conv = this.plugin.store.hydrateActive();
		this.renderAllMessages();
		this.refreshTitle();
		this.updateStatus();
		this.historyDrawer?.scheduleRefresh();
		this.focusInput();
	}

	private async switchToConversation(id: string): Promise<void> {
		if (this.streaming) {
			new Notice("Stop the response before switching.");
			return;
		}
		const currentId = this.conv.id;
		if (currentId === id) {
			this.historyDrawer?.close();
			return;
		}
		// If the current conv is a never-saved empty, discard it.
		if (this.conv.isEmpty) {
			this.plugin.store.discardIfEmpty(currentId);
		}
		await this.plugin.switchConversation(id);
		this.conv = this.plugin.store.hydrateActive();
		this.renderAllMessages();
		this.refreshTitle();
		this.updateStatus();
		this.historyDrawer?.close();
		this.focusInput();
	}

	private async deleteConversationFromView(id: string): Promise<void> {
		if (this.streaming && id === this.conv.id) {
			new Notice("Stop the response before deleting.");
			return;
		}
		const nextActive = await this.plugin.deleteConversation(id);
		if (nextActive) await this.plugin.switchConversation(nextActive);
		this.conv = this.plugin.store.hydrateActive();
		this.renderAllMessages();
		this.refreshTitle();
		this.updateStatus();
		this.historyDrawer?.scheduleRefresh();
	}

	private maybeRehydrateActive(): void {
		const activeId = this.plugin.store.getActiveId();
		if (activeId && activeId !== this.conv.id) {
			this.conv = this.plugin.store.hydrateActive();
			this.renderAllMessages();
			this.refreshTitle();
		}
	}
}
