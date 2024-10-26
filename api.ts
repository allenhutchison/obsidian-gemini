import { GoogleGenerativeAI } from '@google/generative-ai';
import { Notice } from 'obsidian';

export async function getBotResponse(userMessage: string, apiKey: string, conversationHistory: any[]): Promise<string> {
    const gemini = new GoogleGenerativeAI(apiKey); // Create instance here
    const model = gemini.getGenerativeModel({ 
        model: "gemini-1.5-flash",
    });

    try {
        const contents = buildContents(userMessage, conversationHistory); // Pass history

        const result = await model.generateContent({contents});

        const markdownResponse = result.response.text();

        return markdownResponse;
    } catch (error) {
        console.error("Error calling Gemini:", error);
        throw error; //Rethrow so it can be handled by the caller
    }
}

function buildContents(userMessage: string, conversationHistory: any[]): any[] {
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
