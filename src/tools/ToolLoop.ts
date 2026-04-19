import type {
	ChatMessage,
	ChatStats,
	OllamaClient,
	ParsedToolCall,
} from "../ollama/OllamaClient";
import type { Tool, ToolContext } from "./VaultTools";
import { vaultToolSpecs } from "./VaultTools";

export type ToolLoopEvent =
	| { type: "iteration_start"; iteration: number }
	| { type: "delta"; text: string }
	| { type: "tool_calls"; calls: ParsedToolCall[] }
	| { type: "tool_result"; call: ParsedToolCall; result: string; error?: string }
	| { type: "stats"; stats: ChatStats; iteration: number }
	| { type: "cap_reached"; iteration: number };

export interface RunToolLoopOptions {
	ollama: OllamaClient;
	registry: Map<string, Tool>;
	baseMessages: ChatMessage[];
	model: string;
	temperature?: number;
	maxTokens?: number;
	maxIterations: number;
	ctx: ToolContext;
	signal?: AbortSignal;
}

export async function* runToolLoop(
	opts: RunToolLoopOptions,
): AsyncGenerator<ToolLoopEvent, void, void> {
	const specs = vaultToolSpecs(opts.registry);
	const messages: ChatMessage[] = opts.baseMessages.slice();

	for (let iter = 0; iter < opts.maxIterations; iter++) {
		yield { type: "iteration_start", iteration: iter };

		const deltaParts: string[] = [];
		const collectedCalls: ParsedToolCall[] = [];
		let collectedStats: ChatStats | null = null;

		for await (const evt of opts.ollama.chatStream({
			messages,
			model: opts.model,
			temperature: opts.temperature,
			maxTokens: opts.maxTokens,
			tools: specs,
			signal: opts.signal,
		})) {
			if (evt.type === "delta") {
				deltaParts.push(evt.text);
				yield { type: "delta", text: evt.text };
			} else if (evt.type === "tool_calls") {
				collectedCalls.push(...evt.calls);
				yield { type: "tool_calls", calls: evt.calls };
			} else if (evt.type === "stats") {
				collectedStats = evt.stats;
			}
		}

		if (collectedStats) {
			yield { type: "stats", stats: collectedStats, iteration: iter };
		}

		if (collectedCalls.length === 0) return;

		if (iter === opts.maxIterations - 1) {
			yield { type: "cap_reached", iteration: iter };
			return;
		}

		messages.push({
			role: "assistant",
			content: deltaParts.join(""),
			tool_calls: collectedCalls.map((c) => ({
				function: { name: c.name, arguments: c.arguments },
			})),
		});

		for (const call of collectedCalls) {
			let result: string;
			let error: string | undefined;
			const tool = opts.registry.get(call.name);
			if (!tool) {
				error = `unknown tool: ${call.name}`;
				result = JSON.stringify({ error });
			} else {
				try {
					result = await tool.run(call.arguments, opts.ctx);
				} catch (e) {
					error = e instanceof Error ? e.message : String(e);
					result = JSON.stringify({ error });
				}
			}
			yield { type: "tool_result", call, result, error };
			messages.push({
				role: "tool",
				content: result,
				tool_call_id: call.id,
				name: call.name,
			});
		}
	}
}
