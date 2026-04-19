export type ContextMode = "none" | "current-note" | "current-selection" | "linked-notes" | "retrieval";

export type FontSize = "inherit" | "small" | "medium" | "large";

export interface SlashCommand {
	name: string;
	template: string;
}

export interface ModelContextLimit {
	model: string;
	limit: number;
}

export interface OllamaChatSettings {
	baseUrl: string;
	model: string;
	systemPrompt: string;
	temperature: number;
	maxTokens: number;
	modelContextLimits: ModelContextLimit[];
	defaultContextMode: ContextMode;
	truncationLimit: number;
	includeFrontmatter: boolean;
	saveFolder: string;
	filenameTemplate: string;
	autoSaveEvery: number;
	slashCommands: SlashCommand[];
	compactMode: boolean;
	fontSize: FontSize;
	defaultModelContextLimit: number;
	embedderModel: string;
	ragTopK: number;
	ragChunkSize: number;
	ragChunkOverlap: number;
	ragAutoIndex: boolean;
	rewriteSystemPrompt: string;
	rewriteTemperature: number;
}

export const DEFAULT_SYSTEM_PROMPT =
	"You are a helpful assistant working with the user's Obsidian notes. " +
	"When the user provides a note as context, answer questions about it, summarize it, expand on it, or edit it as requested. " +
	"Obsidian syntax like [[wikilinks]], #tags, and ^block-refs can appear — treat them as references to other notes and preserve them unchanged when quoting. " +
	"Respond in markdown so it renders nicely.";

export const DEFAULT_REWRITE_SYSTEM_PROMPT =
	"You are a copy editor. Rewrite the user's text for clarity and concision while preserving meaning, tone, and any Obsidian syntax (wikilinks, tags, block refs). Return ONLY the rewritten text — no explanations, no markdown code fences.";

export const DEFAULT_SETTINGS: OllamaChatSettings = {
	baseUrl: "http://localhost:11434",
	model: "",
	systemPrompt: DEFAULT_SYSTEM_PROMPT,
	temperature: 0.7,
	maxTokens: 2048,
	modelContextLimits: [],
	defaultContextMode: "current-note",
	truncationLimit: 16000,
	includeFrontmatter: true,
	saveFolder: "Chats",
	filenameTemplate: "{{date}} — {{title}}",
	autoSaveEvery: 0,
	slashCommands: [
		{
			name: "summarize",
			template: "Summarize the note in 3-5 concise bullet points.",
		},
		{
			name: "expand",
			template: "Expand the following idea with more detail, examples, and structure:\n\n{{input}}",
		},
		{
			name: "rewrite",
			template: "Rewrite the following for clarity and concision, preserving meaning:\n\n{{input}}",
		},
		{
			name: "brainstorm",
			template: "Brainstorm 8-10 diverse ideas related to:\n\n{{input}}",
		},
	],
	compactMode: false,
	fontSize: "inherit",
	defaultModelContextLimit: 8192,
	embedderModel: "nomic-embed-text",
	ragTopK: 5,
	ragChunkSize: 800,
	ragChunkOverlap: 100,
	ragAutoIndex: true,
	rewriteSystemPrompt: DEFAULT_REWRITE_SYSTEM_PROMPT,
	rewriteTemperature: 0.3,
};

export function mergeSettings(
	partial: Partial<OllamaChatSettings> | null | undefined,
): OllamaChatSettings {
	if (!partial) return { ...DEFAULT_SETTINGS };
	return {
		...DEFAULT_SETTINGS,
		...partial,
		slashCommands: partial.slashCommands ?? DEFAULT_SETTINGS.slashCommands,
		modelContextLimits:
			partial.modelContextLimits ?? DEFAULT_SETTINGS.modelContextLimits,
	};
}

export function contextLimitForModel(
	settings: OllamaChatSettings,
	model: string,
): number {
	const entry = settings.modelContextLimits.find((m) => m.model === model);
	return entry?.limit ?? settings.defaultModelContextLimit;
}
