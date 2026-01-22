import { App, Modal, Setting } from 'obsidian';

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

		contentEl.createEl('h2', { text: 'Delete Vault Index?' });

		contentEl.createEl('p', {
			text: 'Your vault index is stored in Google Cloud. Do you want to delete it?',
		});

		const noteEl = contentEl.createEl('div', { cls: 'rag-cleanup-note' });
		noteEl.createEl('p', {
			text: 'If you keep the data, re-enabling will be faster.',
			cls: 'setting-item-description',
		});

		const warningEl = noteEl.createEl('p', {
			text: "⚠️ If you delete, this action is permanent and cannot be undone. All indexed data will be permanently removed from Google Cloud, and you'll need to reindex all files.",
			cls: 'setting-item-description',
		});
		warningEl.style.color = 'var(--text-warning)';

		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText('Keep Data').onClick(() => {
					this.close();
					this.onConfirm(false);
				})
			)
			.addButton((btn) =>
				btn
					.setButtonText('Delete Permanently')
					.setWarning()
					.onClick(() => {
						this.close();
						this.onConfirm(true);
					})
			);
	}
}
