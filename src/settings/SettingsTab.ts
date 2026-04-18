import { App, PluginSettingTab, Setting, setIcon } from "obsidian";
import type OllamaChatPlugin from "../../main";
import {
	ContextMode,
	DEFAULT_SYSTEM_PROMPT,
	FontSize,
	SlashCommand,
} from "./Settings";

export class OllamaChatSettingTab extends PluginSettingTab {
	private plugin: OllamaChatPlugin;
	private modelDropdownEl: HTMLSelectElement | null = null;
	private connectionStatusEl: HTMLElement | null = null;

	constructor(app: App, plugin: OllamaChatPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass("ollama-chat-settings");

		this.renderConnection(containerEl);
		this.renderGeneration(containerEl);
		this.renderContext(containerEl);
		this.renderConversations(containerEl);
		this.renderSlashCommands(containerEl);
		this.renderAppearance(containerEl);
		this.renderSupport(containerEl);
	}

	// ---------- sections ----------

	private renderConnection(container: HTMLElement): void {
		new Setting(container).setName("Connection").setHeading();

		new Setting(container)
			.setName("Base URL")
			.setDesc("Ollama server endpoint, e.g. 192.168.1.50:11434")
			.addText((text) =>
				text
					.setPlaceholder("Example: localhost:11434")
					.setValue(this.plugin.settings.baseUrl)
					.onChange(async (v) => {
						this.plugin.settings.baseUrl = v.trim();
						await this.plugin.saveSettings();
						this.plugin.ollama.setBaseUrl(this.plugin.settings.baseUrl);
					}),
			);

		const testSetting = new Setting(container)
			.setName("Test connection")
			.setDesc("Verifies the server is reachable from Obsidian.");
		testSetting.addButton((btn) =>
			btn
				.setButtonText("Test")
				.setCta()
				.onClick(async () => {
					btn.setDisabled(true);
					btn.setButtonText("Testing…");
					this.setConnectionStatus("…", "neutral");
					const res = await this.plugin.ollama.testConnection();
					this.setConnectionStatus(res.message, res.ok ? "ok" : "err");
					if (res.ok) await this.refreshModelDropdown(res.models);
					btn.setDisabled(false);
					btn.setButtonText("Test");
				}),
		);
		this.connectionStatusEl = testSetting.descEl.createDiv({
			cls: "ollama-chat-connection-status",
		});

		const modelSetting = new Setting(container)
			.setName("Model")
			.setDesc("Populated from the server when reachable.");
		modelSetting.addDropdown((dropdown) => {
			this.modelDropdownEl = dropdown.selectEl;
			dropdown.selectEl.empty();
			if (this.plugin.settings.model) {
				dropdown.addOption(this.plugin.settings.model, this.plugin.settings.model);
				dropdown.setValue(this.plugin.settings.model);
			} else {
				dropdown.addOption("", "(None — click refresh)");
			}
			dropdown.onChange(async (v) => {
				this.plugin.settings.model = v;
				await this.plugin.saveSettings();
			});
		});
		modelSetting.addExtraButton((btn) =>
			btn
				.setIcon("refresh-cw")
				.setTooltip("Refresh model list")
				.onClick(() => void this.refreshModelDropdown()),
		);

		void this.refreshModelDropdown();
	}

