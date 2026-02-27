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
	ToolDefinition,
} from './interfaces/model-api';
import { GeminiPrompts } from '../prompts';
import type ObsidianGemini from '../main';
import { getDefaultModelForRole } from '../models';
import { decodeHtmlEntities } from '../utils/html-entities';

/**
 * Extends Part to include the optional thought property
 */
interface PartWithThought extends Part {
	thought?: boolean;
	thoughtSignature?: string;
}

/**
 * Configuration for GeminiClient
 */
export interface GeminiClientConfig {
	apiKey: string;
	model?: string;
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
			...config,
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
			this.plugin?.logger.error('[GeminiClient] Error generating content:', error);
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
		let accumulatedThoughts = '';
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
					}

					// Extract thought content from chunk
					const chunkThought = this.extractThoughtFromChunk(chunk);
					if (chunkThought) {
						accumulatedThoughts += chunkThought;
						this.plugin?.logger.debug(`[GeminiClient] Sending thought chunk to callback`);
					}

					// Call callback with both text and thought if either is present
					if (chunkText || chunkThought) {
						onChunk({
							text: chunkText,
							...(chunkThought && { thought: chunkThought }),
						});
					}

					// Extract tool calls from chunk (usually in last chunk)
					// IMPORTANT: Keep the first tool calls we receive, as they contain the thought signature
					// Later chunks may repeat the same tool calls without the signature
					const chunkToolCalls = this.extractToolCallsFromChunk(chunk);
					// Only set toolCalls once - preserve first chunk which has thought signatures
					// The '!toolCalls' check prevents overwriting with subsequent chunks
					if (chunkToolCalls?.length && !toolCalls) {
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
					...(accumulatedThoughts && { thoughts: accumulatedThoughts }),
					...(toolCalls && { toolCalls }),
				};
			} catch (error) {
				if (cancelled) {
					return {
						markdown: accumulatedText,
						rendered: accumulatedRendered,
						...(accumulatedThoughts && { thoughts: accumulatedThoughts }),
						...(toolCalls && { toolCalls }),
					};
				}
				this.plugin?.logger.error('[GeminiClient] Streaming error:', error);
				throw error;
			}
		})();

		return {
			complete,
			cancel: () => {
				cancelled = true;
			},
		};
	}

	/**
	 * Build GenerateContentParameters from our request format
	 */
	private async buildGenerateContentParams(
		request: BaseModelRequest | ExtendedModelRequest
	): Promise<GenerateContentParameters> {
		const isExtended = 'userMessage' in request;
		const model = request.model || this.config.model || getDefaultModelForRole('chat');

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
					this.plugin.logger.warn('Failed to load AGENTS.md:', error);
				}
			}

			// Load available skill summaries for system prompt injection
			let availableSkills: { name: string; description: string }[] = [];
			if (this.plugin?.skillManager) {
				try {
					availableSkills = await this.plugin.skillManager.getSkillSummaries();
				} catch (error) {
					this.plugin.logger.warn('Failed to load skill summaries:', error);
				}
			}

			// Build unified system prompt with tools, custom prompt, agents memory, and available skills
			// This includes: base system prompt + vault context (AGENTS.md) + tool instructions (if tools) + custom prompt (if provided)
			systemInstruction = this.prompts.getSystemPromptWithCustom(
				extReq.availableTools,
				extReq.customPrompt,
				agentsMemory,
				availableSkills
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

		// Add thinking config if model supports it
		if (this.supportsThinking(model)) {
			config.thinkingConfig = {
				includeThoughts: true,
				thinkingBudget: -1, // -1 = automatic budget
			};
		}

		// Add function calling tools
		const hasTools = isExtended && (request as ExtendedModelRequest).availableTools?.length;
		if (hasTools) {
			const tools = (request as ExtendedModelRequest).availableTools!;
			const functionDeclarations = tools.map((tool) => ({
				name: tool.name,
				description: tool.description,
				parameters: {
					type: 'object' as const,
					properties: tool.parameters.properties || {},
					required: tool.parameters.required || [],
				},
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
			config,
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
			return [
				{
					role: 'user',
					parts: [{ text: request.prompt }],
				},
			];
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
						parts: [{ text: entry.text }],
					});
				}
				// Support our internal format with role and message
				else if ('role' in entry && 'message' in entry) {
					const msg = entry as any;
					contents.push({
						role: msg.role === 'user' ? 'user' : 'model',
						parts: [{ text: msg.message }],
					});
				}
			}
		}

		// Build user message parts (text + images)
		const userParts: Part[] = [];

		// Add text content if present
		if (extReq.userMessage && extReq.userMessage.trim()) {
			userParts.push({ text: extReq.userMessage });
		}

		// Add inline data attachments (images, audio, video, PDF)
		const allAttachments = [...(extReq.inlineAttachments || []), ...(extReq.imageAttachments || [])];
		for (const attachment of allAttachments) {
			userParts.push({
				inlineData: {
					mimeType: attachment.mimeType,
					data: attachment.base64,
				},
			});
		}

		// Add current user message with all parts (only if there are parts)
		if (userParts.length > 0) {
			contents.push({
				role: 'user',
				parts: userParts,
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
		let thoughts = '';
		let toolCalls: ToolCall[] | undefined;

		// Extract text and thoughts from candidates
		if (response.candidates?.[0]?.content?.parts) {
			for (const part of response.candidates[0].content.parts) {
				if ('text' in part && part.text) {
					// Separate thought content from regular content
					if ((part as PartWithThought).thought) {
						thoughts += part.text;
					} else {
						markdown += part.text;
					}
				}
			}
		}

		// Decode HTML entities that Gemini sometimes returns
		markdown = decodeHtmlEntities(markdown);

		// Extract tool calls
		toolCalls = this.extractToolCallsFromResponse(response);

		// Extract search grounding
		rendered = this.extractRenderedFromResponse(response);

		return {
			markdown,
			rendered,
			...(thoughts && { thoughts }),
			...(toolCalls && { toolCalls }),
		};
	}

	/**
	 * Extract text from streaming chunk
	 */
	private extractTextFromChunk(chunk: any): string {
		if (chunk.candidates?.[0]?.content?.parts) {
			const text = chunk.candidates[0].content.parts
				.filter((part: Part) => 'text' in part && part.text && !(part as PartWithThought).thought)
				.map((part: Part) => (part as PartWithThought).text)
				.join('');
			return decodeHtmlEntities(text);
		}
		return '';
	}

	/**
	 * Extract thought/reasoning content from streaming chunk
	 */
	private extractThoughtFromChunk(chunk: any): string {
		if (chunk.candidates?.[0]?.content?.parts) {
			const parts = chunk.candidates[0].content.parts;
			const thoughtParts = parts.filter(
				(part: Part) => (part as PartWithThought).thought && (part as PartWithThought).text
			);

			if (thoughtParts.length > 0) {
				const thoughtText = thoughtParts.map((part: Part) => (part as PartWithThought).text).join('');
				const preview = thoughtText.length > 100 ? thoughtText.substring(0, 100) + '...' : thoughtText;
				this.plugin?.logger.debug(`[GeminiClient] Extracted thought: ${preview}`);
				return thoughtText;
			}
		}
		return '';
	}

	/**
	 * Check if a model supports thinking/reasoning mode
	 */
	private supportsThinking(model: string | undefined): boolean {
		if (!model) {
			this.plugin?.logger.debug('[GeminiClient] No model specified for thinking check');
			return false;
		}

		const modelLower = model.toLowerCase();
		const supports =
			modelLower.includes('gemini-2.5') || modelLower.includes('gemini-3') || modelLower.includes('thinking-exp');

		if (supports) {
			this.plugin?.logger.debug(`[GeminiClient] Enabling thinking mode for model: ${model}`);
		}

		return supports;
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
				const signature = (part as PartWithThought).thoughtSignature;

				// Debug logging to verify extraction
				this.plugin?.logger.debug(
					`[GeminiClient] Extracted tool call: ${part.functionCall.name}, ` +
						`has signature: ${signature !== undefined}`
				);

				toolCalls.push({
					name: part.functionCall.name,
					arguments: part.functionCall.args || {},
					thoughtSignature: signature,
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

	/**
	 * Generate an image from a text prompt
	 * @param prompt - Text description of the image to generate
	 * @param model - Image generation model (defaults to gemini-2.5-flash-image-preview)
	 * @returns Base64 encoded image data
	 */
	async generateImage(prompt: string, model: string): Promise<string> {
		try {
			const params: GenerateContentParameters = {
				model,
				contents: prompt,
				config: {
					// Image generation typically doesn't need temperature/topP
					// but we can include them if needed
				},
			};

			const response = await this.ai.models.generateContent(params);

			// Extract base64 image data from response
			// The response may contain multiple parts: text + inlineData
			// We need to find the part with inlineData
			const parts = response.candidates?.[0]?.content?.parts;
			if (!parts || parts.length === 0) {
				throw new Error('No content parts in response');
			}

			// Find the part with image data
			for (const part of parts) {
				if ('inlineData' in part && part.inlineData?.data) {
					return part.inlineData.data;
				}
			}

			// If we get here, no image data was found
			throw new Error('No image data in response. The model may have returned only text.');
		} catch (error) {
			this.plugin?.logger.error('[GeminiClient] Error generating image:', error);
			throw error;
		}
	}
}
