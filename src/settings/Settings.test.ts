import { describe, expect, it } from "vitest";
import {
	contextLimitForModel,
	DEFAULT_SETTINGS,
	mergeSettings,
	type OllamaChatSettings,
} from "./Settings";

describe("mergeSettings", () => {
	it("returns a copy of the defaults for null/undefined", () => {
		expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
	});

	it("returns a fresh object, not the defaults reference", () => {
		expect(mergeSettings(null)).not.toBe(DEFAULT_SETTINGS);
	});

	it("overlays provided fields over the defaults", () => {
		const merged = mergeSettings({ temperature: 0.1, model: "llama3" });
		expect(merged.temperature).toBe(0.1);
		expect(merged.model).toBe("llama3");
		expect(merged.maxTokens).toBe(DEFAULT_SETTINGS.maxTokens); // untouched default
	});

	it("falls back to default slashCommands / modelContextLimits when absent", () => {
		const merged = mergeSettings({ model: "x" });
		expect(merged.slashCommands).toEqual(DEFAULT_SETTINGS.slashCommands);
		expect(merged.modelContextLimits).toEqual(DEFAULT_SETTINGS.modelContextLimits);
	});

	it("honors an explicitly empty slashCommands array", () => {
		expect(mergeSettings({ slashCommands: [] }).slashCommands).toEqual([]);
	});

	it("does not mutate DEFAULT_SETTINGS", () => {
		mergeSettings({ temperature: 0 });
		expect(DEFAULT_SETTINGS.temperature).toBe(0.7);
	});
});

describe("contextLimitForModel", () => {
	const settings: OllamaChatSettings = {
		...DEFAULT_SETTINGS,
		defaultModelContextLimit: 4096,
		modelContextLimits: [{ model: "llama3", limit: 32000 }],
	};

	it("returns the per-model limit when one is configured", () => {
		expect(contextLimitForModel(settings, "llama3")).toBe(32000);
	});

	it("falls back to the default limit for an unknown model", () => {
		expect(contextLimitForModel(settings, "mistral")).toBe(4096);
	});
});
