import { describe, expect, it } from "vitest";
import { parseToolCall, sanitizeArgs } from "./OllamaClient";

describe("parseToolCall", () => {
	it("parses a normal tool call", () => {
		const out = parseToolCall({
			function: { name: "read_note", arguments: { path: "Ideas/x.md" } },
		});
		expect(out).not.toBeNull();
		expect(out?.name).toBe("read_note");
		expect(out?.arguments).toEqual({ path: "Ideas/x.md" });
		expect(typeof out?.id).toBe("string");
		expect((out?.id ?? "").length).toBeGreaterThan(0);
	});

	it("returns args on a null-prototype object", () => {
		const out = parseToolCall({
			function: { name: "x", arguments: { a: 1 } },
		});
		expect(Object.getPrototypeOf(out?.arguments)).toBeNull();
	});

	it("rejects an empty name", () => {
		expect(parseToolCall({ function: { name: "", arguments: {} } })).toBeNull();
	});

	it("rejects a name longer than 200 chars", () => {
		const longName = "x".repeat(201);
		expect(
			parseToolCall({ function: { name: longName, arguments: {} } }),
		).toBeNull();
	});

	it("substitutes an empty object when arguments is missing", () => {
		const out = parseToolCall({
			function: { name: "x" } as { name: string; arguments: Record<string, unknown> },
		});
		expect(out?.arguments).toEqual({});
	});
});

describe("sanitizeArgs", () => {
	it("passes through primitives", () => {
		expect(sanitizeArgs(1)).toBe(1);
		expect(sanitizeArgs("x")).toBe("x");
		expect(sanitizeArgs(true)).toBe(true);
		expect(sanitizeArgs(null)).toBe(null);
		expect(sanitizeArgs(undefined)).toBe(undefined);
	});

	it("strips top-level pollution keys", () => {
		const out = sanitizeArgs({
			normal: 1,
			__proto__: { pwned: true },
			constructor: "x",
			prototype: "y",
		}) as Record<string, unknown>;
		expect(out.normal).toBe(1);
		expect(Object.keys(out)).toEqual(["normal"]);
	});

	// V6 — the original defense only covered the top level of the
	// arguments object. A model that nested pollution one level deeper
	// (e.g. {filter: {__proto__: {pwned: true}}}) would slip through if
	// downstream code did Object.assign or spread on args.filter.
	it("strips pollution keys at every depth (V6)", () => {
		// Build the polluted structure dynamically — `__proto__` in an
		// object literal sets the prototype rather than creating a
		// property, so we use Object.defineProperty to install it as a
		// real own-key that Object.keys will see.
		const inner: Record<string, unknown> = { ok: 42 };
		Object.defineProperty(inner, "__proto__", {
			value: { pwned: true },
			enumerable: true,
			configurable: true,
			writable: true,
		});
		const out = sanitizeArgs({ outer: { inner } }) as {
			outer: { inner: { ok: number; pwned?: boolean } };
		};
		expect(out.outer.inner.ok).toBe(42);
		expect(out.outer.inner.pwned).toBeUndefined();
		// And the prototype chain stays clean — if a buggy implementation
		// had actually mutated Object.prototype, every plain object would
		// inherit `pwned`. Verify it didn't.
		expect((Object.prototype as Record<string, unknown>).pwned).toBeUndefined();
	});

	it("preserves arrays and recurses into their elements (V6)", () => {
		const out = sanitizeArgs({
			items: [{ ok: 1 }, { ok: 2 }],
		}) as { items: Array<{ ok: number }> };
		expect(out.items).toEqual([{ ok: 1 }, { ok: 2 }]);
	});

	it("returns null past the depth cap (V6)", () => {
		type Nested = { next: Nested | string };
		// Build 12 nested {next: ...} levels — past the cap of 8.
		let nested: Nested | string = "leaf";
		for (let i = 0; i < 12; i++) nested = { next: nested };

		const result = sanitizeArgs(nested) as Nested;

		// The cap is `depth > 8`, so depth 0..8 (nine levels) survive as
		// sanitized objects, and depth 9 is replaced with null. Walking
		// nine `.next` hops from the root therefore lands on null.
		let v: unknown = result;
		for (let i = 0; i < 9; i++) {
			expect(v).not.toBeNull();
			expect(typeof v).toBe("object");
			v = (v as { next: unknown }).next;
		}
		expect(v).toBeNull();
	});
});
