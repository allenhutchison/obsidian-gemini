/**
 * V4 Welcome Modal - Welcomes users to v4.0 and offers to archive old history
 */

import { App, Modal, Notice } from 'obsidian';
import { HistoryArchiver, ArchiveReport } from '../migrations/history-archiver';
import type ObsidianGemini from '../main';

export class V4WelcomeModal extends Modal {
	private plugin: InstanceType<typeof ObsidianGemini>;
	private archiver: HistoryArchiver;
	private isProcessing: boolean = false;

	constructor(app: App, plugin: InstanceType<typeof ObsidianGemini>) {
		super(app);
		this.plugin = plugin;
		this.archiver = new HistoryArchiver(plugin);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		// Add modal styling
		contentEl.addClass('gemini-v4-welcome-modal');

		// Header
		contentEl.createEl('h2', {
			text: '🎉 Welcome to Gemini Scribe 4.0!',
			cls: 'gemini-v4-welcome-header'
		});

		// Main description
		const description = contentEl.createDiv({ cls: 'gemini-v4-welcome-description' });
		description.createEl('p', {
			text: 'This is a major update focused entirely on the powerful Agent Mode.'
		});

		// What's new section
		const whatsNew = contentEl.createDiv({ cls: 'gemini-v4-whats-new' });
		whatsNew.createEl('h3', { text: "What's New in 4.0:" });
		const list = whatsNew.createEl('ul');
		list.createEl('li', {
			text: '🤖 Unified agent-first interface - one powerful chat mode'
		});
		list.createEl('li', {
			text: '🔧 Tool calling built-in to every conversation'
		});
		list.createEl('li', {
			text: '💾 Persistent agent sessions with full history'
		});
		list.createEl('li', {
			text: '⚡ Smarter, more capable AI assistance'
		});

		// Old history section
		const historyInfo = contentEl.createDiv({ cls: 'gemini-v4-history-info' });
		historyInfo.createEl('h3', { text: 'Your Old Chat History' });
		historyInfo.createEl('p', {
			text: 'The old note-based chat mode has been removed in v4.0. Your existing chat history can be archived for safekeeping.'
		});

		const archiveBox = historyInfo.createDiv({ cls: 'gemini-v4-archive-box' });
		archiveBox.createEl('p', {
			text: '📦 Archiving will:'
		});
		const archiveList = archiveBox.createEl('ul');
		archiveList.createEl('li', {
			text: 'Move your History/ folder to History-Archive/'
		});
		archiveList.createEl('li', {
			text: 'Keep all your old conversations as readable markdown files'
		});
		archiveList.createEl('li', {
			text: 'Let you start fresh with the new agent sessions'
		});

		// Button container
		const buttonContainer = contentEl.createDiv({ cls: 'gemini-v4-welcome-buttons' });

		// Skip button (if no history to archive)
		const skipButton = buttonContainer.createEl('button', {
			text: 'Start Using Agent Mode',
			cls: 'mod-cta'
		});
		skipButton.addEventListener('click', () => {
			this.close();
		});

		// Archive button (only show if there's history)
		this.checkHistoryAndShowArchiveButton(buttonContainer, skipButton);

		// Learn more link
		const learnMore = contentEl.createDiv({ cls: 'gemini-v4-learn-more' });
		const link = learnMore.createEl('a', {
			text: '📖 Learn more about Agent Mode',
			href: 'https://github.com/allenhutchison/obsidian-gemini/blob/master/docs/agent-mode-guide.md'
		});
		link.addEventListener('click', (e) => {
			e.preventDefault();
			window.open(link.href, '_blank');
		});
	}

	private async checkHistoryAndShowArchiveButton(container: HTMLElement, skipButton: HTMLButtonElement) {
		const needsArchiving = await this.archiver.needsArchiving();

		if (needsArchiving) {
			// Change skip button text
			skipButton.textContent = 'Skip Archiving';
			skipButton.removeClass('mod-cta');
			skipButton.addClass('mod-warning');

			// Add archive button
			const archiveButton = container.createEl('button', {
				text: 'Archive Old History',
				cls: 'mod-cta'
			});
			archiveButton.addEventListener('click', () => {
				this.performArchiving();
			});

			// Move skip button after archive button
			container.removeChild(skipButton);
			container.appendChild(skipButton);
		}
	}

	private async performArchiving() {
		if (this.isProcessing) return;

		this.isProcessing = true;
		const { contentEl } = this;

		// Clear content and show progress
		contentEl.empty();
		contentEl.createEl('h2', { text: '📦 Archiving History...' });

		const progressDiv = contentEl.createDiv({ cls: 'gemini-v4-archive-progress' });
		progressDiv.createEl('p', { text: 'Please wait while your old history is being archived...' });

		const notice = new Notice('Archiving history...', 0);

		try {
			const report: ArchiveReport = await this.archiver.archiveHistory();

			notice.hide();

			// Show results
			this.showArchiveResults(report);
		} catch (error) {
			notice.hide();
			this.plugin.logger.error('Archive failed:', error);

			contentEl.empty();
			contentEl.createEl('h2', { text: '❌ Archive Failed' });

			const errorDiv = contentEl.createDiv({ cls: 'gemini-v4-archive-error' });
			errorDiv.createEl('p', {
				text: 'An error occurred while archiving:'
			});
			errorDiv.createEl('code', {
				text: error.message
			});

			errorDiv.createEl('p', {
				text: 'Your old history is still in the History/ folder and has not been modified.'
			});

			const closeButton = contentEl.createEl('button', {
				text: 'Close',
				cls: 'mod-cta'
			});
			closeButton.addEventListener('click', () => this.close());

			new Notice('Archive failed. Your history is safe and unchanged.', 5000);
		} finally {
			this.isProcessing = false;
		}
	}

	private showArchiveResults(report: ArchiveReport) {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: '✅ Archive Complete!' });

		// Results summary
		const resultsDiv = contentEl.createDiv({ cls: 'gemini-v4-archive-results' });

		if (report.alreadyArchived) {
			resultsDiv.createEl('p', {
				text: 'Your history was already archived.'
			});
		} else if (!report.historyFolderFound) {
			resultsDiv.createEl('p', {
				text: 'No old history found - you\'re ready to start fresh!'
			});
		} else {
			const stats = resultsDiv.createDiv({ cls: 'gemini-v4-archive-stats' });
			stats.createEl('p', {
				text: `📦 Archived ${report.filesArchived} conversation${report.filesArchived === 1 ? '' : 's'}`
			});
			stats.createEl('p', {
				text: `📁 Location: ${report.archivePath}`
			});
		}

		// Next steps
		const nextStepsDiv = contentEl.createDiv({ cls: 'gemini-v4-next-steps' });
		nextStepsDiv.createEl('h3', { text: 'Next Steps:' });
		const nextStepsList = nextStepsDiv.createEl('ul');
		nextStepsList.createEl('li', {
			text: 'Your archived conversations are still readable markdown files'
		});
		nextStepsList.createEl('li', {
			text: 'Open the Agent Mode panel to start using v4.0'
		});
		nextStepsList.createEl('li', {
			text: 'Try asking the agent to search your vault or create notes'
		});

		// Close button
		const closeButton = contentEl.createEl('button', {
			text: 'Start Using Agent Mode',
			cls: 'mod-cta'
		});
		closeButton.addEventListener('click', () => this.close());

		// Show success notice
		if (report.filesArchived > 0) {
			new Notice(
				`Archived ${report.filesArchived} conversations. Welcome to v4.0!`,
				5000
			);
		} else {
			new Notice('Welcome to Gemini Scribe v4.0!', 3000);
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
