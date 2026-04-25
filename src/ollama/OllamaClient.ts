import { requestUrl } from "obsidian";

export interface OllamaToolCall {
	function: {
		name: string;
		arguments: Record<string, unknown>;
	};
}

export interface ChatMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string;
	tool_calls?: OllamaToolCall[];
	tool_call_id?: string;
	name?: string;
}

export interface ToolSpec {
	type: "function";
	function: {
		name: string;
		description: string;
		parameters: {
			type: "object";
			properties: Record<string, unknown>;
			required?: string[];
		};
	};
}

export interface ParsedToolCall {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}

export interface ChatOptions {
	messages: ChatMessage[];
	model: string;
	temperature?: number;
	maxTokens?: number;
	tools?: ToolSpec[];
	signal?: AbortSignal;
}

export interface TestConnectionResult {
	ok: boolean;
	message: string;
	models?: string[];
}

/** Stats returned by Ollama's native /api/chat on the final `done` chunk, plus
 *  locally-measured wall-clock fields. Durations are in milliseconds. */
export interface ChatStats {
	model: string;
	createdAt: string; // ISO timestamp from server
	doneReason: string;
	promptTokens: number; // prompt_eval_count
	completionTokens: number; // eval_count
	totalTokens: number; // sum
	totalDurationMs: number; // total server-side time
	loadDurationMs: number; // time to load model into memory (0 if warm)
	promptEvalDurationMs: number; // time to process the prompt
	evalDurationMs: number; // time to generate output
	tokensPerSecond: number; // eval_count / eval_duration
	ttftMs: number; // client-measured time to first token
	wallTimeMs: number; // client-measured total request duration
}

export type ChatStreamEvent =
	| { type: "delta"; text: string }
	| { type: "tool_calls"; calls: ParsedToolCall[] }
	| { type: "stats"; stats: ChatStats };

export class OllamaClient {
	private baseUrl: string;

	constructor(baseUrl: string) {
		this.baseUrl = normalize(baseUrl);
	}

	setBaseUrl(baseUrl: string): void {
		this.baseUrl = normalize(baseUrl);
	}

	getBaseUrl(): string {
		return this.baseUrl;
	}

	private requireBaseUrl(): void {
		if (!this.baseUrl) {
			throw new Error(
				"Ollama base URL is missing or invalid — set a http(s) URL in settings.",
			);
		}
	}

	async embed(model: string, input: string | string[]): Promise<number[][]> {
		this.requireBaseUrl();
		const body = { model, input };
		const res = await requestUrl({
			url: `${this.baseUrl}/api/embed`,
			method: "POST",
			headers: { "Content-Type": "application/json", Accept: "application/json" },
			body: JSON.stringify(body),
			throw: false,
		});
		if (res.status < 200 || res.status >= 300) {
			throw new Error(`Ollama /api/embed returned ${res.status}`);
		}
		const parsed = res.json as { embeddings?: number[][] };
		const embeddings = parsed.embeddings;
		if (!Array.isArray(embeddings) || embeddings.length === 0) {
			throw new Error("Ollama /api/embed returned no embeddings");
		}
		return embeddings;
	}

	async chatOnce(opts: ChatOptions): Promise<string> {
		this.requireBaseUrl();
		const body: Record<string, unknown> = {
			model: opts.model,
			messages: opts.messages,
			stream: false,
			options: {
				temperature: opts.temperature ?? 0.7,
				num_predict: opts.maxTokens ?? 2048,
			},
		};
		if (opts.tools && opts.tools.length > 0) body.tools = opts.tools;
		const res = await requestUrl({
			url: `${this.baseUrl}/api/chat`,
			method: "POST",
			headers: { "Content-Type": "application/json", Accept: "application/json" },
			body: JSON.stringify(body),
			throw: false,
		});
		if (res.status < 200 || res.status >= 300) {
			throw new Error(`Ollama /api/chat returned ${res.status}`);
		}
		const parsed = res.json as {
			message?: { content?: string; tool_calls?: OllamaToolCall[] };
		};
		const content = parsed.message?.content;
		const rawCalls = parsed.message?.tool_calls;
		const hasToolCalls = Array.isArray(rawCalls) && rawCalls.length > 0;
		if (typeof content !== "string") {
			if (hasToolCalls) return "";
			throw new Error("Ollama /api/chat returned no message content");
		}
		return content;
	}

