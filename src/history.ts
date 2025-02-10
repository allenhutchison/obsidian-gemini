import ObsidianGemini from '../main';
import { Notice, TFile, debounce } from 'obsidian';
import { GeminiDatabase } from './database';
import { BasicGeminiConversationEntry, GeminiConversationEntry } from './database/types';

export class GeminiHistory {
	private plugin: ObsidianGemini;
	private database: GeminiDatabase;

	constructor(plugin: ObsidianGemini) {
		this.plugin = plugin;
		this.database = new GeminiDatabase(plugin);
	}

	async setupHistoryCommands() {
		if (!this.plugin.settings.chatHistory) {
			return;
		}
		try {
			this.plugin.addCommand({
				id: 'gemini-scribe-export-conversations',
				name: 'Export Chat History to Vault',
				callback: async () => {
					await this.exportHistory();
				},
			});

			this.plugin.addCommand({
				id: 'gemini-scribe-import-conversations',
				name: 'Import Chat History from Vault',
				callback: async () => {
					await this.importHistory();
				},
			});

			this.plugin.addCommand({
				id: 'gemini-scribe-clear-conversations',
				name: 'Clear All Chat History',
				callback: async () => {
					await this.clearHistory();
				},
			});
		} catch (error) {
			console.error('Failed to add export command', error);
		}
	}

	async onLayoutReady() {
		await this.setupHistory();
	}

	async setupHistory() {
		this.plugin.app.vault.on('rename', this.renameHistoryFile.bind(this));
		this.plugin.app.vault.on('modify', this.modifyHistoryFile.bind(this));
		await this.database.setupDatabase();
	}

	async onUnload() {
		console.debug('Unloading history module...');
		this.plugin.app.vault.off('rename', this.renameHistoryFile.bind(this));
		this.plugin.app.vault.off('modify', this.modifyHistoryFile.bind(this));
		await this.database.close();
	}

	async renameHistoryFile(file: TFile, oldPath: string) {
		const newPath = file.path;
		const conversationUpdate = await this.database.conversations
			.where('notePath')
			.equals(oldPath)
			.modify({ notePath: newPath });
		await Promise.all([conversationUpdate]);
		await this.exportHistory();
	}

	async appendHistoryForFile(file: TFile, newEntry: BasicGeminiConversationEntry) {
		if (this.plugin.gfile.isFile(file)) {
			const notePath = file.path;

			// Prepare the conversation entry
			const conversation: GeminiConversationEntry = {
				notePath,
				created_at: new Date(),
				role: newEntry.role,
				message: newEntry.message,
			};

			// Use the database method with queuing
			await this.database.addConversation(conversation);
			// Debounce export to prevent rapid successive exports
			await this.debouncedExport();
		}
	}

	async getHistoryForFile(file: TFile): Promise<GeminiConversationEntry[]> {
		if (this.plugin.gfile.isFile(file)) {
			const notePath = file.path;
			const history = await this.database.getConversations(notePath);
			return history;
		}
		return [];
	}

	async clearHistoryForFile(file: TFile): Promise<number | undefined> {
		if (this.plugin.gfile.isFile(file)) {
			const notePath = file.path;
			return await this.database.clearConversations(notePath);
		}
		return undefined;
	}

	async appendHistory(newEntry: BasicGeminiConversationEntry) {
		const activeFile = this.plugin.app.workspace.getActiveFile();
		if (activeFile) {
			await this.appendHistoryForFile(activeFile, newEntry);
		}
	}

	async clearHistory() {
		await this.database.clearHistory();
	}

	async exportHistory() {
		if (!this.plugin.settings.chatHistory) return;
		try {
			if (!this.database.isOpen()) {
				console.debug("Database is closed, skipping history export");
				return;
			}
			await this.database.exportDatabaseToVault();
		} catch (error: any) {
			if (error?.name === 'DatabaseClosedError') {
				console.debug("DatabaseClosedError caught; export skipped.");
				return;
			} else {
				throw error;
			}
		}
	}

	async importHistory() {
		if (this.plugin.settings.chatHistory) {
			const changed = await this.database.importDatabaseFromVault();
			if (changed) {
				new Notice('Chat history updated from vault.');
				await this.plugin.geminiView.reloadChatFromHistory();
			}
		}
	}

	async modifyHistoryFile(file: TFile) {
		const historyFolder = this.plugin.settings.historyFolder;
		const filePath = `${historyFolder}/gemini-scribe-history.json`;
		if (file.path === filePath) {
			await this.debouncedImport();
		}
	}

	// Add debounced export
	private debouncedExport = debounce(
		async () => {
			await this.exportHistory();
		},
		1000, // 1 second delay
		true // leading edge
	);

	private debouncedImport = debounce(
		async () => {
			await this.importHistory();
		},
		1000, // 1 second delay
		false // trailing edge - wait for pause in calls
	);

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
