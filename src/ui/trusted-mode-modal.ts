import { App, Modal, Setting } from 'obsidian';

/**
 * Modal shown when user enables Trusted Mode to confirm they understand the risks
 */
export class TrustedModeConfirmationModal extends Modal {
	private onConfirm: (confirmed: boolean) => void;

	constructor(app: App, onConfirm: (confirmed: boolean) => void) {
		super(app);
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Enable Trusted Mode?' });

		const container = contentEl.createEl('div');

		container.createEl('p', {
			text: 'Trusted Mode allows the AI agent to create, edit, and delete files in your vault without asking for confirmation.',
		});

		const warningEl = container.createEl('p', {
			text: '⚠️ This grants the AI full write access to your vault. While convenient, it carries risks if the model hallucinates or makes mistakes.',
		});
		warningEl.style.color = 'var(--text-warning)';

		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText('Cancel').onClick(() => {
					this.close();
					this.onConfirm(false);
				})
			)
			.addButton((btn) =>
				btn
					.setButtonText('Enable Trusted Mode')
					.setWarning()
					.onClick(() => {
						this.close();
						this.onConfirm(true);
					})
			);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
