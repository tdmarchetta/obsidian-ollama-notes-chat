import { describe, expect, it, vi } from "vitest";
import type {
	ChatOptions,
	ChatStats,
	ChatStreamEvent,
	OllamaClient,
} from "../ollama/OllamaClient";
import { runToolLoop, type RunToolLoopOptions, type ToolLoopEvent } from "./ToolLoop";
import type { Tool, ToolContext } from "./VaultTools";

function fakeStats(): ChatStats {
	return {
		model: "m",
		createdAt: "2026-01-01T00:00:00Z",
		doneReason: "stop",
		promptTokens: 1,
		completionTokens: 1,
		totalTokens: 2,
		totalDurationMs: 1,
		loadDurationMs: 0,
		promptEvalDurationMs: 1,
		evalDurationMs: 1,
		tokensPerSecond: 1,
		ttftMs: 1,
		wallTimeMs: 1,
	};
}

/**
 * Fake OllamaClient whose chatStream yields one scripted event list per
 * invocation and records the options (messages, tools) of each call.
 */
function fakeOllama(script: ChatStreamEvent[][]): {
	client: OllamaClient;
	calls: ChatOptions[];
} {
	const calls: ChatOptions[] = [];
	let i = 0;
	const client = {
		async *chatStream(opts: ChatOptions): AsyncGenerator<ChatStreamEvent, void, void> {
			calls.push(opts);
			const events = script[i++] ?? [];
			for (const e of events) yield e;
		},
	} as unknown as OllamaClient;
	return { client, calls };
}

function echoTool(run?: Tool["run"]): Tool {
	return {
		spec: {
			type: "function",
			function: {
				name: "echo",
				description: "echoes args",
				parameters: { type: "object", properties: {} },
			},
		},
		run: run ?? (async (args) => Promise.resolve(JSON.stringify({ echoed: args }))),
	};
}

const ctx = { app: {} } as unknown as ToolContext;

async function collect(opts: RunToolLoopOptions): Promise<ToolLoopEvent[]> {
	const out: ToolLoopEvent[] = [];
	for await (const evt of runToolLoop(opts)) out.push(evt);
	return out;
}

function baseOpts(
	client: OllamaClient,
	registry: Map<string, Tool>,
	maxIterations = 5,
): RunToolLoopOptions {
	return {
		ollama: client,
		registry,
		baseMessages: [{ role: "user", content: "hi" }],
		model: "m",
		maxIterations,
		ctx,
	};
}

