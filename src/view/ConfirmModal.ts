import { App, Modal, Setting } from "obsidian";

export class ConfirmModal extends Modal {
	private resolver!: (value: boolean) => void;
	private decided = false;

	constructor(
		app: App,
		private readonly message: string,
		private readonly confirmLabel = "Delete",
	) {
		super(app);
	}

	ask(): Promise<boolean> {
		return new Promise((resolve) => {
			this.resolver = resolve;
			this.open();
		});
	}

	onOpen(): void {
		this.titleEl.setText("Are you sure?");
		this.contentEl.createEl("p", { text: this.message });
		new Setting(this.contentEl)
			.addButton((b) =>
				b.setButtonText("Cancel").onClick(() => {
					this.decided = true;
					this.resolver(false);
					this.close();
				}),
			)
			.addButton((b) =>
				b
					.setButtonText(this.confirmLabel)
					// `mod-warning` is the class the deprecated ButtonComponent.setWarning() added;
					// setClass() (non-deprecated, since 0.9.7) keeps the destructive styling without
					// needing setDestructive(), which only exists since 1.13.0 (> minAppVersion 1.7.2).
					.setClass("mod-warning")
					.onClick(() => {
						this.decided = true;
						this.resolver(true);
						this.close();
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.decided) this.resolver(false);
	}
}
