import { describe, expect, it } from "vitest";
import {
	Conversation,
	deriveAutoTitle,
	newId,
	type ConversationSnapshot,
	type Message,
} from "./Conversation";

describe("Conversation", () => {
	describe("construction", () => {
		it("starts empty with no manual title", () => {
			const c = new Conversation();
			expect(c.isEmpty).toBe(true);
			expect(c.title).toBe("");
			expect(c.titleManuallySet).toBe(false);
			expect(typeof c.id).toBe("string");
			expect(c.id.length).toBeGreaterThan(0);
			expect(c.updatedAt).toBe(c.createdAt);
		});

		it("hydrates from a full snapshot", () => {
			const snap: ConversationSnapshot = {
				id: "abc",
				title: "Hello",
				titleManuallySet: true,
				messages: [{ id: "m1", role: "user", content: "hi", createdAt: 1 }],
				createdAt: 10,
				updatedAt: 20,
			};
			const c = new Conversation(snap);
			expect(c.id).toBe("abc");
			expect(c.title).toBe("Hello");
			expect(c.titleManuallySet).toBe(true);
			expect(c.messages).toHaveLength(1);
			expect(c.createdAt).toBe(10);
			expect(c.updatedAt).toBe(20);
		});

		it("defaults updatedAt to createdAt and copies the messages array", () => {
			const messages: Message[] = [{ id: "m1", role: "user", content: "hi", createdAt: 1 }];
			const c = new Conversation({ createdAt: 5, messages });
			expect(c.updatedAt).toBe(5);
			// Defensive copy: a later push to the source array must not leak in.
			messages.push({ id: "m2", role: "user", content: "later", createdAt: 2 });
			expect(c.messages).toHaveLength(1);
		});
	});

	describe("adding messages", () => {
		it("appends user/assistant/tool messages with the right roles", () => {
			const c = new Conversation();
			c.addUser("question");
			c.addAssistant("answer");
			c.addTool("call-1", "read_note", "result");
			expect(c.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
			const tool = c.messages[2];
			expect(tool.toolCallId).toBe("call-1");
			expect(tool.toolName).toBe("read_note");
			expect(tool.content).toBe("result");
		});

		it("merges per-message metadata", () => {
			const c = new Conversation();
			const m = c.addUser("q", { contextMode: "retrieval", model: "llama" });
			expect(m.contextMode).toBe("retrieval");
			expect(m.model).toBe("llama");
			expect(typeof m.id).toBe("string");
		});

		it("auto-titles from the first user message", () => {
			const c = new Conversation();
			c.addUser("Plan the trip");
			expect(c.title).toBe("Plan the trip");
		});

		it("does not auto-title from an assistant message", () => {
			const c = new Conversation();
			c.addAssistant("Sure!");
			expect(c.title).toBe("");
		});
	});

	describe("streaming helpers", () => {
		it("appends a delta to the last message", () => {
			const c = new Conversation();
			c.addAssistant("Hel");
			c.appendToLast("lo");
			expect(c.last?.content).toBe("Hello");
		});

		it("appendToLast is a no-op on an empty conversation", () => {
			const c = new Conversation();
			expect(() => c.appendToLast("x")).not.toThrow();
			expect(c.isEmpty).toBe(true);
		});

		it("marks the last message stopped", () => {
			const c = new Conversation();
			c.addAssistant("partial");
			c.markLastStopped();
			expect(c.last?.stopped).toBe(true);
		});

		it("removeLast pops and returns the message", () => {
			const c = new Conversation();
			c.addUser("a");
			const m = c.addAssistant("b");
			expect(c.removeLast()).toBe(m);
			expect(c.messages).toHaveLength(1);
		});

		it("removeLast returns undefined when empty", () => {
			expect(new Conversation().removeLast()).toBeUndefined();
		});
	});

	describe("titles and counts", () => {
		it("nonSystemCount excludes system and tool roles", () => {
			const c = new Conversation({
				messages: [
					{ id: "1", role: "system", content: "", createdAt: 0 },
					{ id: "2", role: "user", content: "hi", createdAt: 0 },
					{ id: "3", role: "assistant", content: "yo", createdAt: 0 },
					{ id: "4", role: "tool", content: "r", createdAt: 0 },
				],
				createdAt: 0,
				updatedAt: 0,
			});
			expect(c.nonSystemCount).toBe(2);
		});

		it("setTitle marks the title manually set", () => {
			const c = new Conversation();
			c.setTitle("Custom");
			expect(c.title).toBe("Custom");
			expect(c.titleManuallySet).toBe(true);
		});

		it("a manual title survives later user messages", () => {
			const c = new Conversation();
			c.setTitle("Custom");
			c.addUser("This should not become the title");
			expect(c.title).toBe("Custom");
		});

		it("clear empties messages and resets an auto-title", () => {
			const c = new Conversation();
			c.addUser("Some question");
			expect(c.title).toBe("Some question");
			c.clear();
			expect(c.isEmpty).toBe(true);
			expect(c.title).toBe("");
		});

		it("clear keeps a manually-set title", () => {
			const c = new Conversation();
			c.setTitle("Pinned");
			c.addUser("hi");
			c.clear();
			expect(c.title).toBe("Pinned");
		});
	});

	describe("snapshots", () => {
		it("round-trips through toSnapshot / fromSnapshot", () => {
			const c = new Conversation();
			c.addUser("hi");
			c.setTitle("T");
			const restored = Conversation.fromSnapshot(c.toSnapshot());
			expect(restored.id).toBe(c.id);
			expect(restored.title).toBe("T");
			expect(restored.titleManuallySet).toBe(true);
			expect(restored.messages).toHaveLength(1);
		});

		it("toSnapshot copies the messages array defensively", () => {
			const c = new Conversation();
			c.addUser("hi");
			const snap = c.toSnapshot();
			snap.messages.push({ id: "x", role: "user", content: "leak", createdAt: 0 });
			expect(c.messages).toHaveLength(1);
		});

		it("fromSnapshot returns a fresh conversation for invalid input", () => {
			const c = Conversation.fromSnapshot({ not: "a snapshot" });
			expect(c.isEmpty).toBe(true);
			expect(c.titleManuallySet).toBe(false);
		});

		it("fromSnapshot tolerates legacy snapshots missing id/title", () => {
			const c = Conversation.fromSnapshot({
				messages: [{ id: "1", role: "user", content: "hi", createdAt: 0 }],
				createdAt: 1,
				updatedAt: 2,
			});
			expect(c.messages).toHaveLength(1);
			expect(typeof c.id).toBe("string"); // backfilled by the constructor
		});
	});
});

describe("deriveAutoTitle", () => {
	it("returns null when there is no user message", () => {
		expect(deriveAutoTitle([])).toBeNull();
		expect(
			deriveAutoTitle([{ id: "1", role: "assistant", content: "hi", createdAt: 0 }]),
		).toBeNull();
	});

	it("uses the first user message's first line", () => {
		expect(
			deriveAutoTitle([{ id: "1", role: "user", content: "First line\nSecond", createdAt: 0 }]),
		).toBe("First line");
	});

	it("strips a leading slash command", () => {
		expect(
			deriveAutoTitle([
				{ id: "1", role: "user", content: "/summarize the meeting", createdAt: 0 },
			]),
		).toBe("the meeting");
	});

	it("keeps the command text when nothing follows the slash command", () => {
		// "/summarize" alone strips to "" so the original text is retained.
		expect(
			deriveAutoTitle([{ id: "1", role: "user", content: "/summarize", createdAt: 0 }]),
		).toBe("/summarize");
	});

	it("truncates long titles to 40 chars with an ellipsis", () => {
		const long = "a".repeat(60);
		expect(deriveAutoTitle([{ id: "1", role: "user", content: long, createdAt: 0 }])).toBe(
			"a".repeat(40) + "…",
		);
	});

	it("returns null for whitespace-only content", () => {
		expect(
			deriveAutoTitle([{ id: "1", role: "user", content: "   \n  ", createdAt: 0 }]),
		).toBeNull();
	});
});

describe("newId", () => {
	it("produces unique, non-empty ids", () => {
		const a = newId();
		const b = newId();
		expect(a).not.toBe(b);
		expect(a.length).toBeGreaterThan(0);
	});
});