	async listModels(): Promise<string[]> {
		this.requireBaseUrl();
		const res = await requestUrl({
			url: `${this.baseUrl}/api/tags`,
			method: "GET",
			headers: { Accept: "application/json" },
			throw: false,
		});
		if (res.status < 200 || res.status >= 300) {
			throw new Error(`Ollama /api/tags returned ${res.status}`);
		}
		const body = res.json as { models?: Array<{ name?: string }> };
		const names = (body.models ?? [])
			.map((m) => m.name)
			.filter((n): n is string => typeof n === "string" && n.length > 0);
		return names.sort((a, b) => a.localeCompare(b));
	}

	async testConnection(): Promise<TestConnectionResult> {
		try {
			const models = await this.listModels();
			return {
				ok: true,
				message: `Connected — ${models.length} model${models.length === 1 ? "" : "s"} available.`,
				models,
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			const hint =
				/Failed to fetch|NetworkError|TypeError/i.test(msg)
					? " — check that Ollama is running, OLLAMA_HOST=0.0.0.0:11434 is set, and OLLAMA_ORIGINS=* allows Obsidian."
					: "";
			return { ok: false, message: `Cannot reach server: ${msg}${hint}` };
		}
	}

	async *chatStream(opts: ChatOptions): AsyncGenerator<ChatStreamEvent, void, void> {
		this.requireBaseUrl();
		const body: Record<string, unknown> = {
			model: opts.model,
			messages: opts.messages,
			stream: true,
			options: {
				temperature: opts.temperature ?? 0.7,
				num_predict: opts.maxTokens ?? 2048,
			},
		};
		if (opts.tools && opts.tools.length > 0) body.tools = opts.tools;

		const startedAt = performance.now();
		let firstTokenAt: number | null = null;

		// Streaming NDJSON from /api/chat needs a ReadableStream. Obsidian's
		// requestUrl buffers the full body and would break the live-token UX
		// this plugin is built around, so fetch stays. See ADR-002.
		// eslint-disable-next-line no-restricted-globals -- streaming requires ReadableStream; see ADR-002
		const res = await fetch(`${this.baseUrl}/api/chat`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/x-ndjson",
			},
			body: JSON.stringify(body),
			signal: opts.signal,
		});

