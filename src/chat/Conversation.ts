import { ContextMode } from "../settings/Settings";
import type { ChatStats } from "../ollama/OllamaClient";

export type Role = "user" | "assistant" | "system";

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
}

export interface ConversationSnapshot {
	messages: Message[];
	createdAt: number;
	updatedAt: number;
}

export class Conversation {
	messages: Message[];
	createdAt: number;
	updatedAt: number;

	constructor(snapshot?: ConversationSnapshot) {
		if (snapshot) {
			this.messages = snapshot.messages.slice();
			this.createdAt = snapshot.createdAt;
			this.updatedAt = snapshot.updatedAt;
		} else {
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
	}

	get isEmpty(): boolean {
		return this.messages.length === 0;
	}

	toSnapshot(): ConversationSnapshot {
		return {
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
		return msg;
	}
}

function newId(): string {
	const c = (globalThis as { crypto?: Crypto }).crypto;
	if (c && typeof c.randomUUID === "function") return c.randomUUID();
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isSnapshot(x: unknown): x is ConversationSnapshot {
	if (!x || typeof x !== "object") return false;
	const s = x as Partial<ConversationSnapshot>;
	return (
		Array.isArray(s.messages) &&
		typeof s.createdAt === "number" &&
		typeof s.updatedAt === "number"
	);
}
