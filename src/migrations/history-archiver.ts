/**
 * HistoryArchiver - Archives old note-based chat history for v4.0
 *
 * In v4.0, Gemini Scribe is agent-only. This archiver moves the old
 * note-based chat history (History/ folder) to History-Archive/ so
 * users can still access their old conversations while starting fresh
 * with agent sessions.
 */

import { TFile, TFolder, normalizePath, Notice } from 'obsidian';
import type ObsidianGemini from '../main';

export interface ArchiveReport {
	historyFolderFound: boolean;
	filesArchived: number;
	archivePath: string;
	alreadyArchived: boolean;
	errors: string[];
}

/**
 * Handles archival of note-based history for v4.0 upgrade
 */
export class HistoryArchiver {
	private plugin: InstanceType<typeof ObsidianGemini>;
	private historyFolder: string;
	private archiveFolder: string;

	constructor(plugin: InstanceType<typeof ObsidianGemini>) {
		this.plugin = plugin;
		this.historyFolder = normalizePath(plugin.settings.historyFolder + '/History');
		this.archiveFolder = normalizePath(plugin.settings.historyFolder + '/History-Archive');
	}

	/**
	 * Check if archiving is needed
	 */
	async needsArchiving(): Promise<boolean> {
		// Check if History folder exists
		const historyFolderObj = this.plugin.app.vault.getAbstractFileByPath(this.historyFolder);
		if (!historyFolderObj || historyFolderObj instanceof TFile) {
			return false; // No History folder to archive
		}

		// Check if already archived
		const archiveFolderObj = this.plugin.app.vault.getAbstractFileByPath(this.archiveFolder);
		if (archiveFolderObj) {
			return false; // Already archived
		}

		// Check for markdown files in History folder
		const files = this.plugin.app.vault.getMarkdownFiles();
		const historyFiles = files.filter(file =>
			normalizePath(file.path).startsWith(this.historyFolder + '/')
		);

		return historyFiles.length > 0;
	}

	/**
	 * Archive the old History folder
	 */
	async archiveHistory(): Promise<ArchiveReport> {
		const report: ArchiveReport = {
			historyFolderFound: false,
			filesArchived: 0,
			archivePath: this.archiveFolder,
			alreadyArchived: false,
			errors: []
		};

		try {
			// Check if History folder exists
			const historyFolderObj = this.plugin.app.vault.getAbstractFileByPath(this.historyFolder);
			if (!historyFolderObj || historyFolderObj instanceof TFile) {
				report.errors.push('History folder not found - nothing to archive');
				return report;
			}

			report.historyFolderFound = true;

			// Check if already archived
			const archiveFolderObj = this.plugin.app.vault.getAbstractFileByPath(this.archiveFolder);
			if (archiveFolderObj) {
				report.alreadyArchived = true;
				report.errors.push('History has already been archived');
				return report;
			}

			// Count files before archiving
			const files = this.plugin.app.vault.getMarkdownFiles();
			const historyFiles = files.filter(file =>
				normalizePath(file.path).startsWith(this.historyFolder + '/')
			);
			report.filesArchived = historyFiles.length;

			if (historyFiles.length === 0) {
				// Empty folder, just create archive marker
				await this.createArchiveMarker(0);
				return report;
			}

			// Rename History folder to History-Archive
			await this.plugin.app.fileManager.renameFile(
				historyFolderObj as TFolder,
				this.archiveFolder
			);

			// Create a README in the archive explaining what happened
			await this.createArchiveReadme(historyFiles.length);

			return report;
		} catch (error) {
			report.errors.push(`Archive failed: ${error.message}`);
			this.plugin.logger.error('History archive error:', error);
			throw error;
		}
	}

	/**
	 * Create a README file in the archive explaining the upgrade
	 */
	private async createArchiveReadme(fileCount: number): Promise<void> {
		const readmePath = normalizePath(this.archiveFolder + '/README.md');

		const content = `# Archived Chat History

This folder contains your note-based chat history from Gemini Scribe v3.x.

## What Happened?

Gemini Scribe v4.0 is now **agent-only**, providing a more powerful and unified experience. The old note-based chat mode has been removed.

## Your Old Conversations

This archive contains **${fileCount} conversation${fileCount === 1 ? '' : 's'}** from the previous version. These are regular markdown files that you can:

- Open and read anytime in Obsidian
- Search through normally
- Move to other folders if desired
- Delete if you no longer need them

## New Agent Sessions

All new conversations in v4.0 use the agent mode with:
- Tool calling capabilities
- Persistent sessions
- Better context management
- More powerful interactions

Your new agent session files are stored in: \`${this.plugin.settings.historyFolder}/Agent-Sessions/\`

## Questions?

Visit the [Gemini Scribe documentation](https://github.com/allenhutchison/obsidian-gemini) for more information about v4.0.

---
*Archived on ${new Date().toLocaleDateString()} during upgrade to v4.0*
`;

		try {
			await this.plugin.app.vault.create(readmePath, content);
		} catch (error) {
			this.plugin.logger.warn('Failed to create archive README:', error);
			// Non-fatal error, continue
		}
	}

	/**
	 * Create a marker file when archive folder is empty
	 */
	private async createArchiveMarker(fileCount: number): Promise<void> {
		await this.plugin.app.vault.createFolder(this.archiveFolder);

		const markerPath = normalizePath(this.archiveFolder + '/.archived');
		const content = `Archived on ${new Date().toISOString()}\nFiles archived: ${fileCount}`;

		try {
			await this.plugin.app.vault.create(markerPath, content);
		} catch (error) {
			this.plugin.logger.warn('Failed to create archive marker:', error);
		}
	}
}
