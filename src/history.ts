import ObsidianGemini from "main";
import { TFile } from "obsidian";

export class GeminiHistory {
    private plugin: ObsidianGemini;
    private history: { [filePath: string]: { role: "user" | "model", content: string }[] } = {};

    constructor(plugin: ObsidianGemini) {
        this.plugin = plugin;
    }
    
    async appendHistoryForFile(file: TFile, newEntry: { role: "user" | "model", content: string }) {
        if (file) {
            if (!this.history[file.path]) {
                this.getHistoryForFile(file);
            }
            this.history[file.path].push(newEntry);
        }
    }

    async getHistoryForFile(file: TFile) {
        if (file) {
            if (!this.history[file.path]) {
                this.history[file.path] = [];
            }
            const fileContent = await this.plugin.gfile.getCurrentFileContent(true);
            if (fileContent != null && !this.history[file.path].length) {
                this.appendHistoryForFile(file, { role: "user", content: fileContent });
                this.appendHistoryForFile(file, { role: "user", content: "This is the content of the current file:" });
            } 
        }
        return this.history[file.path];
    }

    async clearHistoryForFile(file: TFile | null) {
        if (file) {
            delete this.history[file.path];
        }
    }

    async clearAllHistory() {
        this.history = {};
    }
}