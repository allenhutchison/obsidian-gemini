/**
 * Simplified Gemini API implementation using js-genai SDK
 *
 * This replaces the complex API abstraction layer with a single,
 * streamlined implementation powered by @google/genai.
 */

import { GoogleGenAI, Content, Part, GenerateContentParameters, GenerateContentResponse } from '@google/genai';
import {
	ModelApi,
	BaseModelRequest,
	ExtendedModelRequest,
	ModelResponse,
	ToolCall,
	StreamCallback,
	StreamingModelResponse,
	ToolDefinition
} from './interfaces/model-api';
import { GeminiPrompts } from '../prompts';
import type ObsidianGemini from '../main';

/**
 * Configuration for GeminiClient
 */
export interface GeminiClientConfig {
	apiKey: string;
	temperature?: number;
	topP?: number;
	maxOutputTokens?: number;
	streamingEnabled?: boolean;
}

/**
 * GeminiClient - Simplified API wrapper using js-genai SDK
 *
 * Implements ModelApi interface while leveraging the official Google SDK
 */
export class GeminiClient implements ModelApi {
	private ai: GoogleGenAI;
	private config: GeminiClientConfig;
	private prompts: GeminiPrompts;
	private plugin?: ObsidianGemini;

	constructor(config: GeminiClientConfig, prompts?: GeminiPrompts, plugin?: ObsidianGemini) {
		this.config = {
			temperature: 1.0,
			topP: 0.95,
			streamingEnabled: true,
			...config
		};
		this.plugin = plugin;
		this.prompts = prompts || new GeminiPrompts(plugin);
		this.ai = new GoogleGenAI({ apiKey: config.apiKey });
	}

	/**
	 * Get language code from localStorage
	 */
	private getLanguageCode(): string {
		return window.localStorage.getItem('language') || 'en';
	}

	/**
	 * Generate a non-streaming response
	 */
	async generateModelResponse(request: BaseModelRequest | ExtendedModelRequest): Promise<ModelResponse> {
		const params = await this.buildGenerateContentParams(request);

		try {
			const response = await this.ai.models.generateContent(params);
			return this.extractModelResponse(response);
		} catch (error) {
			console.error('[GeminiClient] Error generating content:', error);
			throw error;
		}
	}

	/**
	 * Generate a streaming response
	 */
	generateStreamingResponse(
		request: BaseModelRequest | ExtendedModelRequest,
		onChunk: StreamCallback
	): StreamingModelResponse {
		let cancelled = false;
		let accumulatedText = '';
		let accumulatedRendered = '';
		let toolCalls: ToolCall[] | undefined;

		const complete = (async (): Promise<ModelResponse> => {
			const params = await this.buildGenerateContentParams(request);

			try {
				const stream = await this.ai.models.generateContentStream(params);

				for await (const chunk of stream) {
					if (cancelled) {
						break;
					}

					// Extract text from chunk
					const chunkText = this.extractTextFromChunk(chunk);
					if (chunkText) {
						accumulatedText += chunkText;
						onChunk(chunkText);
					}

					// Extract tool calls from chunk (usually in last chunk)
					const chunkToolCalls = this.extractToolCallsFromChunk(chunk);
					if (chunkToolCalls?.length) {
						toolCalls = chunkToolCalls;
					}

					// Extract search grounding (rendered HTML)
					const rendered = this.extractRenderedFromChunk(chunk);
					if (rendered) {
						accumulatedRendered += rendered;
					}
				}

				return {
					markdown: accumulatedText,
					rendered: accumulatedRendered,
					...(toolCalls && { toolCalls })
				};
			} catch (error) {
				if (cancelled) {
					return {
						markdown: accumulatedText,
						rendered: accumulatedRendered,
						...(toolCalls && { toolCalls })
					};
				}
				console.error('[GeminiClient] Streaming error:', error);
				throw error;
			}
		})();

		return {
			complete,
			cancel: () => {
				cancelled = true;
			}
		};
	}

	/**
	 * Build GenerateContentParameters from our request format
	 */
	private async buildGenerateContentParams(
		request: BaseModelRequest | ExtendedModelRequest
	): Promise<GenerateContentParameters> {
		const isExtended = 'userMessage' in request;
		const model = request.model || 'gemini-2.0-flash-exp';

		// Build system instruction
		let systemInstruction = '';
		if (isExtended) {
			const extReq = request as ExtendedModelRequest;

			// Load AGENTS.md memory if available
			let agentsMemory: string | null = null;
			if (this.plugin?.agentsMemory) {
				try {
					agentsMemory = await this.plugin.agentsMemory.read();
				} catch (error) {
					console.warn('Failed to load AGENTS.md:', error);
				}
			}

			// Build unified system prompt with tools, custom prompt, and agents memory
			// This includes: base system prompt + vault context (AGENTS.md) + tool instructions (if tools) + custom prompt (if provided)
			systemInstruction = this.prompts.getSystemPromptWithCustom(
				extReq.availableTools,
				extReq.customPrompt,
				agentsMemory
			);

			// Append additional instructions from prompt field (e.g., generalPrompt, contextPrompt)
			// Only append if custom prompt didn't override everything
			if (extReq.prompt && !extReq.customPrompt?.overrideSystemPrompt) {
				systemInstruction += '\n\n' + extReq.prompt;
			}
		} else {
			// For BaseModelRequest, prompt is the full input
			systemInstruction = request.prompt || '';
		}

		// Build conversation contents
		const contents = this.buildContents(request);

		// Build config
		const config: any = {
			temperature: request.temperature ?? this.config.temperature,
			topP: request.topP ?? this.config.topP,
			...(this.config.maxOutputTokens && { maxOutputTokens: this.config.maxOutputTokens }),
			...(systemInstruction && { systemInstruction }),
		};

		// Add function calling tools
		const hasTools = isExtended && (request as ExtendedModelRequest).availableTools?.length;
		if (hasTools) {
			const tools = (request as ExtendedModelRequest).availableTools!;
			const functionDeclarations = tools.map(tool => ({
				name: tool.name,
				description: tool.description,
				parameters: {
					type: 'object' as const,
					properties: tool.parameters.properties || {},
					required: tool.parameters.required || []
				}
			}));

			config.tools = config.tools || [];
			config.tools.push({ functionDeclarations });
		}

		// Build params
		// If no contents built, use a simple string from the prompt
		let finalContents: any = contents;
		if (contents.length === 0 && !isExtended) {
			// For BaseModelRequest with no conversation, just pass the prompt as string
			finalContents = request.prompt || '';
		} else if (contents.length === 0) {
			// For ExtendedModelRequest with no history, create a simple user message
			const extReq = request as ExtendedModelRequest;
			finalContents = extReq.userMessage || '';
		}

		const params: GenerateContentParameters = {
			model,
			contents: finalContents,
			config
		};

		return params;
	}

