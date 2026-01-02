import { App, Modal, Setting } from 'obsidian';

export interface ResumeInfo {
	filesIndexed: number;
	interruptedAt: number;
	lastFile?: string;
}

/**
 * Modal shown when interrupted indexing is detected, asking user to resume or start fresh
 */
export class RagResumeModal extends Modal {
	private resumeInfo: ResumeInfo;
	private onChoice: (resume: boolean) => void;

	constructor(
		app: App,
		resumeInfo: ResumeInfo,
		onChoice: (resume: boolean) => void
	) {
		super(app);
		this.resumeInfo = resumeInfo;
		this.onChoice = onChoice;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Resume Indexing?' });

		contentEl.createEl('p', {
			text: 'A previous indexing operation was interrupted. Would you like to resume or start fresh?'
		});

		// Stats section
		const statsEl = contentEl.createEl('div', { cls: 'rag-resume-stats' });

		const filesRow = statsEl.createDiv({ cls: 'rag-resume-stat-row' });
		filesRow.createSpan({ cls: 'rag-resume-stat-label', text: 'Files indexed:' });
		filesRow.createSpan({ cls: 'rag-resume-stat-value', text: `${this.resumeInfo.filesIndexed}` });

		const timeRow = statsEl.createDiv({ cls: 'rag-resume-stat-row' });
		timeRow.createSpan({ cls: 'rag-resume-stat-label', text: 'Interrupted:' });
		timeRow.createSpan({ cls: 'rag-resume-stat-value', text: this.formatDate(this.resumeInfo.interruptedAt) });

		if (this.resumeInfo.lastFile) {
			const fileRow = statsEl.createDiv({ cls: 'rag-resume-stat-row' });
			fileRow.createSpan({ cls: 'rag-resume-stat-label', text: 'Last file:' });
			const fileValue = fileRow.createSpan({ cls: 'rag-resume-stat-value rag-resume-file' });
			fileValue.setText(this.resumeInfo.lastFile);
		}

		// Info about resume behavior
		const noteEl = contentEl.createEl('div', { cls: 'rag-resume-note' });
		noteEl.createEl('p', {
			text: 'Resume will continue from where you left off, skipping already-indexed files.',
			cls: 'setting-item-description'
		});

		// Buttons
		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText('Resume')
					.setCta()
					.onClick(() => {
						this.close();
						this.onChoice(true);
					})
			)
			.addButton((btn) =>
				btn
					.setButtonText('Start Fresh')
					.setWarning()
					.onClick(() => {
						this.close();
						this.onChoice(false);
					})
			);
	}

	private formatDate(timestamp: number): string {
		const date = new Date(timestamp);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMs / 3600000);
		const diffDays = Math.floor(diffMs / 86400000);

		if (diffMins < 1) {
			return 'Just now';
		} else if (diffMins < 60) {
			return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
		} else if (diffHours < 24) {
			return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
		} else if (diffDays < 7) {
			return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
		} else {
			return date.toLocaleDateString();
		}
	}
}
