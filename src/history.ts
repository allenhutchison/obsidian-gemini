import ObsidianGemini from "main";
import { TFile } from "obsidian";

export class GeminiHistory {
    private plugin: ObsidianGemini;
    private history: { [filePath: string]: { role: "user" | "model", content: string }[] } = {};

    constructor(plugin: ObsidianGemini) {
        this.plugin = plugin;
    }
    
    async appendHistoryForFile(file: TFile, newEntry: { role: "user" | "model", content: string }) {
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
}