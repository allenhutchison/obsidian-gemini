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

    constructor(plugin: ObsidianGemini) {
        this.plugin = plugin;
        console.log("Initializing Gemini API with model:", this.plugin.settings.modelName);
        const systemInstruction = this.plugin.settings.systemPrompt + ` My name is ${this.plugin.settings.userName}.`;
        this.gemini = new GoogleGenerativeAI(this.plugin.settings.apiKey);
        let tools: any[] = [];
        if (this.plugin.settings.searchGrounding) {
            tools = [
                {googleSearchRetrieval: {
                    dynamicRetrievalConfig: {
                    mode: DynamicRetrievalMode.MODE_DYNAMIC,
                    dynamicThreshold: 0.6,
                }}}];
            
        }
        this.model = this.gemini.getGenerativeModel({ 
            model: this.plugin.settings.modelName,
            systemInstruction: systemInstruction,
            tools: tools,
        });

    }

    async getBotResponse(userMessage: string, conversationHistory: any[]): Promise<string> {
        try {
            const contents = await this.buildContents(userMessage, conversationHistory);
            const result = await this.model.generateContent({contents});
            let markdownResponse = result.response.text();
            return markdownResponse;
        } catch (error) {
            console.error("Error calling Gemini:", error);
            throw error; 
        }
    }

    async generateGroundedResponse(prompt: string, conversationHistory: any[]): Promise<GeminiResponse> {
        try {
            const contents = await this.buildContents(prompt, conversationHistory);
            const result = await this.model.generateContent({contents});
            let markdownResponse = result.response.text();
            let renderedContent = '';
            if (result.response.candidates[0].groundingMetadata) {
                renderedContent = result.response.candidates[0].groundingMetadata.searchEntryPoint.renderedContent;
            }
            return {
                markdown: markdownResponse,
                rendered: renderedContent
            };
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
            const result = await this.model.generateContent({contents});
            await this.plugin.gfile.replaceTextInActiveFile(result.response.text());
        } catch (error) {
            console.error("Error getting model results: ", error);
            throw error;
        }
    }
        
    async generateOneSentenceSummary(content: string): Promise<string> {
        const prompt = this.plugin.settings.summaryPrompt + content;
        const result = await this.model.generateContent(prompt);
        return result.response.text();
    }

    private async buildContents(userMessage: string, conversationHistory: any[]): Promise<any[]> {
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
