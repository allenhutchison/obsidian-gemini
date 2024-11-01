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
            tools: { functionDeclarations: [ this.replaceDraftDeclaration ] }
        });
    }


    async getBotResponse(userMessage: string, conversationHistory: any[]): Promise<string> {
        try {
            const contents = this.buildContents(userMessage, conversationHistory);
            const result = await this.model.generateContent({contents});
            if (result.response.functionCalls()) {
                const call = result.response.functionCalls()[0]
                const apiResponse = await this.functions[call.name](call.args);
                return apiResponse;
            }
            const markdownResponse = result.response.text();
            return markdownResponse;
        } catch (error) {
            console.error("Error calling Gemini:", error);
            throw error; //Rethrow so it can be handled by the caller
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

    private replaceDraftDeclaration = {
        name: "replaceDraft",
        parameters: {
          type: "OBJECT",
          description: "Begin or replace the document that the user and the model are working on together. It may be that the user wants to replace the content, or start a new document.",
          properties: {
            newDraft: {
              type: "STRING",
              description: "The new draft of the document in Markdown format.",
            },
          },
          required: ["newDraft"],
        },
      };

    private async replaceDraft(newDraft: string) {
        console.log(newDraft);
        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (activeFile && activeFile instanceof TFile && this.plugin.settings.rewriteFiles) {
            try {
                await this.plugin.app.vault.modify(activeFile, newDraft)
            } catch (error) {
                new Notice("Error rewriting file.");
                console.error(error);
            }
        } else {
            return newDraft;
        }
    }

    private functions = {
        replaceDraft: ({ newDraft }) => {
             return this.replaceDraft(newDraft);
        }
    };
}
