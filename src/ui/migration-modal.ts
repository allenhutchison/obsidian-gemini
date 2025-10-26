/**
 * Migration Modal - Guides users through history migration
 */

import { App, Modal, Notice } from 'obsidian';
import { HistoryMigrator, MigrationReport } from '../migrations/history-migrator';
import type ObsidianGemini from '../main';

export class MigrationModal extends Modal {
	private plugin: InstanceType<typeof ObsidianGemini>;
	private migrator: HistoryMigrator;
	private isProcessing: boolean = false;

	constructor(app: App, plugin: InstanceType<typeof ObsidianGemini>) {
		super(app);
		this.plugin = plugin;
		this.migrator = new HistoryMigrator(plugin);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		// Add modal styling
		contentEl.addClass('gemini-migration-modal');

		// Header
		contentEl.createEl('h2', {
			text: '🔄 Gemini Scribe Update',
			cls: 'gemini-migration-header'
		});

		// Description
		const description = contentEl.createDiv({ cls: 'gemini-migration-description' });
		description.createEl('p', {
			text: 'A new version of Gemini Scribe has been installed with improved session management.'
		});
		description.createEl('p', {
			text: 'Your existing chat history can be migrated to the new Agent Sessions format.'
		});

		// Info box
		const infoBox = contentEl.createDiv({ cls: 'gemini-migration-info' });
		infoBox.createEl('h3', { text: 'What will happen:' });
		const list = infoBox.createEl('ul');
		list.createEl('li', {
			text: '✓ Your existing History files will be backed up to History-Archive/'
		});
		list.createEl('li', {
			text: '✓ New session files will be created in Agent-Sessions/'
		});
		list.createEl('li', {
			text: '✓ All conversation content will be preserved'
		});
		list.createEl('li', {
			text: '✓ Session titles will be generated from your file names'
		});

		// Warning box
		const warningBox = contentEl.createDiv({ cls: 'gemini-migration-warning' });
		warningBox.createEl('p', {
			text: '⚠️ This process cannot be undone automatically. A backup will be created for safety.'
		});

		// Button container
		const buttonContainer = contentEl.createDiv({ cls: 'gemini-migration-buttons' });

		// Skip button
		const skipButton = buttonContainer.createEl('button', {
			text: 'Skip Migration',
			cls: 'mod-warning'
		});
		skipButton.addEventListener('click', () => {
			this.close();
		});

		// Migrate button
		const migrateButton = buttonContainer.createEl('button', {
			text: 'Migrate History',
			cls: 'mod-cta'
		});
		migrateButton.addEventListener('click', () => {
			this.performMigration();
		});
	}

	private async performMigration() {
		if (this.isProcessing) return;

		this.isProcessing = true;
		const { contentEl } = this;

		// Clear content and show progress
		contentEl.empty();
		contentEl.createEl('h2', { text: '🔄 Migrating History...' });

		const progressDiv = contentEl.createDiv({ cls: 'gemini-migration-progress' });
		progressDiv.createEl('p', { text: 'Please wait while your history is being migrated...' });

		const notice = new Notice('Starting migration...', 0);

		try {
			const report: MigrationReport = await this.migrator.migrateAllHistory();

			notice.hide();

			// Show results
			this.showMigrationResults(report);
		} catch (error) {
			notice.hide();
			console.error('Migration failed:', error);

			contentEl.empty();
			contentEl.createEl('h2', { text: '❌ Migration Failed' });

			const errorDiv = contentEl.createDiv({ cls: 'gemini-migration-error' });
			errorDiv.createEl('p', {
				text: 'An error occurred during migration:'
			});
			errorDiv.createEl('code', {
				text: error.message
			});

			const closeButton = contentEl.createEl('button', {
				text: 'Close',
				cls: 'mod-cta'
			});
			closeButton.addEventListener('click', () => this.close());

			new Notice('Migration failed. Check console for details.', 5000);
		} finally {
			this.isProcessing = false;
		}
	}

	private showMigrationResults(report: MigrationReport) {
		const { contentEl } = this;
		contentEl.empty();

		if (report.filesFailed > 0) {
			contentEl.createEl('h2', { text: '⚠️ Migration Completed with Warnings' });
		} else {
			contentEl.createEl('h2', { text: '✅ Migration Successful!' });
		}

		// Results summary
		const resultsDiv = contentEl.createDiv({ cls: 'gemini-migration-results' });

		const stats = resultsDiv.createDiv({ cls: 'gemini-migration-stats' });
		stats.createEl('p', {
			text: `Files found: ${report.totalFilesFound}`
		});
		stats.createEl('p', {
			text: `Sessions created: ${report.sessionsCreated}`
		});
		stats.createEl('p', {
			text: `Files processed: ${report.filesProcessed}`
		});

		if (report.filesFailed > 0) {
			stats.createEl('p', {
				text: `Files failed: ${report.filesFailed}`,
				cls: 'gemini-migration-failed'
			});
		}

		if (report.backupCreated) {
			stats.createEl('p', {
				text: '✓ Backup created in History-Archive/',
				cls: 'gemini-migration-backup'
			});
		}

		// Show errors if any
		if (report.errors.length > 0) {
			const errorsDiv = resultsDiv.createDiv({ cls: 'gemini-migration-errors' });
			errorsDiv.createEl('h3', { text: 'Errors:' });
			const errorList = errorsDiv.createEl('ul');
			report.errors.forEach(error => {
				errorList.createEl('li', { text: error });
			});
		}

		// Next steps
		const nextStepsDiv = contentEl.createDiv({ cls: 'gemini-migration-next-steps' });
		nextStepsDiv.createEl('h3', { text: 'Next Steps:' });
		const nextStepsList = nextStepsDiv.createEl('ul');
		nextStepsList.createEl('li', {
			text: 'Check your Agent-Sessions/ folder to see the migrated sessions'
		});
		nextStepsList.createEl('li', {
			text: 'Your original files are backed up in History-Archive/'
		});
		nextStepsList.createEl('li', {
			text: 'Open Agent Mode to start using the new session system'
		});

		// Close button
		const closeButton = contentEl.createEl('button', {
			text: 'Done',
			cls: 'mod-cta'
		});
		closeButton.addEventListener('click', () => this.close());

		// Show success notice
		if (report.filesFailed === 0) {
			new Notice(
				`Successfully migrated ${report.sessionsCreated} sessions!`,
				5000
			);
		} else {
			new Notice(
				`Migration completed with ${report.filesFailed} errors. Check the modal for details.`,
				7000
			);
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
