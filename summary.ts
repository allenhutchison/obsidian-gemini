import { App, TFile, Notice } from "obsidian";
import { GeminiApi } from "./api";

export class GeminiSummary {
    private app: App;
    private geminiApi: GeminiApi;

    constructor(app: App, geminiApi: GeminiApi) {
        this.app = app;
        this.geminiApi = geminiApi;
    }

    async summarizeActiveFile() {
        const activeFile = this.app.workspace.getActiveFile();

        if (!activeFile) {
            console.warn('No active file found.');
            return;
        }

        const fileContent = await this.app.vault.read(activeFile);
        if (!fileContent) {
            console.warn('Unable to read the active file.');
            return;
        }

        // Generate summary (use a summarization model or some external API)
        const summary = await this.geminiApi.generateOneSentenceSummary(fileContent);
        console.log('Generated summary:', summary);

        // Use processFrontMatter to add or update the summary in the frontmatter
        this.app.fileManager.processFrontMatter(activeFile, (frontmatter) => {
            frontmatter['summary'] = summary;
        });
    }
}   

