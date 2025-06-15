import { GoogleGenAI } from '@google/genai';
import { logDebugInfo } from '../utils/debug';
import {
	ModelApi,
	BaseModelRequest,
	ExtendedModelRequest,
	ModelResponse,
	StreamCallback,
	StreamingModelResponse,
} from '../interfaces/model-api';
import ObsidianGemini from '../../../main';
import { GeminiPrompts } from '../../prompts';

/**
 * Implementation of ModelApi using the new @google/genai SDK.
 */
export class GeminiApiNew implements ModelApi {
	private plugin: ObsidianGemini;
	private ai: GoogleGenAI;
	private prompts: GeminiPrompts;

	/**
	 * @param apiKey Gemini API key
	 * @param model Model name/id (optional, defaults to 'gemini-pro')
	 */
	constructor(plugin: ObsidianGemini) {
		this.plugin = plugin;
		this.ai = new GoogleGenAI({ apiKey: this.plugin.settings.apiKey });
		this.prompts = new GeminiPrompts(plugin);
	}

	generateStreamingResponse(
		request: BaseModelRequest | ExtendedModelRequest,
		onChunk: StreamCallback
	): StreamingModelResponse {
		let cancelled = false;

		const complete = (async (): Promise<ModelResponse> => {
			logDebugInfo(this.plugin.settings.debugMode, 'Generating streaming response for request', request);
			
			// Get system instruction with optional custom prompt
			const customPrompt = 'customPrompt' in request ? request.customPrompt : undefined;
			const systemInstruction = await this.prompts.getSystemPromptWithCustom(customPrompt);
			
			const modelToUse = request.model ?? this.plugin.settings.chatModelName;

			let fullMarkdown = '';
			let rendered = '';

			try {
				if ('conversationHistory' in request) {
					let tools = [];
					if (this.plugin.settings.searchGrounding) {
						tools.push({ googleSearch: {} });
					}
					const contents = await this.buildGeminiChatContents(request);

					const streamingResult = await this.ai.models.generateContentStream({
						model: modelToUse,
						config: {
							systemInstruction: systemInstruction,
							tools: tools,
						},
						contents: contents,
					});

					for await (const chunk of streamingResult) {
						if (cancelled) {
							break;
						}

						const chunkText = chunk.text;
						if (chunkText) {
							const decodedChunk = this._decodeHtmlEntities(chunkText);
							fullMarkdown += decodedChunk;
							onChunk(decodedChunk);
						}
					}
					logDebugInfo(this.plugin.settings.debugMode, 'Streaming response complete', fullMarkdown);
				} else {
					const streamingResult = await this.ai.models.generateContentStream({
						model: modelToUse,
						contents: request.prompt,
					});

					for await (const chunk of streamingResult) {
						if (cancelled) {
							break;
						}

						const chunkText = chunk.text;
						if (chunkText) {
							const decodedChunk = this._decodeHtmlEntities(chunkText);
							fullMarkdown += decodedChunk;
							onChunk(decodedChunk);
						}
					}
				}
			} catch (error) {
				console.error('Error during streaming:', error);
				throw error;
			}

			return { markdown: fullMarkdown, rendered };
		})();

		return {
			complete,
			cancel: () => {
				cancelled = true;
			},
		};
	}

	async generateModelResponse(request: BaseModelRequest | ExtendedModelRequest): Promise<ModelResponse> {
		logDebugInfo(this.plugin.settings.debugMode, 'Generating model response for request', request);
		
		// Get system instruction with optional custom prompt
		const customPrompt = 'customPrompt' in request ? request.customPrompt : undefined;
		const systemInstruction = await this.prompts.getSystemPromptWithCustom(customPrompt);
		
		const modelToUse = request.model ?? this.plugin.settings.chatModelName;

		let response: ModelResponse = { markdown: '', rendered: '' };
		if ('conversationHistory' in request) {
			let tools = [];
			if (this.plugin.settings.searchGrounding) {
				tools.push({ googleSearch: {} });
			}
			const contents = await this.buildGeminiChatContents(request);
			const result = await this.ai.models.generateContent({
				model: modelToUse,
				config: {
					systemInstruction: systemInstruction,
					tools: tools,
				},
				contents: contents,
			});
			logDebugInfo(this.plugin.settings.debugMode, 'Model response', result);
			response = this.parseModelResult(result);
		} else {
			const result = await this.ai.models.generateContent({
				model: modelToUse,
				contents: request.prompt,
			});
			response = this.parseModelResult(result);
		}

		return response;
	}

	async buildGeminiChatContents(request: ExtendedModelRequest): Promise<any[]> {
		const contents = [];

		// First push the base prompt on the stack.
		if (request.prompt != null) {
			contents.push(request.prompt);
		}

		// Then push the file context.
		const depth = this.plugin.settings.maxContextDepth;
		const renderContent = request.renderContent ?? true;
		const fileContent = await this.plugin.gfile.getCurrentFileContent(depth, renderContent);
		if (fileContent != null) {
			contents.push(fileContent);
		}

		// Now the entire conversation history.
		const history = request.conversationHistory ?? [];
		history.forEach((entry) => {
			contents.push(entry.message);
		});

		// Finally, the latest user message.
		contents.push(request.userMessage);
		logDebugInfo(this.plugin.settings.debugMode, 'Chat contents', contents);
		return contents;
	}

	private parseModelResult(result: any): ModelResponse {
		let response: ModelResponse = { markdown: '', rendered: '' };

		// Extract text from the response
		try {
			let rawMarkdown = '';
			if (result.text && typeof result.text === 'string') {
				// Check if result.text is a string
				// New API format
				rawMarkdown = result.text;
			} else if (typeof result.text === 'function') {
				// Old API format (keeping for backward compatibility)
				const textContent = result.text();
				if (typeof textContent === 'string') {
					// Ensure the function returns a string
					rawMarkdown = textContent;
				}
			}
			// ... (other conditions for extracting text if any) ...

			if (rawMarkdown) {
				// Check if rawMarkdown has content
				response.markdown = this._decodeHtmlEntities(rawMarkdown);
			} else {
				response.markdown = ''; // Ensure markdown is empty string if no text extracted
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

	private _decodeHtmlEntities(encodedString: string): string {
		if (typeof document !== 'undefined') {
			const textarea = document.createElement('textarea');
			textarea.innerHTML = encodedString;
			return textarea.value;
		}
		// Fallback for environments where document is not available,
		// though for an Obsidian plugin, 'document' should typically exist.
		// This fallback could be simpler or more complex depending on requirements.
		// For now, let's assume 'document' is available and not overcomplicate the fallback.
		// If a more robust non-DOM fallback is needed, a library like 'he' would be better.
		console.warn('HTML entity decoding attempted in an environment without `document`. Returning original string.');
		return encodedString;
	}
}
