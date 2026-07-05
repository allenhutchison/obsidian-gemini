import { App, Modal, Setting } from 'obsidian';
import { t } from '../i18n';

/**
 * Modal shown when user disables RAG indexing to ask about data cleanup
 */
export class RagCleanupModal extends Modal {
	private onConfirm: (deleteData: boolean) => void;

	constructor(app: App, onConfirm: (deleteData: boolean) => void) {
		super(app);
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: t('ragCleanup.title') });

		contentEl.createEl('p', {
			text: t('ragCleanup.body'),
		});

		const noteEl = contentEl.createDiv({ cls: 'rag-cleanup-note' });
		noteEl.createEl('p', {
			text: t('ragCleanup.keepNote'),
			cls: 'setting-item-description',
		});

		const warningEl = noteEl.createEl('p', {
			text: t('ragCleanup.deleteWarning'),
			cls: 'setting-item-description',
		});
		warningEl.style.color = 'var(--text-warning)';

		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText(t('ragCleanup.keepButton')).onClick(() => {
					this.close();
					this.onConfirm(false);
				})
			)
			.addButton((btn) =>
				btn
					.setButtonText(t('ragCleanup.deleteButton'))
					// setDestructive() (the recommended replacement) requires Obsidian 1.13.0, above the current minAppVersion 1.11.4; keep setWarning until the floor is raised (#1040).
					// eslint-disable-next-line @typescript-eslint/no-deprecated -- setDestructive() needs Obsidian 1.13.0, above minAppVersion 1.11.4 (#1040)
					.setWarning()
					.onClick(() => {
						this.close();
						this.onConfirm(true);
					})
			);
	}
}
