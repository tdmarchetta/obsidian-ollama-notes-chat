import { App, Modal } from "obsidian";
import type { ChatStats } from "../ollama/OllamaClient";
import type { Message } from "../chat/Conversation";

export class StatsModal extends Modal {
	private stats: ChatStats;
	private message: Message;

	constructor(app: App, stats: ChatStats, message: Message) {
		super(app);
		this.stats = stats;
		this.message = message;
	}

	onOpen(): void {
		const { contentEl, titleEl } = this;
		titleEl.setText("Response stats");
		contentEl.empty();
		contentEl.addClass("ollama-chat-stats-modal");

		this.renderGroup(contentEl, "Tokens", [
			["Model", this.stats.model],
			["Finish reason", this.stats.doneReason],
			["Input (prompt)", fmtInt(this.stats.promptTokens)],
			["Output (completion)", fmtInt(this.stats.completionTokens)],
			["Total", fmtInt(this.stats.totalTokens)],
			["Tokens / second", this.stats.tokensPerSecond.toFixed(1)],
		]);

		this.renderGroup(contentEl, "Timing", [
			[
				"Time to first token",
				`${fmtMs(this.stats.ttftMs)}${this.stats.loadDurationMs > 100 ? "  (cold model)" : ""}`,
			],
			["Model load", fmtMs(this.stats.loadDurationMs)],
			["Prompt eval", fmtMs(this.stats.promptEvalDurationMs)],
			["Generation", fmtMs(this.stats.evalDurationMs)],
			["Total (server)", fmtMs(this.stats.totalDurationMs)],
			["Total (wall clock)", fmtMs(this.stats.wallTimeMs)],
		]);

		this.renderGroup(contentEl, "Context", [
			["Context mode", this.message.contextMode ?? "—"],
			["Source note", this.message.contextSourceNote ?? "—"],
			["Stopped early", this.message.stopped ? "yes" : "no"],
			["Timestamp", new Date(this.stats.createdAt).toLocaleString()],
		]);

		const actions = contentEl.createDiv({ cls: "ollama-chat-stats-actions" });
		const copyBtn = actions.createEl("button", {
			cls: "mod-cta",
			text: "Copy as Markdown",
		});
		copyBtn.addEventListener("click", () => {
			void navigator.clipboard.writeText(this.asMarkdown());
			copyBtn.setText("Copied ✓");
			setTimeout(() => copyBtn.setText("Copy as Markdown"), 1200);
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private renderGroup(parent: HTMLElement, title: string, rows: [string, string][]): void {
		const group = parent.createDiv({ cls: "ollama-chat-stats-group" });
		group.createDiv({ cls: "ollama-chat-stats-group-title", text: title });
		const table = group.createEl("table", { cls: "ollama-chat-stats-table" });
		for (const [label, value] of rows) {
			const tr = table.createEl("tr");
			tr.createEl("th", { text: label });
			tr.createEl("td", { text: value });
		}
	}

	private asMarkdown(): string {
		const s = this.stats;
		return [
			`**Model:** ${s.model}`,
			`**Prompt tokens:** ${s.promptTokens}`,
			`**Completion tokens:** ${s.completionTokens}`,
			`**Tokens/sec:** ${s.tokensPerSecond.toFixed(1)}`,
			`**Time to first token:** ${fmtMs(s.ttftMs)}`,
			`**Model load:** ${fmtMs(s.loadDurationMs)}`,
			`**Prompt eval:** ${fmtMs(s.promptEvalDurationMs)}`,
			`**Generation:** ${fmtMs(s.evalDurationMs)}`,
			`**Total (wall):** ${fmtMs(s.wallTimeMs)}`,
			`**Finish reason:** ${s.doneReason}`,
		].join("\n");
	}
}

function fmtInt(n: number | undefined): string {
	if (typeof n !== "number" || !Number.isFinite(n)) return "—";
	return n.toLocaleString();
}

function fmtMs(ms: number): string {
	if (!Number.isFinite(ms) || ms <= 0) return "—";
	if (ms < 1000) return `${ms.toFixed(0)} ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(2)} s`;
	const m = Math.floor(ms / 60_000);
	const s = (ms - m * 60_000) / 1000;
	return `${m}m ${s.toFixed(1)}s`;
}
