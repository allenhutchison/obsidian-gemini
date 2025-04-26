import ObsidianGemini from '../../../main';
import { logDebugInfo } from '../utils/debug';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GeminiPrompts } from '../../prompts';
import { GeminiSearchTool } from '../../tools/search';
import { Notice } from 'obsidian';
import { ModelApi, BaseModelRequest, ExtendedModelRequest, ModelResponse } from '../interfaces/model-api';

/**
 * Implementation of ModelApi for Google's Gemini API
 */
export class GeminiApi implements ModelApi {
	private plugin: ObsidianGemini;
	private gemini: GoogleGenerativeAI;
	private prompts: GeminiPrompts;

	constructor(plugin: ObsidianGemini) {
		this.plugin = plugin;
		this.prompts = new GeminiPrompts();
		this.gemini = new GoogleGenerativeAI(this.plugin.settings.apiKey);
	}

	async generateModelResponse(request: BaseModelRequest | ExtendedModelRequest): Promise<ModelResponse> {
		const lang = window.localStorage.getItem('language') || 'en';
		const systemInstruction = this.prompts.systemPrompt({
			userName: this.plugin.settings.userName,
			language: lang,
		});
		
		const modelToUse = request.model ?? this.plugin.settings.chatModelName;

		if (!request.prompt) {
			throw new Error('No prompt provided to generateModelResponse.');
		}

		let response: ModelResponse = { markdown: '', rendered: '' };
		try {
			if ('conversationHistory' in request) {
				// Extended case with history (chat)
				const contents = await this.buildContents(request);
				logDebugInfo(this.plugin.settings.debugMode, 'Chat contents', contents);
				
				// In the new API all content needs to have a role
				const chatHistory = contents.filter(item => item.role !== undefined);
				logDebugInfo(this.plugin.settings.debugMode, 'Chat history', chatHistory);
				
				const model = this.gemini.getGenerativeModel({
					model: modelToUse,
					generationConfig: {
						temperature: 0.7,
					},
				});
				
				// Create a chat session
				const chat = model.startChat({
					history: chatHistory.slice(0, -1), // Include all messages except the last one (user's latest message)
				});

				// Handle search grounding if enabled
				if (this.plugin.settings.searchGrounding) {
					const searchTool = new GeminiSearchTool(
						systemInstruction,
						this.plugin.settings.apiKey,
						modelToUse,
						this.plugin.settings.searchGroundingThreshold
					);
					const searchModel = searchTool.getSearchModel();
					// For search, we need to pass the user message
					const result = await searchModel.generateContent(request.userMessage);
					response = this.parseModelResult(result);
				} else {
					// Get the last message (user's most recent input)
					const lastMessage = chatHistory[chatHistory.length - 1];
					logDebugInfo(this.plugin.settings.debugMode, 'Sending message', lastMessage);
					// Standard generation without search tools
					const result = await chat.sendMessage(request.userMessage);
					logDebugInfo(this.plugin.settings.debugMode, 'Model response', result);
					response = this.parseModelResult(result);
				}
			} else {
				// Base case - just prompt
				if (this.plugin.settings.searchGrounding) {
					const searchTool = new GeminiSearchTool(
						systemInstruction,
						this.plugin.settings.apiKey,
						modelToUse, 
						this.plugin.settings.searchGroundingThreshold
					);
					const searchModel = searchTool.getSearchModel();
					const result = await searchModel.generateContent(request.prompt);
					response = this.parseModelResult(result);
				} else {
					const model = this.gemini.getGenerativeModel({
						model: modelToUse,
					});
					const result = await model.generateContent(request.prompt);
					response = this.parseModelResult(result);
				}
			}
			return response;
		} catch (error) {
			console.error('Error calling Gemini:', error);
			new Notice('Error calling Gemini.');
			throw error;
		}
	}

	private parseModelResult(result: any): ModelResponse {
		let response: ModelResponse = { markdown: '', rendered: '' };
		
		// Extract text from the response
		try {
			if (result.response) {
				// New API format
				response.markdown = result.response.text();
			} else if (result.candidates && result.candidates.length > 0) {
				// Another possible format
				response.markdown = result.candidates[0].content.parts[0].text;
			} else if (typeof result.text === 'function') {
				// Old API format (keeping for backward compatibility)
				response.markdown = result.text();
			}
			
			// Extract search grounding metadata if available
			if (result.candidates?.[0]?.groundingMetadata?.searchEntryPoint) {
				response.rendered = result.candidates[0].groundingMetadata.searchEntryPoint.renderedContent ?? '';
			} else if (result.response?.candidates?.[0]?.groundingMetadata?.searchEntryPoint) {
				response.rendered = result.response.candidates[0].groundingMetadata.searchEntryPoint.renderedContent ?? '';
			}
		} catch (error) {
			console.error('Error parsing model result:', error);
			console.log('Result:', JSON.stringify(result));
		}
		
		return response;
	}

	// buildContents now uses the shared utility
private async buildContents(request: ExtendedModelRequest): Promise<any[]> {
  const datePrompt = this.prompts.datePrompt({ date: new Date().toDateString() });
  const timePrompt = this.prompts.timePrompt({ time: new Date().toLocaleTimeString() });
  let fileContext: string | null = null;
  if (this.plugin.settings.sendContext) {
    fileContext = await this.plugin.gfile.getCurrentFileContent(this.plugin.settings.maxContextDepth, request.renderContent ?? true);
  }
  return await import('../utils/build-contents').then(mod => mod.buildGeminiChatContents({
    prompt: request.prompt,
    userMessage: request.userMessage,
    conversationHistory: request.conversationHistory,
    datePrompt,
    timePrompt,
    fileContext,
    sendContext: this.plugin.settings.sendContext,
    debugFn: (title: string, data: any) => logDebugInfo(this.plugin.settings.debugMode, title, data),
  }));
}
}