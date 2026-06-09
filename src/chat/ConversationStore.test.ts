import { describe, expect, it } from "vitest";
import { Conversation, type ConversationSnapshot } from "./Conversation";
import { ConversationStore } from "./ConversationStore";

function snap(id: string, opts: Partial<ConversationSnapshot> = {}): ConversationSnapshot {
	return {
		id,
		title: "",
		titleManuallySet: false,
		messages: [],
		createdAt: 0,
		updatedAt: 0,
		...opts,
	};
}

/** A non-empty conversation (one user message), with a given updatedAt for sort tests. */
function withMsg(id: string, updatedAt = 0): ConversationSnapshot {
	return snap(id, {
		updatedAt,
		messages: [{ id: `${id}-m`, role: "user", content: "hi", createdAt: 0 }],
	});
}

describe("ConversationStore — active selection", () => {
	it("has no active conversation when constructed empty", () => {
		expect(new ConversationStore([]).getActiveId()).toBeNull();
	});

	it("picks the newest-updated conversation when no active id is given", () => {
		const store = new ConversationStore([withMsg("a", 1), withMsg("b", 2)]);
		expect(store.getActiveId()).toBe("b");
	});

	it("keeps a valid provided active id", () => {
		const store = new ConversationStore([withMsg("a", 1), withMsg("b", 2)], "a");
		expect(store.getActiveId()).toBe("a");
	});

	it("falls back to newest when the provided active id is missing", () => {
		const store = new ConversationStore([withMsg("a", 1), withMsg("b", 2)], "ghost");
		expect(store.getActiveId()).toBe("b");
	});

	it("copies the input array defensively", () => {
		const input = [withMsg("a", 1)];
		const store = new ConversationStore(input);
		input.push(withMsg("b", 2));
		expect(store.list().map((c) => c.id)).toEqual(["a"]);
	});

	it("setActive switches to an existing id and ignores a missing one", () => {
		const store = new ConversationStore([withMsg("a", 1), withMsg("b", 2)], "a");
		store.setActive("b");
		expect(store.getActiveId()).toBe("b");
		store.setActive("ghost");
		expect(store.getActiveId()).toBe("b");
	});
});

describe("ConversationStore — listing", () => {
	it("list() returns newest-updated first and includes empties", () => {
		const store = new ConversationStore([withMsg("a", 1), snap("empty", { updatedAt: 5 }), withMsg("b", 2)]);
		expect(store.list().map((c) => c.id)).toEqual(["empty", "b", "a"]);
	});

	it("listForDrawer() excludes empty conversations", () => {
		const store = new ConversationStore([withMsg("a", 1), snap("empty", { updatedAt: 5 })]);
		expect(store.listForDrawer().map((c) => c.id)).toEqual(["a"]);
	});

	it("get() finds by id and getActive() returns the active snapshot", () => {
		const store = new ConversationStore([withMsg("a", 1)], "a");
		expect(store.get("a")?.id).toBe("a");
		expect(store.get("nope")).toBeUndefined();
		expect(store.getActive()?.id).toBe("a");
	});
});

describe("ConversationStore — mutation", () => {
	it("createEmpty pushes an empty conversation and makes it active", () => {
		const store = new ConversationStore([withMsg("a", 1)], "a");
		const created = store.createEmpty();
		expect(created.messages).toHaveLength(0);
		expect(store.getActiveId()).toBe(created.id);
		expect(store.get(created.id)).toBeDefined();
	});

	it("upsert replaces an existing snapshot and appends a new one", () => {
		const store = new ConversationStore([withMsg("a", 1)], "a");
		store.upsert(snap("a", { title: "renamed", updatedAt: 9, messages: [] }));
		expect(store.get("a")?.title).toBe("renamed");
		store.upsert(withMsg("b", 3));
		expect(store.get("b")?.id).toBe("b");
	});

	it("rename sets the title, marks it manual, and no-ops on a missing id", () => {
		const store = new ConversationStore([withMsg("a", 1)], "a");
		store.rename("a", "My chat");
		expect(store.get("a")?.title).toBe("My chat");
		expect(store.get("a")?.titleManuallySet).toBe(true);
		expect(() => store.rename("ghost", "x")).not.toThrow();
	});
});

describe("ConversationStore — delete", () => {
	it("deleting a non-active conversation leaves the active id unchanged", () => {
		const store = new ConversationStore([withMsg("a", 1), withMsg("b", 2)], "a");
		expect(store.delete("b")).toEqual({ nextActiveId: "a" });
		expect(store.get("b")).toBeUndefined();
	});

	it("deleting the active conversation falls back to the newest remaining", () => {
		const store = new ConversationStore([withMsg("a", 1), withMsg("b", 2), withMsg("c", 3)], "a");
		expect(store.delete("a")).toEqual({ nextActiveId: "c" });
		expect(store.getActiveId()).toBe("c");
	});

	it("deleting the last conversation yields a null next active id", () => {
		const store = new ConversationStore([withMsg("a", 1)], "a");
		expect(store.delete("a")).toEqual({ nextActiveId: null });
		expect(store.getActiveId()).toBeNull();
	});

	it("deleting a missing id is a no-op", () => {
		const store = new ConversationStore([withMsg("a", 1)], "a");
		expect(store.delete("ghost")).toEqual({ nextActiveId: "a" });
		expect(store.list()).toHaveLength(1);
	});
});

describe("ConversationStore — discardIfEmpty", () => {
	it("removes an empty conversation and clears it from active", () => {
		const store = new ConversationStore([withMsg("a", 1)], "a");
		const empty = store.createEmpty(); // becomes active
		store.discardIfEmpty(empty.id);
		expect(store.get(empty.id)).toBeUndefined();
		expect(store.getActiveId()).toBeNull();
	});

	it("keeps a conversation that has messages", () => {
		const store = new ConversationStore([withMsg("a", 1)], "a");
		store.discardIfEmpty("a");
		expect(store.get("a")).toBeDefined();
	});

	it("no-ops on a missing id", () => {
		const store = new ConversationStore([withMsg("a", 1)], "a");
		expect(() => store.discardIfEmpty("ghost")).not.toThrow();
	});
});

describe("ConversationStore — hydrateActive", () => {
	it("rehydrates the active snapshot as a Conversation", () => {
		const store = new ConversationStore([withMsg("a", 1)], "a");
		const conv = store.hydrateActive();
		expect(conv).toBeInstanceOf(Conversation);
		expect(conv.id).toBe("a");
		expect(conv.messages).toHaveLength(1);
	});

	it("returns a fresh empty Conversation when there is no active", () => {
		const conv = new ConversationStore([]).hydrateActive();
		expect(conv).toBeInstanceOf(Conversation);
		expect(conv.isEmpty).toBe(true);
	});
});

describe("ConversationStore — toPersistable", () => {
	it("filters out empty conversations", () => {
		const store = new ConversationStore([withMsg("a", 1), snap("empty", { updatedAt: 9 })], "a");
		const out = store.toPersistable();
		expect(out.conversations.map((c) => c.id)).toEqual(["a"]);
	});

	it("persists the active id when the active conversation is non-empty", () => {
		const store = new ConversationStore([withMsg("a", 1), withMsg("b", 2)], "b");
		expect(store.toPersistable().activeConversationId).toBe("b");
	});

	it("drops the active id when it points to an unpersisted empty", () => {
		const store = new ConversationStore([withMsg("a", 1)], "a");
		store.createEmpty(); // active is now an empty conversation
		expect(store.toPersistable().activeConversationId).toBeNull();
	});
});