	/**
	 * Build Content[] array from request
	 */
	private buildContents(request: BaseModelRequest | ExtendedModelRequest): Content[] {
		if (!('userMessage' in request)) {
			// BaseModelRequest - just send the prompt as user message
			if (!request.prompt) return [];
			return [{
				role: 'user',
				parts: [{ text: request.prompt }]
			}];
		}

		const extReq = request as ExtendedModelRequest;
		const contents: Content[] = [];

		// Add conversation history
		if (extReq.conversationHistory?.length) {
			for (const entry of extReq.conversationHistory) {
				// Support Content format (already has role and parts)
				if ('role' in entry && 'parts' in entry) {
					contents.push(entry as Content);
				}
				// Support our internal format with role and text
				else if ('role' in entry && 'text' in entry) {
					contents.push({
						role: entry.role === 'user' ? 'user' : 'model',
						parts: [{ text: entry.text }]
					});
				}
				// Support our internal format with role and message
				else if ('role' in entry && 'message' in entry) {
					const msg = entry as any;
					contents.push({
						role: msg.role === 'user' ? 'user' : 'model',
						parts: [{ text: msg.message }]
					});
				}
			}
		}

		// Add current user message (only if non-empty)
		if (extReq.userMessage && extReq.userMessage.trim()) {
			contents.push({
				role: 'user',
				parts: [{ text: extReq.userMessage }]
			});
		}

		return contents;
	}

	/**
	 * Extract ModelResponse from GenerateContentResponse
	 */
	private extractModelResponse(response: GenerateContentResponse): ModelResponse {
		let markdown = '';
		let rendered = '';
		let toolCalls: ToolCall[] | undefined;

		// Extract text from candidates
		if (response.candidates?.[0]?.content?.parts) {
			for (const part of response.candidates[0].content.parts) {
				if ('text' in part && part.text) {
					markdown += part.text;
				}
			}
		}

		// Extract tool calls
		toolCalls = this.extractToolCallsFromResponse(response);

		// Extract search grounding
		rendered = this.extractRenderedFromResponse(response);

		return {
			markdown,
			rendered,
			...(toolCalls && { toolCalls })
		};
	}

	/**
	 * Extract text from streaming chunk
	 */
	private extractTextFromChunk(chunk: any): string {
		if (chunk.candidates?.[0]?.content?.parts) {
			return chunk.candidates[0].content.parts
				.filter((part: Part) => 'text' in part && part.text)
				.map((part: Part) => (part as any).text)
				.join('');
		}
		return '';
	}

	/**
	 * Extract tool calls from response
	 */
	private extractToolCallsFromResponse(response: GenerateContentResponse): ToolCall[] | undefined {
		const parts = response.candidates?.[0]?.content?.parts;
		if (!parts) return undefined;

		const toolCalls: ToolCall[] = [];
		for (const part of parts) {
			if ('functionCall' in part && part.functionCall && part.functionCall.name) {
				toolCalls.push({
					name: part.functionCall.name,
					arguments: part.functionCall.args || {}
				});
			}
		}

		return toolCalls.length > 0 ? toolCalls : undefined;
	}

	/**
	 * Extract tool calls from streaming chunk
	 */
	private extractToolCallsFromChunk(chunk: any): ToolCall[] | undefined {
		return this.extractToolCallsFromResponse(chunk as GenerateContentResponse);
	}

	/**
	 * Extract rendered HTML from response (search grounding)
	 */
	private extractRenderedFromResponse(response: GenerateContentResponse): string {
		// Search grounding metadata is in groundingMetadata
		const metadata = (response as any).candidates?.[0]?.groundingMetadata;
		if (!metadata) return '';

		// Extract and format grounding sources
		const chunks = metadata.groundingChunks || [];
		const supports = metadata.groundingSupports || [];

		if (chunks.length === 0) return '';

		// Build HTML similar to how Gemini API returns it
		let html = '<div class="search-grounding">';
		html += '<h4>Sources:</h4>';
		html += '<ul>';

		for (const chunk of chunks) {
			if (chunk.web) {
				html += `<li><a href="${chunk.web.uri}" target="_blank">${chunk.web.title || chunk.web.uri}</a></li>`;
			}
		}

		html += '</ul>';
		html += '</div>';

		return html;
	}

	/**
	 * Extract rendered content from streaming chunk
	 */
	private extractRenderedFromChunk(chunk: any): string {
		return this.extractRenderedFromResponse(chunk as GenerateContentResponse);
	}
}
