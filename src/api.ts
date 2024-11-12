import ObsidianGemini from '../main';
import { DynamicRetrievalMode, GoogleGenerativeAI } from '@google/generative-ai';

interface GeminiResponse {
    markdown: string;
    rendered: string;
}

export class GeminiApi {
    private plugin: ObsidianGemini;
    private gemini: GoogleGenerativeAI;
    private model: any;
    private modelNoGrounding: any;

    constructor(plugin: ObsidianGemini) {
        this.plugin = plugin;
        const systemInstruction = this.plugin.settings.systemPrompt + ` My name is ${this.plugin.settings.userName}.`;
        this.gemini = new GoogleGenerativeAI(this.plugin.settings.apiKey);
        let tools: any[] = [];
        if (this.plugin.settings.searchGrounding) {
            tools = [
                {googleSearchRetrieval: {
                    dynamicRetrievalConfig: {
                    mode: DynamicRetrievalMode.MODE_DYNAMIC,
                    dynamicThreshold: this.plugin.settings.searchGroundingThreshold,
                }}}];
        }
        this.model = this.gemini.getGenerativeModel({ 
            model: this.plugin.settings.modelName,
            systemInstruction: systemInstruction,
            tools: tools,
        });
        this.modelNoGrounding = this.gemini.getGenerativeModel({ 
            model: this.plugin.settings.modelName,
            systemInstruction: systemInstruction,
        });
        console.debug("Gemini API initialized. Model:", this.plugin.settings.modelName);
    }

    async getBotResponse(userMessage: string, conversationHistory: any[]): Promise<GeminiResponse> {
        let response: GeminiResponse = { markdown: "", rendered: "" };
        try {
            const contents = await this.buildContents(userMessage, conversationHistory);
            const result = await this.model.generateContent({contents});
            response.markdown = result.response.text();
            if (result.response.candidates[0].groundingMetadata.searchEntryPoint) {
                response.rendered = result.response.candidates[0].groundingMetadata.searchEntryPoint.renderedContent;
            }
            return response;
        } catch (error) {
            console.error("Error calling Gemini:", error);
            throw error; 
        }
    }

    async generateRewriteResponse(userMessage: string, conversationHistory: any[]) {
        try {
            const prompt = this.plugin.settings.rewritePrompt + userMessage;
            const contents = await this.buildContents(prompt, conversationHistory);
            const file = this.plugin.app.workspace.getActiveFile();
            if (file) {
                this.plugin.history.appendHistoryForFile(file, { role: "user", content: userMessage })
            }
            const result = await this.modelNoGrounding.generateContent({contents});
            await this.plugin.gfile.replaceTextInActiveFile(result.response.text());
        } catch (error) {
            console.error("Error getting model results: ", error);
            throw error;
        }
    }
        
    async generateOneSentenceSummary(content: string): Promise<string> {
        const prompt = this.plugin.settings.summaryPrompt + content;
        const result = await this.modelNoGrounding.generateContent(prompt);
        return result.response.text();
    }

    private async buildContents(userMessage: string,
                                conversationHistory: any[], 
                                renderContent: boolean = false): Promise<any[]> {
        const contents = [];
        // TODO(adh): This should be cached so it doesn't have to be recomputed every time we call the model.
        const fileContent = await this.plugin.gfile.getCurrentFileContent();
        if (fileContent != null) {
            contents.push({
                role: "user",
                parts: [{ text: fileContent }]
            });
        }
        conversationHistory.forEach((entry) => {
            contents.push({
                role: entry.role,
                parts: [{ text: entry.content }]
            });
        })

        contents.push({
            role: "user",
            parts: [{ text: userMessage }]
        });

        return contents;
    }
}
