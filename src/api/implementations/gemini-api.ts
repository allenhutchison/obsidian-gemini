import ObsidianGemini from '../../../main';
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
				this.logDebugInfo('Chat contents', contents);
				
				// In the new API all content needs to have a role
				const chatHistory = contents.filter(item => item.role !== undefined);
				this.logDebugInfo('Chat history', chatHistory);
				
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
					this.logDebugInfo('Sending message', lastMessage);
					// Standard generation without search tools
					const result = await chat.sendMessage(request.userMessage);
					this.logDebugInfo('Model response', result);
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

	private async buildContents(request: ExtendedModelRequest): Promise<any[]> {
		const contents = [];
		
		// First push the base prompt on the stack as a system message
		if (request.prompt != null) {
			contents.push({ 
				role: 'user',
				parts: [{ text: request.prompt }]
			});
		}
		
		// Then push the current date as a system message
		const date = this.prompts.datePrompt({ date: new Date().toDateString() });
		contents.push({ 
			role: 'user',
			parts: [{ text: date }]
		});

		// Then push the file context as a system message
		const depth = this.plugin.settings.maxContextDepth;
		const renderContent = request.renderContent ?? true;
		// Only include file context if sendContext setting is true
		if (this.plugin.settings.sendContext) {
			const fileContent = await this.plugin.gfile.getCurrentFileContent(depth, renderContent);
			if (fileContent != null) {
				// Log the context to help with debugging
				this.logDebugInfo('File context', fileContent);
				
				contents.push({ 
					role: 'user',
					parts: [{ text: fileContent }]
				});
			}
		} else {
			this.logDebugInfo('File context', 'Context sending is disabled in settings');
		}

		// Now the entire conversation history
		const history = request.conversationHistory ?? [];
		history.forEach((entry) => {
			// Convert from the old format to the new format
			let role = entry.role === 'model' ? 'model' : 'user';
			contents.push({
				role: role,
				parts: [{ text: entry.message }]
			});
		});

		// Now the time as a system message
		const time = this.prompts.timePrompt({ time: new Date().toLocaleTimeString() });
		contents.push({ 
			role: 'user',
			parts: [{ text: time }]
		});

		// Finally, the latest user message
		contents.push({ 
			role: 'user',
			parts: [{ text: request.userMessage }]
		});
		
		return contents;
	}

	private buildContentElement(role: string, text: string) {
		// This method is no longer used, but kept for reference
		// The format should be:
		// { role: 'user', parts: [{ text: 'Your text here' }] }
		return {
			role: role === 'model' ? 'model' : 'user',
			parts: [{ text: text }]
		};
	}

	private logDebugInfo(title: string, data: any) {
		if (this.plugin.settings.debugMode) {
			console.log(`[GeminiAPI Debug] ${title}:`, JSON.stringify(data, null, 2));
		}
	}
} 