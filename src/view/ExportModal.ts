import { App, Modal, Notice, Setting } from "obsidian";
import type OllamaChatPlugin from "../../main";
import type { Conversation } from "../chat/Conversation";
import {
	exportToMarkdown,
	exportToJson,
	filterByDateRange,
} from "../chat/ExportConversation";

type ExportScope = "this" | "all" | "date-range";
type ExportFormat = "md" | "json";

export class ExportModal extends Modal {
	private format: ExportFormat;
	private exportScope: ExportScope;
	private startDate = "";
	private endDate = "";
	private exportFolderValue: string;
	private dateRangeEl: HTMLElement | null = null;
	private scopeBtns: Map<ExportScope, HTMLButtonElement> = new Map();

	constructor(
		app: App,
		private readonly plugin: OllamaChatPlugin,
		private readonly activeConv: Conversation,
		initialScope: ExportScope = "this",
	) {
		super(app);
		this.exportScope = initialScope;
		this.format = plugin.settings.exportDefaultFormat;
		this.exportFolderValue = plugin.settings.exportFolder;
	}

	onOpen(): void {
		this.titleEl.setText("Export conversations");
		this.contentEl.addClass("ollama-chat-export-modal");

		new Setting(this.contentEl)
			.setName("Format")
			.addDropdown((d) =>
				d
					.addOption("md", "Markdown")
					.addOption("json", "JSON")
					.setValue(this.format)
					.onChange((v) => {
						this.format = v as ExportFormat;
					}),
			);

		const scopeSetting = new Setting(this.contentEl).setName("Scope");
		const scopeWrap = scopeSetting.controlEl.createDiv({
			cls: "ollama-chat-export-scope-buttons",
		});
		const scopeOptions: Array<{ value: ExportScope; label: string }> = [
			{ value: "this", label: "This conversation" },
			{ value: "all", label: "All conversations" },
			{ value: "date-range", label: "Date range" },
		];
		for (const opt of scopeOptions) {
			const btn = scopeWrap.createEl("button", {
				cls: "ollama-chat-export-scope-btn",
				text: opt.label,
			});
			this.scopeBtns.set(opt.value, btn);
			btn.addEventListener("click", () => this.setScope(opt.value));
		}
		this.highlightScope();

		this.dateRangeEl = this.contentEl.createDiv({
			cls: "ollama-chat-export-date-range",
		});
		new Setting(this.dateRangeEl)
			.setName("Start date")
			.addText((t) =>
				t.setPlaceholder("2026-01-01").onChange((v) => {
					this.startDate = v.trim();
				}),
			);
		new Setting(this.dateRangeEl)
			.setName("End date")
			.addText((t) =>
				t.setPlaceholder("2026-12-31").onChange((v) => {
					this.endDate = v.trim();
				}),
			);
		this.toggleDateRange();

		new Setting(this.contentEl)
			.setName("Output folder")
			.setDesc("Vault folder where exported files will be created.")
			.addText((t) =>
				t
					.setPlaceholder("Chats")
					.setValue(this.exportFolderValue)
					.onChange((v) => {
						this.exportFolderValue = v.trim() || "Chats";
					}),
			);

		new Setting(this.contentEl).addButton((b) =>
			b
				.setButtonText("Export")
				.setCta()
				.onClick(() => void this.doExport()),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private setScope(scope: ExportScope): void {
		this.exportScope = scope;
		this.highlightScope();
		this.toggleDateRange();
	}

	private highlightScope(): void {
		for (const [value, btn] of this.scopeBtns) {
			btn.toggleClass("mod-cta", value === this.exportScope);
		}
	}

	private toggleDateRange(): void {
		if (!this.dateRangeEl) return;
		if (this.exportScope === "date-range") {
			this.dateRangeEl.show();
		} else {
			this.dateRangeEl.hide();
		}
	}

	private async doExport(): Promise<void> {
		try {
			const all = this.plugin.store.toPersistable().conversations ?? [];
			let snapshots = all;

			if (this.exportScope === "this") {
				if (this.activeConv.isEmpty) {
					new Notice("Active conversation is empty.");
					return;
				}
				snapshots = [this.activeConv.toSnapshot()];
			} else if (this.exportScope === "date-range") {
				try {
					snapshots = filterByDateRange(all, this.startDate, this.endDate);
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					new Notice(`Export failed: ${msg}`, 6000);
					return;
				}
			}

			if (snapshots.length === 0) {
				new Notice("No conversations match that scope.");
				return;
			}

			const folder = this.exportFolderValue || "Chats";

			if (this.format === "md") {
				const count = await exportToMarkdown(
					this.app,
					snapshots,
					folder,
					this.plugin.settings.filenameTemplate,
				);
				new Notice(
					`Exported ${count} conversation${count === 1 ? "" : "s"} to ${folder}`,
				);
			} else {
				const path = await exportToJson(this.app, snapshots, folder);
				new Notice(
					`Exported ${snapshots.length} conversation${snapshots.length === 1 ? "" : "s"} to ${path}`,
				);
			}

			this.close();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			new Notice(`Export failed: ${msg}`, 6000);
		}
	}
}
