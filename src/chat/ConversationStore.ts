import { Conversation, ConversationSnapshot, newId } from "./Conversation";

/**
 * In-memory store of all conversations. The plugin owns one instance.
 * The ChatView rehydrates a `Conversation` class from the active snapshot for
 * live editing, and calls `upsert(snapshot)` to flush changes back.
 *
 * Empty conversations (messages.length === 0) are kept in memory so that
 * "new chat → abandon → switch back" works, but they are filtered out of
 * `toPersistable()` so data.json doesn't accumulate abandoned empties.
 */
export class ConversationStore {
	private conversations: ConversationSnapshot[];
	private activeId: string | null;

	constructor(conversations: ConversationSnapshot[], activeId?: string | null) {
		this.conversations = conversations.slice();
		this.activeId = activeId ?? null;
		this.ensureValidActive();
	}

	/** All conversations, newest-updated first. Includes empties. */
	list(): ConversationSnapshot[] {
		return this.conversations.slice().sort((a, b) => b.updatedAt - a.updatedAt);
	}

	/** Non-empty conversations for the drawer view, newest-updated first. */
	listForDrawer(): ConversationSnapshot[] {
		return this.list().filter((c) => c.messages.length > 0);
	}

	get(id: string): ConversationSnapshot | undefined {
		return this.conversations.find((c) => c.id === id);
	}

	getActive(): ConversationSnapshot | undefined {
		if (!this.activeId) return undefined;
		return this.get(this.activeId);
	}

	getActiveId(): string | null {
		return this.activeId;
	}

	setActive(id: string): void {
		if (!this.get(id)) return;
		this.activeId = id;
	}

	/**
	 * Create a fresh empty conversation and make it active.
	 * Returns the snapshot. It lives in memory but `toPersistable()` will skip
	 * it until it has messages.
	 */
	createEmpty(): ConversationSnapshot {
		const now = Date.now();
		const snap: ConversationSnapshot = {
			id: newId(),
			title: "",
			titleManuallySet: false,
			messages: [],
			createdAt: now,
			updatedAt: now,
		};
		this.conversations.push(snap);
		this.activeId = snap.id;
		return snap;
	}

	/** Write a snapshot back — creates the entry if missing. */
	upsert(snapshot: ConversationSnapshot): void {
		const idx = this.conversations.findIndex((c) => c.id === snapshot.id);
		if (idx >= 0) {
			this.conversations[idx] = snapshot;
		} else {
			this.conversations.push(snapshot);
		}
	}

	rename(id: string, title: string): void {
		const c = this.get(id);
		if (!c) return;
		c.title = title;
		c.titleManuallySet = true;
		c.updatedAt = Date.now();
	}

	/**
	 * Delete a conversation. Returns the id the caller should switch to if
	 * the deleted conversation was active. `null` means the store is now empty
	 * and the caller should create a fresh empty.
	 */
	delete(id: string): { nextActiveId: string | null } {
		const idx = this.conversations.findIndex((c) => c.id === id);
		if (idx < 0) return { nextActiveId: this.activeId };
		this.conversations.splice(idx, 1);
		if (this.activeId !== id) return { nextActiveId: this.activeId };
		// Deleted the active: fall back to newest remaining, or nothing.
		const sorted = this.list();
		this.activeId = sorted[0]?.id ?? null;
		return { nextActiveId: this.activeId };
	}

	/**
	 * Discard a conversation that was never persisted (has no messages).
	 * No-op if the id doesn't exist or has messages. Safe to call liberally
	 * before switching away from a transient empty.
	 */
	discardIfEmpty(id: string): void {
		const c = this.get(id);
		if (!c || c.messages.length > 0) return;
		this.conversations = this.conversations.filter((x) => x.id !== id);
		if (this.activeId === id) this.activeId = null;
	}

	/**
	 * Rehydrate the active snapshot as a Conversation class instance.
	 * Returns a fresh empty Conversation if there's no active or the active
	 * is missing.
	 */
	hydrateActive(): Conversation {
		const snap = this.getActive();
		return snap ? Conversation.fromSnapshot(snap) : new Conversation();
	}

	/** What goes to data.json. Empty conversations are filtered out. */
	toPersistable(): { conversations: ConversationSnapshot[]; activeConversationId: string | null } {
		const conversations = this.conversations.filter((c) => c.messages.length > 0);
		// If active points to an empty (therefore-unpersisted) conv, don't persist the id either —
		// on reload we'll fall back to newest remaining or a fresh empty.
		const activeConversationId =
			this.activeId && conversations.some((c) => c.id === this.activeId)
				? this.activeId
				: null;
		return { conversations, activeConversationId };
	}

	private ensureValidActive(): void {
		if (this.activeId && this.get(this.activeId)) return;
		const sorted = this.list();
		this.activeId = sorted[0]?.id ?? null;
	}
}
