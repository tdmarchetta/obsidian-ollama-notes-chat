import { describe, expect, it } from "vitest";
import { parseBoundedInt } from "./parseBoundedInt";

describe("parseBoundedInt", () => {
	it("parses a valid integer at or above the minimum", () => {
		expect(parseBoundedInt("42", 1)).toBe(42);
	});

	it("accepts the minimum boundary", () => {
		expect(parseBoundedInt("0", 0)).toBe(0);
		expect(parseBoundedInt("100", 100)).toBe(100);
	});

	it("rejects values below the minimum", () => {
		expect(parseBoundedInt("0", 1)).toBeNull();
		expect(parseBoundedInt("-5", 0)).toBeNull();
		expect(parseBoundedInt("99", 100)).toBeNull();
	});

	it("rejects non-numeric and empty input", () => {
		expect(parseBoundedInt("", 0)).toBeNull();
		expect(parseBoundedInt("abc", 0)).toBeNull();
	});

	it("enforces an optional maximum", () => {
		expect(parseBoundedInt("100", 0, 100)).toBe(100);
		expect(parseBoundedInt("101", 0, 100)).toBeNull();
	});

	it("preserves parseInt's leading-numeric behavior (matches the old guards)", () => {
		// parseInt("12px", 10) === 12 — the SettingsTab fields behaved this way
		// before extraction, so keep it.
		expect(parseBoundedInt("12px", 1)).toBe(12);
	});
});