		if (!res.ok) {
			let text = "";
			try {
				text = await res.text();
			} catch {
				// ignore
			}
			throw new Error(
				`Ollama chat failed: ${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 200)}` : ""}`,
			);
		}
		if (!res.body) {
			throw new Error("Ollama chat returned no response body.");
		}

		const reader = res.body.getReader();
		const decoder = new TextDecoder("utf-8");
		let buffer = "";
		// Cap per-line NDJSON buffer so a hostile or malfunctioning server that
		// never emits a newline cannot exhaust memory. Real Ollama chunks are
		// well under 1 MB; 8 MB is a generous ceiling before we bail.
		const MAX_BUFFER_BYTES = 8 * 1024 * 1024;

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				if (buffer.length > MAX_BUFFER_BYTES) {
					throw new Error(
						`Ollama stream exceeded ${MAX_BUFFER_BYTES} bytes without a newline — aborting.`,
					);
				}

				let nlIdx: number;
				while ((nlIdx = buffer.indexOf("\n")) !== -1) {
					const line = buffer.slice(0, nlIdx).trim();
					buffer = buffer.slice(nlIdx + 1);
					if (!line) continue;

					let parsed: OllamaChatChunk;
					try {
						parsed = JSON.parse(line) as OllamaChatChunk;
					} catch {
						continue;
					}

					const delta = parsed.message?.content;
					if (typeof delta === "string" && delta.length > 0) {
						if (firstTokenAt === null) firstTokenAt = performance.now();
						yield { type: "delta", text: delta };
					}

					const rawCalls = parsed.message?.tool_calls;
					if (Array.isArray(rawCalls) && rawCalls.length > 0) {
						const calls = rawCalls
							.map(parseToolCall)
							.filter((c): c is ParsedToolCall => c !== null);
						if (calls.length > 0) yield { type: "tool_calls", calls };
					}

					if (parsed.done) {
						const wallTimeMs = performance.now() - startedAt;
						const ttftMs =
							firstTokenAt !== null ? firstTokenAt - startedAt : wallTimeMs;
						const evalMs = nsToMs(parsed.eval_duration);
						const evalCount = parsed.eval_count ?? 0;
						const tps = evalMs > 0 ? (evalCount / evalMs) * 1000 : 0;
						const stats: ChatStats = {
							model: parsed.model ?? opts.model,
							createdAt: parsed.created_at ?? new Date().toISOString(),
							doneReason: parsed.done_reason ?? "unknown",
							promptTokens: parsed.prompt_eval_count ?? 0,
							completionTokens: evalCount,
							totalTokens: (parsed.prompt_eval_count ?? 0) + evalCount,
							totalDurationMs: nsToMs(parsed.total_duration),
							loadDurationMs: nsToMs(parsed.load_duration),
							promptEvalDurationMs: nsToMs(parsed.prompt_eval_duration),
							evalDurationMs: evalMs,
							tokensPerSecond: tps,
							ttftMs,
							wallTimeMs,
						};
						yield { type: "stats", stats };
						return;
					}
				}
			}
		} finally {
			try {
				reader.releaseLock();
			} catch {
				// ignore
			}
		}
	}
}

interface OllamaChatChunk {
	model?: string;
	created_at?: string;
	message?: {
		role?: string;
		content?: string;
		tool_calls?: OllamaToolCall[];
	};
	done?: boolean;
	done_reason?: string;
	total_duration?: number;
	load_duration?: number;
	prompt_eval_count?: number;
	prompt_eval_duration?: number;
	eval_count?: number;
	eval_duration?: number;
}

function parseToolCall(raw: OllamaToolCall): ParsedToolCall | null {
	const fn = raw?.function;
	if (!fn || typeof fn.name !== "string" || fn.name.length === 0) return null;
	// Cap the tool name at a sane length so a model echoing megabytes of
	// junk into the name field can't bloat message history or UI chips.
	if (fn.name.length > 200) return null;
	const rawArgs: Record<string, unknown> =
		fn.arguments && typeof fn.arguments === "object" && !Array.isArray(fn.arguments)
			? fn.arguments
			: {};
	// Copy only own-enumerable keys into a null-prototype object so any
	// "__proto__" / "constructor" keys the model produces land on a dead
	// target instead of shadowing Object.prototype for downstream code.
	const args: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const k of Object.keys(rawArgs)) {
		if (!Object.prototype.hasOwnProperty.call(rawArgs, k)) continue;
		if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
		args[k] = rawArgs[k];
	}
	return { id: newCallId(), name: fn.name, arguments: args };
}

function newCallId(): string {
	const c = (globalThis as { crypto?: Crypto }).crypto;
	if (c && typeof c.randomUUID === "function") return c.randomUUID();
	return `tc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function nsToMs(ns: number | undefined): number {
	if (typeof ns !== "number" || !Number.isFinite(ns)) return 0;
	return ns / 1_000_000;
}

/**
 * Normalize and validate an Ollama base URL.
 *
 * The URL lands in `fetch()` / `requestUrl()` unsanitized, so we must reject
 * anything that isn't http(s): without this, a `file://` or `javascript:`
 * value (from data.json tampering or a typo) would be dispatched verbatim
 * by Electron's fetch.
 *
 * Empty input is tolerated (the client is instantiated before settings
 * merge finishes); the caller's fetch will fail loudly.
 */
function normalize(url: string): string {
	const trimmed = url.trim().replace(/\/+$/, "");
	if (!trimmed) return "";
	try {
		const parsed = new URL(trimmed);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			console.warn(
				`[ollama-notes-chat] rejecting non-http(s) base URL scheme "${parsed.protocol}"`,
			);
			return "";
		}
		return trimmed;
	} catch {
		console.warn(`[ollama-notes-chat] rejecting malformed base URL "${url}"`);
		return "";
	}
}
