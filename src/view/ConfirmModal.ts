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
					// eslint-disable-next-line @typescript-eslint/no-deprecated -- setWarning() retained for minAppVersion 1.7.2 compatibility; setDestructive() is a newer API
					.setWarning()
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
