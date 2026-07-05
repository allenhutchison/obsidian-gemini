import { App, Modal, Setting } from 'obsidian';
import { t } from '../i18n';

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

		contentEl.createEl('h2', { text: t('yolo.title') });

		const container = contentEl.createDiv();

		container.createEl('p', {
			text: t('yolo.description'),
		});

		const warningEl = container.createEl('p', {
			text: t('yolo.warning'),
		});
		warningEl.style.color = 'var(--text-warning)';
		warningEl.style.fontWeight = 'bold';

		container.createEl('p', {
			text: t('yolo.trustNote'),
		});

		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText(t('yolo.cancelButton')).onClick(() => {
					this.resolved = true;
					this.close();
					this.onConfirm(false);
				})
			)
			.addButton((btn) =>
				btn
					.setButtonText(t('yolo.enableButton'))
					// setDestructive() (the recommended replacement) requires Obsidian 1.13.0, above the current minAppVersion 1.11.4; keep setWarning until the floor is raised (#1040).
					// eslint-disable-next-line @typescript-eslint/no-deprecated -- setDestructive() needs Obsidian 1.13.0, above minAppVersion 1.11.4 (#1040)
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
