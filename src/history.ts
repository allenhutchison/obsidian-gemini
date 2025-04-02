import ObsidianGemini from '../main';
import { Notice, TFile, debounce } from 'obsidian';
import { BasicGeminiConversationEntry, GeminiConversationEntry } from './types/conversation';
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
	}

	async setupHistory() {
		this.plugin.app.vault.on('rename', this.renameHistoryFile.bind(this));
	}

	async onUnload() {
		console.debug('Unloading history module...');
		this.plugin.app.vault.off('rename', this.renameHistoryFile.bind(this));
	}

	async renameHistoryFile(file: TFile, oldPath: string) {
		await this.markdownHistory.renameHistoryFile(file, oldPath);
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

	private async getTotalConversationCount(): Promise<number> {
		const files = this.plugin.app.vault.getMarkdownFiles();
		let total = 0;
		for (const file of files) {
			const conversations = await this.getHistoryForFile(file);
			total += conversations.length;
		}
		return total;
	}
}
