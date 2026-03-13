import { App, Modal, Setting } from 'obsidian';

/**
 * Confirmation modal shown when user selects YOLO Mode.
 *
 * YOLO Mode auto-approves all tool calls, including destructive and
 * external operations. The user must explicitly confirm they understand
 * the risks.
 */
export class YoloConfirmationModal extends Modal {
	private onConfirm: (confirmed: boolean) => void;
	private resolved = false;

	constructor(app: App, onConfirm: (confirmed: boolean) => void) {
		super(app);
		this.onConfirm = onConfirm;
	}

	onOpen() {
		this.resolved = false;
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Enable YOLO Mode?' });

		const container = contentEl.createEl('div');

		container.createEl('p', {
			text: 'YOLO Mode allows the AI agent to execute all tools without any confirmation — including creating, editing, deleting, and moving files, as well as external API calls.',
		});

		const warningEl = container.createEl('p', {
			text: '⚠️ This grants the AI full, unsupervised access to your vault and external services. There is no undo for destructive operations.',
		});
		warningEl.style.color = 'var(--text-warning)';
		warningEl.style.fontWeight = 'bold';

		container.createEl('p', {
			text: 'Only enable this if you fully trust the AI model and understand the potential consequences.',
		});

		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText('Cancel').onClick(() => {
					this.resolved = true;
					this.close();
					this.onConfirm(false);
				})
			)
			.addButton((btn) =>
				btn
					.setButtonText('Enable YOLO Mode')
					.setWarning()
					.onClick(() => {
						this.resolved = true;
						this.close();
						this.onConfirm(true);
					})
			);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
		// If user closes via Escape or clicking outside, treat as cancel
		if (!this.resolved) {
			this.onConfirm(false);
		}
	}
}
