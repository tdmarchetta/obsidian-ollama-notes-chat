import { setIcon, setTooltip } from "obsidian";
import type { ConversationSnapshot } from "../chat/Conversation";

export interface HistoryDrawerCallbacks {
	onNew: () => void;
	onSelect: (id: string) => void;
	onRename: (id: string, title: string) => void;
	onDelete: (id: string) => void;
	getRows: () => ConversationSnapshot[];
	getActiveId: () => string | null;
}

/**
 * Overlay controller for the conversation history drawer.
 * Renders into a container owned by the caller (ChatView's root).
 * Not an ItemView or Modal — just a DOM controller.
 */
export class HistoryDrawer {
	private root: HTMLElement;
	private scrimEl: HTMLElement | null = null;
	private drawerEl: HTMLElement | null = null;
	private listEl: HTMLElement | null = null;
	private cb: HistoryDrawerCallbacks;
	private refreshTimer: number | null = null;
	private isOpen = false;

	constructor(root: HTMLElement, callbacks: HistoryDrawerCallbacks) {
		this.root = root;
		this.cb = callbacks;
	}

	open(): void {
		if (this.isOpen) return;
		this.isOpen = true;
		this.mount();
		this.refresh();
	}

	close(): void {
		if (!this.isOpen) return;
		this.isOpen = false;
		this.unmount();
	}

	toggle(): void {
		if (this.isOpen) this.close();
		else this.open();
	}

	/** Debounced refresh — cheap to call during streams. */
	scheduleRefresh(): void {
		if (!this.isOpen) return;
		if (this.refreshTimer !== null) return;
		this.refreshTimer = window.setTimeout(() => {
			this.refreshTimer = null;
			this.refresh();
		}, 500);
	}

	refresh(): void {
		if (!this.isOpen || !this.listEl) return;
		this.listEl.empty();

		const newBtn = this.listEl.createEl("button", { cls: "ollama-chat-history-new" });
		setIcon(newBtn, "plus");
		newBtn.createSpan({ text: "New chat" });
		newBtn.addEventListener("click", () => {
			this.cb.onNew();
			this.close();
		});

		const rows = this.cb.getRows();
		const activeId = this.cb.getActiveId();

		if (rows.length === 0) {
			const empty = this.listEl.createDiv({ cls: "ollama-chat-history-empty" });
			empty.setText("No saved conversations yet.");
			return;
		}

		for (const row of rows) {
			this.renderRow(row, row.id === activeId);
		}
	}

	destroy(): void {
		if (this.refreshTimer !== null) {
			window.clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}
		this.unmount();
	}

	private mount(): void {
		this.scrimEl = this.root.createDiv({ cls: "ollama-chat-history-scrim" });
		this.scrimEl.addEventListener("click", () => this.close());

		this.drawerEl = this.root.createDiv({ cls: "ollama-chat-history-drawer" });

		const header = this.drawerEl.createDiv({ cls: "ollama-chat-history-header" });
		header.createSpan({ cls: "ollama-chat-history-title", text: "History" });
		const closeBtn = header.createEl("button", {
			cls: "ollama-chat-icon-btn clickable-icon",
			attr: { "aria-label": "Close history" },
		});
		setIcon(closeBtn, "x");
		setTooltip(closeBtn, "Close");
		closeBtn.addEventListener("click", () => this.close());

		this.listEl = this.drawerEl.createDiv({ cls: "ollama-chat-history-list" });
	}

	private unmount(): void {
		this.scrimEl?.remove();
		this.drawerEl?.remove();
		this.scrimEl = null;
		this.drawerEl = null;
		this.listEl = null;
	}

	private renderRow(row: ConversationSnapshot, isActive: boolean): void {
		if (!this.listEl) return;
		const rowEl = this.listEl.createDiv({
			cls: "ollama-chat-history-row" + (isActive ? " ollama-chat-history-row--active" : ""),
		});
		rowEl.setAttr("role", "button");
		rowEl.setAttr("tabindex", "0");

		const title = row.title.trim().length > 0 ? row.title : "Untitled";
		const titleEl = rowEl.createDiv({ cls: "ollama-chat-history-row-title", text: title });

		const preview = firstUserPreview(row);
		if (preview) {
			rowEl.createDiv({ cls: "ollama-chat-history-row-preview", text: preview });
		}

		const metaRow = rowEl.createDiv({ cls: "ollama-chat-history-row-meta" });
		metaRow.createSpan({
			cls: "ollama-chat-history-row-time",
			text: formatRelative(row.updatedAt),
		});
		const actions = metaRow.createDiv({ cls: "ollama-chat-history-row-actions" });

		const renameBtn = actions.createEl("button", {
			cls: "ollama-chat-icon-btn clickable-icon",
			attr: { "aria-label": "Rename chat" },
		});
		setIcon(renameBtn, "pencil");
		setTooltip(renameBtn, "Rename");
		renameBtn.addEventListener("click", (evt) => {
			evt.stopPropagation();
			this.startRename(row, titleEl);
		});

		const deleteBtn = actions.createEl("button", {
			cls: "ollama-chat-icon-btn clickable-icon",
			attr: { "aria-label": "Delete chat" },
		});
		setIcon(deleteBtn, "trash-2");
		setTooltip(deleteBtn, "Delete");
		deleteBtn.addEventListener("click", (evt) => {
			evt.stopPropagation();
			const confirmed = window.confirm(`Delete "${title}"? This cannot be undone.`);
			if (!confirmed) return;
			this.cb.onDelete(row.id);
		});

		rowEl.addEventListener("click", () => this.cb.onSelect(row.id));
		rowEl.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter" || evt.key === " ") {
				evt.preventDefault();
				this.cb.onSelect(row.id);
			}
		});
	}

	private startRename(row: ConversationSnapshot, titleEl: HTMLElement): void {
		const current = row.title.trim().length > 0 ? row.title : "";
		const input = document.createElement("input");
		input.type = "text";
		input.value = current;
		input.className = "ollama-chat-history-row-rename";
		titleEl.replaceWith(input);
		input.focus();
		input.select();

		let committed = false;
		const commit = () => {
			if (committed) return;
			committed = true;
			const next = input.value.trim();
			if (next.length > 0 && next !== current) {
				this.cb.onRename(row.id, next);
			} else {
				this.refresh();
			}
		};
		const cancel = () => {
			if (committed) return;
			committed = true;
			this.refresh();
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
}

function firstUserPreview(row: ConversationSnapshot): string | null {
	const first = row.messages.find((m) => m.role === "user");
	if (!first) return null;
	let text = first.content.trim().split("\n")[0];
	if (text.length === 0) return null;
	if (text.length > 80) text = text.slice(0, 80).trimEnd() + "…";
	return `"${text}"`;
}

function formatRelative(ts: number): string {
	const now = Date.now();
	const diff = Math.max(0, now - ts);
	const m = Math.round(diff / 60000);
	if (m < 1) return "just now";
	if (m < 60) return `${m}m ago`;
	const h = Math.round(m / 60);
	if (h < 24) return `${h}h ago`;
	const d = Math.round(h / 24);
	if (d < 7) return `${d}d ago`;
	const date = new Date(ts);
	return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
