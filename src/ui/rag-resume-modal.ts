import { App, Modal, Setting } from 'obsidian';
import { t } from '../i18n';

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

	constructor(app: App, resumeInfo: ResumeInfo, onChoice: (resume: boolean) => void) {
		super(app);
		this.resumeInfo = resumeInfo;
		this.onChoice = onChoice;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: t('ragResume.title') });

		contentEl.createEl('p', {
			text: t('ragResume.body'),
		});

		// Stats section
		const statsEl = contentEl.createEl('div', { cls: 'rag-resume-stats' });

		const filesRow = statsEl.createDiv({ cls: 'rag-resume-stat-row' });
		filesRow.createSpan({ cls: 'rag-resume-stat-label', text: t('ragResume.filesIndexedLabel') });
		filesRow.createSpan({ cls: 'rag-resume-stat-value', text: `${this.resumeInfo.filesIndexed}` });

		const timeRow = statsEl.createDiv({ cls: 'rag-resume-stat-row' });
		timeRow.createSpan({ cls: 'rag-resume-stat-label', text: t('ragResume.interruptedLabel') });
		timeRow.createSpan({ cls: 'rag-resume-stat-value', text: this.formatDate(this.resumeInfo.interruptedAt) });

		if (this.resumeInfo.lastFile) {
			const fileRow = statsEl.createDiv({ cls: 'rag-resume-stat-row' });
			fileRow.createSpan({ cls: 'rag-resume-stat-label', text: t('ragResume.lastFileLabel') });
			const fileValue = fileRow.createSpan({ cls: 'rag-resume-stat-value rag-resume-file' });
			fileValue.setText(this.resumeInfo.lastFile);
		}

		// Info about resume behavior
		const noteEl = contentEl.createEl('div', { cls: 'rag-resume-note' });
		noteEl.createEl('p', {
			text: t('ragResume.resumeNote'),
			cls: 'setting-item-description',
		});

		// Buttons
		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText(t('ragResume.resumeButton'))
					.setCta()
					.onClick(() => {
						this.close();
						this.onChoice(true);
					})
			)
			.addButton((btn) =>
				btn
					.setButtonText(t('ragResume.startFreshButton'))
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
			return t('ragResume.justNow');
		} else if (diffMins < 60) {
			return diffMins === 1
				? t('ragResume.minuteAgoSingular', { count: diffMins })
				: t('ragResume.minutesAgoPlural', { count: diffMins });
		} else if (diffHours < 24) {
			return diffHours === 1
				? t('ragResume.hourAgoSingular', { count: diffHours })
				: t('ragResume.hoursAgoPlural', { count: diffHours });
		} else if (diffDays < 7) {
			return diffDays === 1
				? t('ragResume.dayAgoSingular', { count: diffDays })
				: t('ragResume.daysAgoPlural', { count: diffDays });
		} else {
			return date.toLocaleDateString();
		}
	}
}