	private renderGeneration(container: HTMLElement): void {
		new Setting(container).setName("Generation").setHeading();

		new Setting(container)
			.setName("System prompt")
			.setDesc("Prepended to every conversation. Drop this to start fresh.")
			.addTextArea((ta) => {
				ta.setPlaceholder(DEFAULT_SYSTEM_PROMPT)
					.setValue(this.plugin.settings.systemPrompt)
					.onChange(async (v) => {
						this.plugin.settings.systemPrompt = v;
						await this.plugin.saveSettings();
					});
				ta.inputEl.rows = 5;
				ta.inputEl.addClass("ollama-chat-textarea-wide");
			});

		new Setting(container)
			.setName("Temperature")
			.setDesc("Higher = more creative, lower = more deterministic.")
			.addSlider((s) =>
				s
					.setLimits(0, 1.5, 0.1)
					.setValue(this.plugin.settings.temperature)
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.plugin.settings.temperature = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(container)
			.setName("Max tokens per response")
			.addText((text) =>
				text
					.setValue(String(this.plugin.settings.maxTokens))
					.onChange(async (v) => {
						const n = parseInt(v, 10);
						if (!Number.isFinite(n) || n <= 0) return;
						this.plugin.settings.maxTokens = n;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(container)
			.setName("Default model context limit (tokens)")
			.setDesc("Used for the token warning. Override per-model by editing data.json.")
			.addText((text) =>
				text
					.setValue(String(this.plugin.settings.defaultModelContextLimit))
					.onChange(async (v) => {
						const n = parseInt(v, 10);
						if (!Number.isFinite(n) || n <= 0) return;
						this.plugin.settings.defaultModelContextLimit = n;
						await this.plugin.saveSettings();
						this.plugin.notifyViews();
					}),
			);
	}

	private renderContext(container: HTMLElement): void {
		new Setting(container).setName("Context").setHeading();

		new Setting(container)
			.setName("Default context mode")
			.addDropdown((d) =>
				d
					.addOption("none", "No context")
					.addOption("current-note", "Current note")
					.addOption("current-selection", "Current selection")
					.addOption("linked-notes", "Current + linked notes")
					.setValue(this.plugin.settings.defaultContextMode)
					.onChange(async (v) => {
						this.plugin.settings.defaultContextMode = v as ContextMode;
						await this.plugin.saveSettings();
						this.plugin.notifyViews();
					}),
			);

		new Setting(container)
			.setName("Truncation limit (chars)")
			.setDesc("Context longer than this will be clipped with a warning.")
			.addText((text) =>
				text
					.setValue(String(this.plugin.settings.truncationLimit))
					.onChange(async (v) => {
						const n = parseInt(v, 10);
						if (!Number.isFinite(n) || n <= 0) return;
						this.plugin.settings.truncationLimit = n;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(container)
			.setName("Include frontmatter in context")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.includeFrontmatter).onChange(async (v) => {
					this.plugin.settings.includeFrontmatter = v;
					await this.plugin.saveSettings();
				}),
			);
	}

	private renderConversations(container: HTMLElement): void {
		new Setting(container).setName("Conversations").setHeading();

		new Setting(container)
			.setName("Save folder")
			.setDesc("Folder inside the vault where saved conversations land.")
			.addText((text) =>
				text
					.setPlaceholder("Chats")
					.setValue(this.plugin.settings.saveFolder)
					.onChange(async (v) => {
						this.plugin.settings.saveFolder = v.trim() || "Chats";
						await this.plugin.saveSettings();
					}),
			);

		new Setting(container)
			.setName("Filename template")
			.setDesc("Supports {{date}}, {{time}}, {{title}}.")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.filenameTemplate)
					.onChange(async (v) => {
						this.plugin.settings.filenameTemplate = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(container)
			.setName("Auto-save frequency (messages)")
			.setDesc("Set to 0 to disable.")
			.addText((text) =>
				text
					.setValue(String(this.plugin.settings.autoSaveEvery))
					.onChange(async (v) => {
						const n = parseInt(v, 10);
						if (!Number.isFinite(n) || n < 0) return;
						this.plugin.settings.autoSaveEvery = n;
						await this.plugin.saveSettings();
					}),
			);
	}

	private renderSlashCommands(container: HTMLElement): void {
		new Setting(container).setName("Slash commands").setHeading();

		const listEl = container.createDiv({ cls: "ollama-chat-slash-list" });
		const redraw = () => {
			listEl.empty();
			for (const [idx, cmd] of this.plugin.settings.slashCommands.entries()) {
				this.renderSlashRow(listEl, idx, cmd, redraw);
			}
		};
		redraw();

		new Setting(container).addButton((btn) =>
			btn
				.setButtonText("Add command")
				.onClick(async () => {
					this.plugin.settings.slashCommands.push({ name: "new", template: "" });
					await this.plugin.saveSettings();
					redraw();
				}),
		);
	}

	private renderSlashRow(
		container: HTMLElement,
		idx: number,
		cmd: SlashCommand,
		redraw: () => void,
	): void {
		const row = container.createDiv({ cls: "ollama-chat-slash-row" });
		const nameWrap = row.createDiv({ cls: "ollama-chat-slash-name" });
		nameWrap.createSpan({ text: "/", cls: "ollama-chat-slash-slash" });
		const nameInput = nameWrap.createEl("input", {
			type: "text",
			cls: "ollama-chat-slash-name-input",
		});
		nameInput.value = cmd.name;
		nameInput.addEventListener("change", () => {
			this.plugin.settings.slashCommands[idx].name = nameInput.value.trim() || cmd.name;
			void this.plugin.saveSettings();
		});

		const templateInput = row.createEl("textarea", {
			cls: "ollama-chat-slash-template",
			attr: { rows: "2", placeholder: "Template — use {{input}} for user text" },
		});
		templateInput.value = cmd.template;
		templateInput.addEventListener("change", () => {
			this.plugin.settings.slashCommands[idx].template = templateInput.value;
			void this.plugin.saveSettings();
		});

		const delBtn = row.createEl("button", { cls: "ollama-chat-slash-del clickable-icon" });
		setIcon(delBtn, "trash-2");
		delBtn.setAttr("aria-label", `Delete /${cmd.name}`);
		delBtn.addEventListener("click", () => {
			this.plugin.settings.slashCommands.splice(idx, 1);
			void this.plugin.saveSettings();
			redraw();
		});
	}

	private renderAppearance(container: HTMLElement): void {
		new Setting(container).setName("Appearance").setHeading();

		new Setting(container)
			.setName("Compact mode")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.compactMode).onChange(async (v) => {
					this.plugin.settings.compactMode = v;
					await this.plugin.saveSettings();
					this.plugin.notifyViews();
				}),
			);

		new Setting(container)
			.setName("Font size")
			.addDropdown((d) =>
				d
					.addOption("inherit", "Inherit")
					.addOption("small", "Small")
					.addOption("medium", "Medium")
					.addOption("large", "Large")
					.setValue(this.plugin.settings.fontSize)
					.onChange(async (v) => {
						this.plugin.settings.fontSize = v as FontSize;
						await this.plugin.saveSettings();
						this.plugin.notifyViews();
					}),
			);
	}

	private renderSupport(container: HTMLElement): void {
		new Setting(container).setName("Support development").setHeading();

		const blurb = container.createEl("p", { cls: "ollama-chat-support-blurb" });
		blurb.setText(
			"This plugin is free and open source. If it makes your notes more useful, consider buying me a coffee — it keeps the lights on and the models purring.",
		);

		const setting = new Setting(container)
			.setName("Ollama notes chat — enjoying it?")
			.setDesc("Buy me a coffee — one-time or recurring support.");

		const btn = setting.controlEl.createEl("button", {
			cls: "mod-cta ollama-chat-donate-btn",
			attr: { "aria-label": "Buy me a coffee donation" },
		});
		setIcon(btn.createSpan({ cls: "ollama-chat-donate-icon" }), "heart");
		btn.createSpan({ text: "Buy me a coffee" });
		btn.addEventListener("click", () => {
			window.open("https://buymeacoffee.com/tdmarchetta", "_blank");
		});
	}

	// ---------- helpers ----------

	private setConnectionStatus(msg: string, kind: "ok" | "err" | "neutral"): void {
		if (!this.connectionStatusEl) return;
		this.connectionStatusEl.empty();
		this.connectionStatusEl.removeClass(
			"ollama-conn-ok",
			"ollama-conn-err",
			"ollama-conn-neutral",
		);
		this.connectionStatusEl.addClass(`ollama-conn-${kind}`);
		this.connectionStatusEl.setText(msg);
	}

	private async refreshModelDropdown(preloaded?: string[]): Promise<void> {
		if (!this.modelDropdownEl) return;
		let models = preloaded;
		if (!models) {
			try {
				models = await this.plugin.ollama.listModels();
			} catch {
				return;
			}
		}
		const current = this.plugin.settings.model;
		this.modelDropdownEl.empty();
		if (models.length === 0) {
			const opt = document.createElement("option");
			opt.value = "";
			opt.text = "(no models installed)";
			this.modelDropdownEl.appendChild(opt);
			return;
		}
		for (const m of models) {
			const opt = document.createElement("option");
			opt.value = m;
			opt.text = m;
			this.modelDropdownEl.appendChild(opt);
		}
		if (current && models.includes(current)) {
			this.modelDropdownEl.value = current;
		} else {
			this.modelDropdownEl.value = models[0];
			this.plugin.settings.model = models[0];
			await this.plugin.saveSettings();
		}
	}
}
