import ObsidianGemini from '../main';
import { TFile } from 'obsidian';
import { GeminiConversationEntry } from './database';

export class GeminiHistory {
	private plugin: ObsidianGemini;

	constructor(plugin: ObsidianGemini) {
		this.plugin = plugin;
	}

	async appendHistoryForFile(file: TFile, newEntry: GeminiConversationEntry) {
		if (this.plugin.gfile.isFile(file)) {
			if (!newEntry.created_at) {
				newEntry.created_at = new Date();
			}
			if (!newEntry.notePath) {
				newEntry.notePath = file.path;
			}
			return await this.plugin.database.conversations.add(newEntry);
		}
	}

	async getHistoryForFile(file: TFile) {
		if (this.plugin.gfile.isFile(file)) {
			const notePath = file.path;
			return await this.plugin.database.conversations.where('notePath').equals(notePath).toArray();
		}
	}

	async clearHistoryForFile(file: TFile) {
		if (this.plugin.gfile.isFile(file)) {
			const notePath = file.path;
			return await this.plugin.database.conversations.where('notePath').equals(notePath).delete();
		}
	}

	async clearAllHistory() {
		return await this.plugin.database.conversations.clear();
	}

	async appendHistory(newEntry: GeminiConversationEntry) {
		const activeFile = this.plugin.app.workspace.getActiveFile();
		if (activeFile) {
			await this.appendHistoryForFile(activeFile, newEntry);
		}
	}
}
