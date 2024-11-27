import ObsidianGemini from '../main';
import { TFile } from 'obsidian';
import { BasicGeminiConversationEntry, GeminiConversationEntry } from './database';

export class GeminiHistory {
	private plugin: ObsidianGemini;

	constructor(plugin: ObsidianGemini) {
		this.plugin = plugin;
	}

	async appendHistoryForFile(file: TFile, newEntry: BasicGeminiConversationEntry) {
		console.debug('Appending history for file:', file.path);
		if (this.plugin.gfile.isFile(file)) {
			const extendedEntry: GeminiConversationEntry = {
				...newEntry,
				notePath: file.path,
				created_at: new Date(),
			}
			const foo = await this.plugin.database.conversations.add(extendedEntry);
			console.debug('New history entry:', foo);
			return foo;
		}
	}

	async getHistoryForFile(file: TFile) : Promise<GeminiConversationEntry[]> {
		if (this.plugin.gfile.isFile(file)) {
			const notePath = file.path;
			const history = await this.plugin.database.conversations.where('notePath').equals(notePath).toArray();
			return history;
		} else {
			return [];
		}
	}

	async clearHistoryForFile(file: TFile) : Promise<number | undefined> {
		if (this.plugin.gfile.isFile(file)) {
			const notePath = file.path;
			return await this.plugin.database.conversations.where('notePath').equals(notePath).delete();
		}
		return undefined;
	}

	async clearAllHistory() {
		console.log('Clearing all conversation history.');
		await this.plugin.database.conversations.clear();
		await this.plugin.database.fileMapping.clear();
	}

	async appendHistory(newEntry: BasicGeminiConversationEntry) {
		const activeFile = this.plugin.app.workspace.getActiveFile();
		if (activeFile) {
			await this.appendHistoryForFile(activeFile, newEntry);
		}
	}
}
