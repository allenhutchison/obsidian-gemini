import ObsidianGemini from "main";
import { TFile } from "obsidian";

export class GeminiHistory {
    private plugin: ObsidianGemini;
    private history: { [filePath: string]: { role: "user" | "model", content: string }[] } = {};

    constructor(plugin: ObsidianGemini) {
        this.plugin = plugin;
    }
    
    getHistoryForFile(file: TFile | null): { role: "user" | "model", content: string }[] {
        if (file) {
            return this.history[file.path] || []; // Return empty array if no history
        }
        return []; // Return empty array if no file
    }

    addHistoryForFile(file: TFile, newEntry: { role: "user" | "model", content: string }) {
        if (file) {
            if (!this.history[file.path]) {
                this.history[file.path] = [];
            }
            this.history[file.path].push(newEntry);
        }
    }

    clearHistoryForFile(file: TFile | null) {
        if (file) {
            delete this.history[file.path];
        }
    }

    clearAllHistory() {
        this.history = {};
    }

    private buildContents(userMessage: string, conversationHistory: any[]): any[] {
        const contents = [];

        for (const turn of conversationHistory) {
            contents.push({
                role: turn.role,
                parts: [{ text: turn.content }]
            });
        }

        contents.push({
            role: "user",
            parts: [{ text: userMessage }]
        });

        return contents;
    }
}