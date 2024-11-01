import ObsidianGemini from '../main';
import { Notice, TFile } from 'obsidian';
import { GoogleGenerativeAI } from '@google/generative-ai';


export class GeminiApi {
    private gemini: GoogleGenerativeAI;
    private model: any;
    private plugin: ObsidianGemini;

    constructor(plugin: ObsidianGemini) {
        this.plugin = plugin;
        console.log("Initializing Gemini API with model:", this.plugin.settings.modelName);
        this.gemini = new GoogleGenerativeAI(this.plugin.settings.apiKey);
        this.model = this.gemini.getGenerativeModel({ 
            model: this.plugin.settings.modelName,
            systemInstruction: this.plugin.settings.systemPrompt,
        });
    }


    async getBotResponse(userMessage: string, conversationHistory: any[]): Promise<string> {
        try {
            const contents = this.buildContents(userMessage, conversationHistory);
            const result = await this.model.generateContent({contents});
            const markdownResponse = result.response.text();
            return markdownResponse;
        } catch (error) {
            console.error("Error calling Gemini:", error);
            throw error; 
        }
    }

    async generateOneSentenceSummary(content: string): Promise<string> {
        const prompt = this.plugin.settings.summaryPrompt + content;
        const result = await this.model.generateContent(prompt);
        return result.response.text();
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
