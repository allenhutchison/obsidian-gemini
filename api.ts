import { GoogleGenerativeAI } from '@google/generative-ai';

export class GeminiApi {
    private gemini: GoogleGenerativeAI;
    private model: any;

    constructor(apiKey: string, modelName: string) {
        console.log("Initializing Gemini API with model:", modelName);
        this.gemini = new GoogleGenerativeAI(apiKey);
        this.model = this.gemini.getGenerativeModel({ model: modelName });
    }

    async getBotResponse(userMessage: string, conversationHistory: any[]): Promise<string> {
        try {
            const contents = this.buildContents(userMessage, conversationHistory);
            const result = await this.model.generateContent({contents});
            const markdownResponse = result.response.text();
            return markdownResponse;
        } catch (error) {
            console.error("Error calling Gemini:", error);
            throw error; //Rethrow so it can be handled by the caller
        }
    }

    async generateOneSentenceSummary(content: string): Promise<string> {
        const prompt = `
        You are a helpful assistant. 
        You use the context provided by the user to create useful single line summaries.
        You only respond with a single sentence that is based on the content provided by the user.
        You only respond with plain text.
        Please summarize the following content: ${content}
        `;
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
