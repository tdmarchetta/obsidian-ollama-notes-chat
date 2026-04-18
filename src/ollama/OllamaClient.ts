import { requestUrl } from "obsidian";

export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export interface ChatOptions {
	messages: ChatMessage[];
	model: string;
	temperature?: number;
	maxTokens?: number;
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

	async embed(model: string, input: string | string[]): Promise<number[][]> {
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

	async listModels(): Promise<string[]> {
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
		const body = {
			model: opts.model,
			messages: opts.messages,
			stream: true,
			options: {
				temperature: opts.temperature ?? 0.7,
				num_predict: opts.maxTokens ?? 2048,
			},
		};

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

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });

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
	message?: { role?: string; content?: string };
	done?: boolean;
	done_reason?: string;
	total_duration?: number;
	load_duration?: number;
	prompt_eval_count?: number;
	prompt_eval_duration?: number;
	eval_count?: number;
	eval_duration?: number;
}

function nsToMs(ns: number | undefined): number {
	if (typeof ns !== "number" || !Number.isFinite(ns)) return 0;
	return ns / 1_000_000;
}

function normalize(url: string): string {
	return url.replace(/\/+$/, "");
}
