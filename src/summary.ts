import ObsidianGemini from "main";

export class GeminiSummary {
    private plugin: ObsidianGemini;


    constructor(plugin: ObsidianGemini) {
        this.plugin = plugin;
    }

    async summarizeActiveFile() {
        const fileContent = await this.plugin.gfile.getCurrentFileContent();

        // Generate summary (use a summarization model or some external API)
        if (fileContent) {
            const summary = await this.plugin.geminiApi.generateOneSentenceSummary(fileContent);
            this.plugin.gfile.addToFrontMatter("summary", summary);
        } else {
            console.error("Failed to get file content for summary.");
        }
    }
}   

