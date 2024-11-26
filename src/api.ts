import ObsidianGemini from '../main';
import { DynamicRetrievalMode, GenerativeModel, GoogleGenerativeAI } from '@google/generative-ai';
import { GeminiPrompts } from './prompts';
import { Notice } from 'obsidian';

export interface ModelResponse {
	markdown: string;
	rendered: string;
}

/**
 * Represents a request to a base model.
 *
 * @property {string} [model] - The optional model identifier. If not provided, the default chatModel will be used.
 * @property {string} prompt - The prompt or input text for the model. Should be fully processed with all variable substitutions complete.
 */
export interface BaseModelRequest {
	model?: string;
	prompt: string;
}

/**
 * Represents an extended model request that includes conversation history and a user message.
 *
 * @extends BaseModelRequest
 *
 * @property {any[]} conversationHistory - An array representing the history of the conversation.
 * @property {string} userMessage - The message from the user.
 */
export interface ExtendedModelRequest extends BaseModelRequest {
	conversationHistory: any[];
	userMessage: string;
	renderContent?: boolean;
}

export class GeminiApi {
	private plugin: ObsidianGemini;
	private gemini: GoogleGenerativeAI;
	private model: GenerativeModel;
	private modelNoGrounding: GenerativeModel;
	private prompts: GeminiPrompts;

	constructor(plugin: ObsidianGemini) {
		this.plugin = plugin;
		this.prompts = new GeminiPrompts();
		const systemInstruction = this.prompts.systemPrompt({
			userName: this.plugin.settings.userName,
		});
		this.gemini = new GoogleGenerativeAI(this.plugin.settings.apiKey);
		let tools: any[] = [];
		if (this.plugin.settings.searchGrounding) {
			tools = [
				{
					googleSearchRetrieval: {
						dynamicRetrievalConfig: {
							mode: DynamicRetrievalMode.MODE_DYNAMIC,
							dynamicThreshold: this.plugin.settings.searchGroundingThreshold,
						},
					},
				},
			];
		}
		this.model = this.gemini.getGenerativeModel({
			model: this.plugin.settings.chatModelName,
			systemInstruction: systemInstruction,
			tools: tools,
		});
		this.modelNoGrounding = this.gemini.getGenerativeModel({
			model: this.plugin.settings.chatModelName,
			systemInstruction: systemInstruction,
		});
	}

	async getBotResponse(userMessage: string, conversationHistory: any[]): Promise<ModelResponse> {
		let response: ModelResponse = { markdown: '', rendered: '' };
		// TODO(adh): I don't really need to repeat the general prompt for every message.
		const prompt = this.prompts.generalPrompt({ userMessage: userMessage });

		try {
			const contents = await this.buildContents(prompt, userMessage, conversationHistory);
			const result = await this.model.generateContent({ contents });
			response.markdown = result.response.text();
			if (result.response.candidates?.[0]?.groundingMetadata?.searchEntryPoint) {
				response.rendered = result.response.candidates[0].groundingMetadata.searchEntryPoint.renderedContent ?? '';
			}
			return response;
		} catch (error) {
			console.error('Error calling Gemini:', error);
			throw error;
		}
	}

	async generateModelResponse(request: BaseModelRequest | ExtendedModelRequest): Promise<ModelResponse> {
		const modelToUse = request.model ?? this.plugin.settings.chatModelName;
		const modelInstance = this.gemini.getGenerativeModel({
			model: modelToUse,
			systemInstruction: this.prompts.systemPrompt({
				userName: this.plugin.settings.userName,
			}),
		});

		if (!request.prompt) {
			throw new Error('No prompt provided to generateModelResponse.');
		}

		let response: ModelResponse = { markdown: '', rendered: '' };
		try {
			if ('conversationHistory' in request) {
				// Extended case with history
				const contents = await this.buildContents(
					request.prompt,
					request.userMessage,
					request.conversationHistory,
					true
				);
				const result = await modelInstance.generateContent({ contents });
				response.markdown = result.response.text();
			} else {
				// Base case - just prompt
				const result = await modelInstance.generateContent(request.prompt);
				response.markdown = result.response.text();
			}
		} catch (error) {
			console.error('Error calling Gemini:', error);
			new Notice('Error calling Gemini.');
			throw error;
		}

		return response;
	}

	private async buildContents(
		prompt: string,
		userMessage: string,
		conversationHistory: any[],
		renderContent: boolean = false
	): Promise<any[]> {
		const contents = [];

		// First push the base prompt on the stack.
		if (prompt != null) {
			contents.push(this.buildContentElement('user', prompt));
		}
		// Then push the current date
		const date = this.prompts.datePrompt({ date: new Date().toDateString() });
		contents.push(this.buildContentElement('user', date));

		// Then push the file context.
		const depth = this.plugin.settings.maxContextDepth;
		const fileContent = await this.plugin.gfile.getCurrentFileContent(depth, renderContent);
		if (fileContent != null) {
			contents.push(this.buildContentElement('user', fileContent));
		}

		// Now the entire conversation history.
		conversationHistory.forEach((entry) => {
			contents.push(this.buildContentElement(entry.role, entry.content));
		});

		// Now the time
		const time = this.prompts.timePrompt({ time: new Date().toLocaleTimeString() });
		contents.push(this.buildContentElement('user', time));

		// Finally, the latest user message.
		contents.push(this.buildContentElement('user', userMessage));
		return contents;
	}

	private buildContentElement(role: string, text: string) {
		const element = [{ role: role, parts: [{ text: text }] }];
		return element;
	}
}
