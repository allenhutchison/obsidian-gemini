import ObsidianGemini from '../main';
import {
	DynamicRetrievalMode,
	GenerativeModel,
	GoogleGenerativeAI,
} from '@google/generative-ai';
import { GeminiPrompts } from './prompts';

export interface ModelResponse {
	markdown: string;
	rendered: string;
}

export interface ModelRequest {
	model?: string | null;
	prompt?: string | null;
	conversationHistory?: any[] | null;
	userMessage?: string | null;
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

	async getBotResponse(
		userMessage: string,
		conversationHistory: any[]
	): Promise<ModelResponse> {
		let response: ModelResponse = { markdown: '', rendered: '' };
		// TODO(adh): I don't really need to repeat the general prompt for every message.
		const prompt = this.prompts.generalPrompt({ userMessage: userMessage });

		try {
			const contents = await this.buildContents(prompt, conversationHistory);
			const result = await this.model.generateContent({ contents });
			response.markdown = result.response.text();
			if (
				result.response.candidates?.[0]?.groundingMetadata?.searchEntryPoint
			) {
				response.rendered =
					result.response.candidates[0].groundingMetadata.searchEntryPoint.renderedContent;
			}
			return response;
		} catch (error) {
			console.error('Error calling Gemini:', error);
			throw error;
		}
	}

	async generateRewriteResponse(
		userMessage: string,
		conversationHistory: any[]
	) {
		const prompt = this.prompts.rewritePrompt({ userMessage: userMessage });
		const contents = await this.buildContents(prompt, conversationHistory);
		await this.plugin.history.appendHistory({
			role: 'user',
			content: userMessage,
		});
		const result = await this.modelNoGrounding.generateContent({ contents });
		await this.plugin.gfile.replaceTextInActiveFile(result.response.text());
	}

	async generateModelResponse(request: ModelRequest): Promise<ModelResponse> {
		let response: ModelResponse = { markdown: '', rendered: '' };
		const modelToUse = request.model
			? request.model
			: this.plugin.settings.chatModelName;
		const modelInstance = this.gemini.getGenerativeModel({
			model: modelToUse,
			systemInstruction: this.prompts.systemPrompt({
				userName: this.plugin.settings.userName,
			}),
		});

		if (!request.prompt) {
			throw new Error('No prompt provided to generateModelResponse.');
		} else {
			try {
				const result = await modelInstance.generateContent(request.prompt);
				response.markdown = result.response.text();
			} catch (error) {
				console.error('Error calling Gemini:', error);
				new Notification('Error calling Gemini.');
				throw error;
			}
		}
		return response;
	}

	private async buildContents(
		userMessage: string,
		conversationHistory: any[],
		renderContent: boolean = false
	): Promise<any[]> {
		const contents = [];
		// TODO(adh): This should be cached so it doesn't have to be recomputed every time we call the model.
		const fileContent = await this.plugin.gfile.getCurrentFileContent();
		const prompt = this.prompts.generalPrompt({ userMessage: userMessage });
		if (fileContent != null) {
			contents.push({
				role: 'user',
				parts: [{ text: fileContent }],
			});
		}
		conversationHistory.forEach((entry) => {
			contents.push({
				role: entry.role,
				parts: [{ text: entry.content }],
			});
		});

		contents.push({
			role: 'user',
			parts: [
				{
					text: `Today's Date is ${new Date().toDateString()}, and the time is ${new Date().toLocaleTimeString()}.`,
				},
			],
		});
		contents.push({
			role: 'user',
			parts: [{ text: userMessage }],
		});

		return contents;
	}
}
