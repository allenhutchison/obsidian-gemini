import ObsidianGemini from '../main';
import {
	DynamicRetrievalMode,
	GenerateContentResult,
	GenerativeModel,
	GoogleGenerativeAI,
} from '@google/generative-ai';
import { GeminiPrompts } from './prompts';
import { GeminiSearchTool } from './tools/search';
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
	private prompts: GeminiPrompts;

	constructor(plugin: ObsidianGemini) {
		this.plugin = plugin;
		this.prompts = new GeminiPrompts(this.plugin.settings);
		this.gemini = new GoogleGenerativeAI(this.plugin.settings.apiKey);
	}

	async generateModelResponse(request: BaseModelRequest | ExtendedModelRequest): Promise<ModelResponse> {
		const modelInstance = this.getModelInstance(request.model);

		if (!request.prompt) {
			throw new Error('No prompt provided to generateModelResponse.');
		}

		let response: ModelResponse = { markdown: '', rendered: '' };
		try {
			if ('conversationHistory' in request) {
				// Extended case with history
				const contents = await this.buildContents(request);
				const result = await modelInstance.generateContent({ contents });
				response = this.parseModelResult(result);
			} else {
				// Base case - just prompt
				const result = await modelInstance.generateContent(request.prompt);
				response = this.parseModelResult(result);
			}
			return response;
		} catch (error) {
			console.error('Error calling Gemini:', error);
			new Notice('Error calling Gemini.');
			throw error;
		}
	}

	private getModelInstance(modelName?: string): GenerativeModel {
		const modelToUse = modelName ?? this.plugin.settings.chatModelName;
		const lang = window.localStorage.getItem('language') || 'en';
		const systemInstruction = this.prompts.systemPrompt({
			userName: this.plugin.settings.userName,
			language: lang,
		});
		let tools: any[] = [];
		let modelInstance: GenerativeModel;
		if (this.plugin.settings.searchGrounding) {
			modelInstance = new GeminiSearchTool(
				systemInstruction,
				this.plugin.settings.apiKey,
				modelToUse,
				this.plugin.settings.searchGroundingThreshold
			).getSearchModel();
		} else {
			modelInstance = this.gemini.getGenerativeModel({
				model: modelToUse,
				systemInstruction: systemInstruction,
			});
		}
		return modelInstance;
	}

	private parseModelResult(result: GenerateContentResult): ModelResponse {
		let response: ModelResponse = { markdown: '', rendered: '' };
		response.markdown = result.response.text();
		if (result.response.candidates?.[0]?.groundingMetadata?.searchEntryPoint) {
			response.rendered = result.response.candidates[0].groundingMetadata.searchEntryPoint.renderedContent ?? '';
		}
		return response;
	}

	private async buildContents(request: ExtendedModelRequest): Promise<any[]> {
		const contents = [];

		// First push the base prompt on the stack.
		if (request.prompt != null) {
			contents.push(this.buildContentElement('user', request.prompt));
		}
		
		// Then push the current date
		const date = this.prompts.datePrompt({ date: new Date().toDateString() });
		contents.push(this.buildContentElement('user', date));

		// Then push the file context.
		const depth = this.plugin.settings.maxContextDepth;
		const renderContent = request.renderContent ?? true;
		const fileContent = await this.plugin.gfile.getCurrentFileContent(depth, renderContent);
		if (fileContent != null) {
			contents.push(this.buildContentElement('user', fileContent));
		}

		// Now the entire conversation history.
		const history = request.conversationHistory ?? [];
		history.forEach((entry) => {
			contents.push(this.buildContentElement(entry.role, entry.message));
		});

		// Now the time
		const time = this.prompts.timePrompt({ time: new Date().toLocaleTimeString() });
		contents.push(this.buildContentElement('user', time));

		// Finally, the latest user message.
		contents.push(this.buildContentElement('user', request.userMessage));
		return contents;
	}

	private buildContentElement(role: string, text: string) {
		const element = [{ role: role, parts: [{ text: text }] }];
		return element;
	}
}