describe("runToolLoop", () => {
	it("ends after one iteration when the model makes no tool calls", async () => {
		const { client, calls } = fakeOllama([
			[
				{ type: "delta", text: "hel" },
				{ type: "delta", text: "lo" },
				{ type: "stats", stats: fakeStats() },
			],
		]);
		const events = await collect(baseOpts(client, new Map([["echo", echoTool()]])));
		expect(events.map((e) => e.type)).toEqual([
			"iteration_start",
			"delta",
			"delta",
			"stats",
		]);
		expect(calls).toHaveLength(1);
	});

	it("passes the registry's specs as tools on every request", async () => {
		const tool = echoTool();
		const { client, calls } = fakeOllama([[{ type: "delta", text: "x" }]]);
		await collect(baseOpts(client, new Map([["echo", tool]])));
		expect(calls[0]!.tools).toEqual([tool.spec]);
	});

	it("executes a tool call and feeds the result back into the next request", async () => {
		const runSpy = vi.fn(async (args: Record<string, unknown>) =>
			Promise.resolve(JSON.stringify({ echoed: args })),
		);
		const { client, calls } = fakeOllama([
			[
				{ type: "delta", text: "thinking" },
				{ type: "tool_calls", calls: [{ id: "c1", name: "echo", arguments: { a: 1 } }] },
			],
			[{ type: "delta", text: "done" }],
		]);
		const events = await collect(baseOpts(client, new Map([["echo", echoTool(runSpy)]])));

		expect(runSpy).toHaveBeenCalledWith({ a: 1 }, ctx);
		const result = events.find((e) => e.type === "tool_result");
		expect(result && result.type === "tool_result" && result.error).toBeUndefined();

		// Second request carries the assistant tool_calls message + tool result.
		expect(calls).toHaveLength(2);
		const second = calls[1]!.messages;
		const assistant = second.find((m) => m.role === "assistant");
		expect(assistant?.content).toBe("thinking");
		expect(assistant?.tool_calls?.[0]?.function.name).toBe("echo");
		const toolMsg = second.find((m) => m.role === "tool");
		expect(toolMsg?.tool_call_id).toBe("c1");
		expect(toolMsg?.name).toBe("echo");
		expect(toolMsg?.content).toBe(JSON.stringify({ echoed: { a: 1 } }));
	});

	it("does not mutate the caller's baseMessages array", async () => {
		const base = [{ role: "user" as const, content: "hi" }];
		const { client } = fakeOllama([
			[{ type: "tool_calls", calls: [{ id: "c1", name: "echo", arguments: {} }] }],
			[{ type: "delta", text: "ok" }],
		]);
		await collect({ ...baseOpts(client, new Map([["echo", echoTool()]])), baseMessages: base });
		expect(base).toHaveLength(1);
	});

	it("reports an unknown tool as an error result and keeps looping", async () => {
		const { client, calls } = fakeOllama([
			[{ type: "tool_calls", calls: [{ id: "c1", name: "nope", arguments: {} }] }],
			[{ type: "delta", text: "recovered" }],
		]);
		const events = await collect(baseOpts(client, new Map([["echo", echoTool()]])));
		const result = events.find((e) => e.type === "tool_result");
		if (!result || result.type !== "tool_result") throw new Error("missing tool_result");
		expect(result.error).toBe("unknown tool: nope");
		expect(result.result).toBe(JSON.stringify({ error: "unknown tool: nope" }));
		// The error string is fed back to the model as a tool message.
		expect(calls[1]!.messages.find((m) => m.role === "tool")?.content).toContain(
			"unknown tool",
		);
	});

	it("captures a throwing tool as an error result instead of aborting the loop", async () => {
		const thrower = echoTool(() => Promise.reject(new Error("boom")));
		const { client } = fakeOllama([
			[{ type: "tool_calls", calls: [{ id: "c1", name: "echo", arguments: {} }] }],
			[{ type: "delta", text: "ok" }],
		]);
		const events = await collect(baseOpts(client, new Map([["echo", thrower]])));
		const result = events.find((e) => e.type === "tool_result");
		if (!result || result.type !== "tool_result") throw new Error("missing tool_result");
		expect(result.error).toBe("boom");
		expect(result.result).toBe(JSON.stringify({ error: "boom" }));
	});

	it("yields cap_reached and skips execution when the final iteration still wants tools", async () => {
		const runSpy = vi.fn(async () => Promise.resolve("{}"));
		const { client, calls } = fakeOllama([
			[{ type: "tool_calls", calls: [{ id: "c1", name: "echo", arguments: {} }] }],
			[{ type: "tool_calls", calls: [{ id: "c2", name: "echo", arguments: {} }] }],
		]);
		const events = await collect(baseOpts(client, new Map([["echo", echoTool(runSpy)]]), 2));
		expect(events.filter((e) => e.type === "cap_reached")).toHaveLength(1);
		// Iteration 0 executed its tool; the capped final iteration did not.
		expect(runSpy).toHaveBeenCalledTimes(1);
		expect(calls).toHaveLength(2);
	});

	it("forwards stats per iteration with the iteration number", async () => {
		const { client } = fakeOllama([
			[
				{ type: "tool_calls", calls: [{ id: "c1", name: "echo", arguments: {} }] },
				{ type: "stats", stats: fakeStats() },
			],
			[
				{ type: "delta", text: "x" },
				{ type: "stats", stats: fakeStats() },
			],
		]);
		const events = await collect(baseOpts(client, new Map([["echo", echoTool()]])));
		const stats = events.filter((e) => e.type === "stats");
		expect(stats.map((s) => (s.type === "stats" ? s.iteration : -1))).toEqual([0, 1]);
	});
});
