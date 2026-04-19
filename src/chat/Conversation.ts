import { ContextMode } from "../settings/Settings";
import type { ChatStats } from "../ollama/OllamaClient";

export type Role = "user" | "assistant" | "system" | "tool";

export interface ToolCall {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
	result?: string;
	error?: string;
}

export interface Message {
	id: string;
	role: Role;
	content: string;
	createdAt: number;
	model?: string;
	contextSourceNote?: string;
	contextMode?: ContextMode;
	stopped?: boolean;
	stats?: ChatStats;
	toolCalls?: ToolCall[];
	toolCallId?: string;
	toolName?: string;
}

export interface ConversationSnapshot {
	id: string;
	title: string;
	titleManuallySet: boolean;
	messages: Message[];
	createdAt: number;
	updatedAt: number;
}

export class Conversation {
	id: string;
	title: string;
	titleManuallySet: boolean;
	messages: Message[];
	createdAt: number;
	updatedAt: number;

	constructor(snapshot?: Partial<ConversationSnapshot>) {
		if (snapshot) {
			this.id = snapshot.id ?? newId();
			this.title = snapshot.title ?? "";
			this.titleManuallySet = snapshot.titleManuallySet ?? false;
			this.messages = (snapshot.messages ?? []).slice();
			this.createdAt = snapshot.createdAt ?? Date.now();
			this.updatedAt = snapshot.updatedAt ?? this.createdAt;
		} else {
			this.id = newId();
			this.title = "";
			this.titleManuallySet = false;
			this.messages = [];
			this.createdAt = Date.now();
			this.updatedAt = this.createdAt;
		}
	}

	addUser(content: string, meta?: Partial<Message>): Message {
		return this.push({ role: "user", content, ...meta });
	}

	addAssistant(initialContent = "", meta?: Partial<Message>): Message {
		return this.push({ role: "assistant", content: initialContent, ...meta });
	}

	addTool(toolCallId: string, toolName: string, content: string): Message {
		return this.push({
			role: "tool",
			content,
			toolCallId,
			toolName,
		});
	}

	appendToLast(delta: string): void {
		if (this.messages.length === 0) return;
		const last = this.messages[this.messages.length - 1];
		last.content += delta;
		this.updatedAt = Date.now();
	}

	markLastStopped(): void {
		if (this.messages.length === 0) return;
		this.messages[this.messages.length - 1].stopped = true;
		this.updatedAt = Date.now();
	}

	removeLast(): Message | undefined {
		const m = this.messages.pop();
		if (m) this.updatedAt = Date.now();
		return m;
	}

	get last(): Message | undefined {
		return this.messages[this.messages.length - 1];
	}

	clear(): void {
		this.messages = [];
		this.updatedAt = Date.now();
		// Auto-title relies on the first user message; once cleared, reset auto-title
		// so the next user message drives a fresh title (unless user had set one manually).
		if (!this.titleManuallySet) this.title = "";
	}

	get isEmpty(): boolean {
		return this.messages.length === 0;
	}

	get nonSystemCount(): number {
		let n = 0;
		for (const m of this.messages) {
			if (m.role === "system" || m.role === "tool") continue;
			n++;
		}
		return n;
	}

	setTitle(title: string): void {
		this.title = title;
		this.titleManuallySet = true;
		this.updatedAt = Date.now();
	}

	autoTitle(): void {
		if (this.titleManuallySet) return;
		const t = deriveAutoTitle(this.messages);
		if (t) this.title = t;
	}

	toSnapshot(): ConversationSnapshot {
		return {
			id: this.id,
			title: this.title,
			titleManuallySet: this.titleManuallySet,
			messages: this.messages.slice(),
			createdAt: this.createdAt,
			updatedAt: this.updatedAt,
		};
	}

	static fromSnapshot(snapshot: unknown): Conversation {
		if (!isSnapshot(snapshot)) return new Conversation();
		return new Conversation(snapshot);
	}

	private push(partial: Partial<Message> & { role: Role; content: string }): Message {
		const msg: Message = {
			id: newId(),
			createdAt: Date.now(),
			...partial,
		};
		this.messages.push(msg);
		this.updatedAt = msg.createdAt;
		if (msg.role === "user") this.autoTitle();
		return msg;
	}
}

export function newId(): string {
	const c = (globalThis as { crypto?: Crypto }).crypto;
	if (c && typeof c.randomUUID === "function") return c.randomUUID();
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function deriveAutoTitle(messages: Message[]): string | null {
	const firstUser = messages.find((m) => m.role === "user");
	if (!firstUser) return null;
	let text = firstUser.content.trim();
	if (text.length === 0) return null;
	// Strip a leading slash command (e.g. "/summarize ") so chats aren't all titled "/summarize…".
	const stripped = text.replace(/^\/\w+(\s+|$)/, "").trim();
	if (stripped.length > 0) text = stripped;
	text = text.split("\n")[0].trim();
	if (text.length === 0) return null;
	if (text.length > 40) text = text.slice(0, 40).trimEnd() + "…";
	return text;
}

function isSnapshot(x: unknown): x is Partial<ConversationSnapshot> {
	if (!x || typeof x !== "object") return false;
	const s = x as Partial<ConversationSnapshot>;
	// Tolerate missing new fields (id/title/titleManuallySet) so legacy 0.1.0 snapshots
	// still validate; constructor + fromSnapshot fill defaults.
	return (
		Array.isArray(s.messages) &&
		typeof s.createdAt === "number" &&
		typeof s.updatedAt === "number"
	);
}
