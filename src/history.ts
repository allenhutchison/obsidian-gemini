import ObsidianGemini from '../main';
import { Notice, TFile } from 'obsidian';
import { BasicGeminiConversationEntry, GeminiConversationEntry, GeminiDatabase } from './database';

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
		this.setupHistory();
	}

	async setupHistory() {
		this.plugin.app.vault.on('rename', this.renameHistoryFile.bind(this));
		this.plugin.app.vault.on('modify', this.modifyHistoryFile.bind(this));
		await this.database.setupDatabase();
	}

	onUnload() {
		console.debug('Unloading history module...');
		this.plugin.app.vault.off('rename', this.renameHistoryFile.bind(this));
		this.plugin.app.vault.off('modify', this.modifyHistoryFile.bind(this));
		
		// Fire and forget export
		this.exportHistory()
			.then(() => console.debug('History export complete'))
			.catch(error => console.error('Error during history export:', error));
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
			const extendedEntry: GeminiConversationEntry = {
				...newEntry,
				notePath: file.path,
				created_at: new Date(),
			}
			await this.database.conversations.add(extendedEntry);
			this.exportHistory();
		}
	}

	async getHistoryForFile(file: TFile) : Promise<GeminiConversationEntry[]> {
		if (this.plugin.gfile.isFile(file)) {
			const notePath = file.path;
			const history = await this.database.conversations.where('notePath').equals(notePath).toArray();
			return history;
		} else {
			return [];
		}
	}

	async clearHistoryForFile(file: TFile) : Promise<number | undefined> {
		if (this.plugin.gfile.isFile(file)) {
			const notePath = file.path;
			return await this.database.conversations.where('notePath').equals(notePath).delete();
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
		if (this.plugin.settings.chatHistory) {
			return await this.database.exportDatabaseToVault();
		}
	}

	async importHistory() {
		if (this.plugin.settings.chatHistory) {
			await this.database.importDatabaseFromVault();
			await this.plugin.geminiView.reloadChatFromHistory();
		}
	}

	async modifyHistoryFile(file: TFile) {
		const historyFolder = this.plugin.settings.historyFolder;
		const filePath = `${historyFolder}/gemini-scribe-history.json`;
		if (file.path === filePath) {
			await this.importHistory();
		}
    }
}
