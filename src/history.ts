import ObsidianGemini from '../main';
import { TFile } from 'obsidian';

interface HistoryEntry {
	role: 'user' | 'model';
	content: string;
}

export class GeminiHistory {
	private plugin: ObsidianGemini;
	private history: { [filePath: string]: HistoryEntry[] } = {};

	constructor(plugin: ObsidianGemini) {
		this.plugin = plugin;
	}

	async appendHistoryForFile(file: TFile, newEntry: HistoryEntry) {
		if (this.plugin.gfile.isFile(file)) {
			if (!this.history[file.path]) {
				this.getHistoryForFile(file);
			}
			this.history[file.path].push(newEntry);
		}
	}

	async getHistoryForFile(file: TFile) {
		if (this.plugin.gfile.isFile(file)) {
			if (!this.history[file.path]) {
				this.history[file.path] = [];
			}
			return this.history[file.path];
		} else {
			return null;
		}
	}

	async clearHistoryForFile(file: TFile) {
		if (this.plugin.gfile.isFile(file)) {
			delete this.history[file.path];
		}
	}

	async clearAllHistory() {
		this.history = {};
	}

	async appendHistory(newEntry: HistoryEntry) {
		const activeFile = this.plugin.app.workspace.getActiveFile();
		if (activeFile) {
			await this.appendHistoryForFile(activeFile, newEntry);
		}
	}
}
