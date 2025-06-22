import ObsidianGemini from '../../main';
import { Notice, TFile, debounce, normalizePath } from 'obsidian'; // Added normalizePath
import { BasicGeminiConversationEntry, GeminiConversationEntry } from '../types/conversation';
import { MarkdownHistory } from './markdownHistory';

export class GeminiHistory {
	private plugin: ObsidianGemini;
	private markdownHistory: MarkdownHistory;

	constructor(plugin: ObsidianGemini) {
		this.plugin = plugin;
		this.markdownHistory = new MarkdownHistory(plugin);
	}

	async setupHistoryCommands() {
		if (!this.plugin.settings.chatHistory) {
			return;
		}
		try {
			this.plugin.addCommand({
				id: 'gemini-scribe-clear-conversations',
				name: 'Clear All Chat History',
				callback: async () => {
					await this.clearHistory();
				},
			});
		} catch (error) {
			console.error('Failed to add commands', error);
		}
	}

	async onLayoutReady() {
		await this.setupHistory();
		// Run one-time migration for existing users
		await this.markdownHistory.migrateAllLegacyFiles();
	}

	async setupHistory() {
		this.plugin.app.vault.on('rename', this.renameHistoryFile.bind(this));
		// Add listener for file deletion
		this.plugin.app.vault.on('delete', this.handleFileDelete.bind(this));
	}

	async onUnload() {
		this.plugin.app.vault.off('rename', this.renameHistoryFile.bind(this));
		// Remove listener for file deletion
		this.plugin.app.vault.off('delete', this.handleFileDelete.bind(this));
	}

	async renameHistoryFile(file: TFile, oldPath: string) {
		// Ignore rename events where either the source or destination is inside the history folder
		const historyFolder = this.plugin.settings.historyFolder;
		// Normalize paths for reliable comparison
		const normalizedFilePath = normalizePath(file.path);
		const normalizedOldPath = normalizePath(oldPath);
		const normalizedHistoryPrefix = normalizePath(historyFolder + '/'); // Ensure trailing slash for prefix check

		if (
			normalizedFilePath.startsWith(normalizedHistoryPrefix) ||
			normalizedOldPath.startsWith(normalizedHistoryPrefix)
		) {
			// console.debug(`Ignoring rename event involving history folder: ${oldPath} -> ${file.path}`);
			return;
		}

		// Ensure it's a file being renamed, not a folder (and not inside history)
		if (file instanceof TFile) {
			await this.markdownHistory.renameHistoryFile(file, oldPath);
		}
	}

	// Handler for file deletion
	async handleFileDelete(file: TFile) {
		// Ensure it's a file being deleted, not a folder
		if (file instanceof TFile) {
			await this.markdownHistory.deleteHistoryFile(file.path);
		}
	}

	async appendHistoryForFile(file: TFile, newEntry: BasicGeminiConversationEntry) {
		await this.markdownHistory.appendHistoryForFile(file, newEntry);
	}

	async getHistoryForFile(file: TFile): Promise<GeminiConversationEntry[]> {
		return await this.markdownHistory.getHistoryForFile(file);
	}

	async clearHistoryForFile(file: TFile): Promise<number | undefined> {
		return await this.markdownHistory.clearHistoryForFile(file);
	}

	async appendHistory(newEntry: BasicGeminiConversationEntry) {
		const activeFile = this.plugin.app.workspace.getActiveFile();
		if (activeFile) {
			await this.appendHistoryForFile(activeFile, newEntry);
		}
	}

	async clearHistory() {
		await this.markdownHistory.clearHistory();
	}
}
