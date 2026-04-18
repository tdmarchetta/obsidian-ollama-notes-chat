import { SlashCommand } from "../settings/Settings";

export interface SlashMatch {
	command: SlashCommand;
	rest: string;
}

export function parseSlash(
	input: string,
	commands: SlashCommand[],
): SlashMatch | null {
	const trimmed = input.trimStart();
	if (!trimmed.startsWith("/")) return null;
	const firstSpace = trimmed.search(/\s/);
	const name = (firstSpace === -1 ? trimmed.slice(1) : trimmed.slice(1, firstSpace)).toLowerCase();
	if (!name) return null;
	const command = commands.find((c) => c.name.toLowerCase() === name);
	if (!command) return null;
	const rest = firstSpace === -1 ? "" : trimmed.slice(firstSpace + 1);
	return { command, rest: rest.trim() };
}

export function expandTemplate(
	template: string,
	vars: { input: string; context?: string },
): string {
	return template
		.replaceAll("{{input}}", vars.input)
		.replaceAll("{{context}}", vars.context ?? "");
}

export function matchingCompletions(
	partial: string,
	commands: SlashCommand[],
): SlashCommand[] {
	const trimmed = partial.trimStart();
	if (!trimmed.startsWith("/")) return [];
	const frag = trimmed.slice(1).toLowerCase();
	if (frag.includes(" ")) return [];
	return commands.filter((c) => c.name.toLowerCase().startsWith(frag));
}
