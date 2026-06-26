/**
 * Simplified Gemini API implementation using js-genai SDK
 *
 * This replaces the complex API abstraction layer with a single,
 * streamlined implementation powered by @google/genai.
 */
import { createGoogleGenAI } from './google-genai-factory';
import {
	GoogleGenAI,
	Content,
	Part,
	GenerateContentParameters,
	GenerateContentResponse,
	GenerateContentResponseUsageMetadata,
} from '@google/genai';
import type { ThinkingLevel } from '@google/genai';
import {
	ModelApi,
	BaseModelRequest,
	ExtendedModelRequest,
	ModelResponse,
	ToolCall,
	StreamCallback,
	StreamingModelResponse,
	isExtendedRequest,
} from '../../interfaces/model-api';
import { GeminiPrompts } from '../../../prompts';
import type ObsidianGemini from '../../../main';
import { getDefaultModelForRole } from '../../../models';
import { decodeHtmlEntities } from '../../../utils/html-entities';
import type { GeminiClientConfig } from './config';
import { ModelUseCase } from '../../model-use-case';
import {
	buildUserInputStep,
	contentToSteps,
	extractModelResponseFromInteraction,
	toolsToInteractionTools,
	InteractionStreamAccumulator,
	type InteractionStep,
} from './interactions-mapper';
import { installObsidianFetch } from './obsidian-fetch';

/**
 * Per-use-case reasoning depth for Gemini 3.x `thinkingConfig.thinkingLevel`,
 * replacing the legacy global `thinkingBudget: -1`. These are starting points
 * (see #621; tune against the eval suite in #619): latency-sensitive paths
 * think the least, while CHAT — which is the agent loop — thinks the most.
 *
 * | Use case    | level    | why                                            |
 * | ----------- | -------- | ---------------------------------------------- |
 * | Completions | MINIMAL  | latency-sensitive, simple next-token output    |
 * | Summary     | LOW      | bounded, templated output                      |
 * | Rewrite     | LOW      | short, focused edits                           |
 * | Search      | MEDIUM   | query understanding + synthesis                |
 * | Chat        | HIGH     | agent mode: multi-step tool use, benefits most |
 */
// The literal strings are the `ThinkingLevel` enum's own runtime values, used
// directly (with a single cast) instead of the imported enum members so this
// module never touches the SDK's runtime namespace — keeping it load-safe under
// tests that mock `@google/genai`. The per-use-case values are covered by unit
// tests, which catch any typo here.
const THINKING_LEVEL_BY_USE_CASE: Record<ModelUseCase, ThinkingLevel> = {
	[ModelUseCase.COMPLETIONS]: 'MINIMAL',
	[ModelUseCase.SUMMARY]: 'LOW',
	[ModelUseCase.REWRITE]: 'LOW',
	[ModelUseCase.SEARCH]: 'MEDIUM',
	[ModelUseCase.CHAT]: 'HIGH',
} as Record<ModelUseCase, ThinkingLevel>;

/**
 * Extends Part to include the optional thought property
 */
interface PartWithThought extends Part {
	thought?: boolean;
	thoughtSignature?: string;
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
		this.ai = this.plugin ? createGoogleGenAI(this.plugin, config.apiKey) : new GoogleGenAI({ apiKey: config.apiKey });
	}

	/**
	 * Whether this client routes through the GA Interactions API. Reads the
	 * per-client config first (set by the factory), falling back to live plugin
	 * settings for `createCustom` callers that don't thread the flag through.
	 */
	private get useInteractions(): boolean {
		return this.config.useInteractionsApi ?? this.plugin?.settings?.useInteractionsApi ?? false;
	}

	/**
	 * Generate a non-streaming response
	 */
	async generateModelResponse(request: BaseModelRequest | ExtendedModelRequest): Promise<ModelResponse> {
		if (this.useInteractions) {
			return this.generateViaInteractions(request);
		}

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
	 * Route the Interactions (Next-Gen) client through Obsidian's requestUrl so its
	 * requests bypass renderer CORS — the SDK otherwise uses the global fetch,
	 * whose preflight to the Interactions endpoint fails in Obsidian (see #1023).
	 */
	private ensureInteractionsFetch(): void {
		if (!installObsidianFetch(this.ai)) {
			this.plugin?.logger.warn(
				'[GeminiClient] Could not route Interactions client through Obsidian requestUrl; requests may fail due to CORS.'
			);
		}
	}

	/**
	 * Non-streaming generation via the Interactions API (stateless transport).
	 */
	private async generateViaInteractions(request: BaseModelRequest | ExtendedModelRequest): Promise<ModelResponse> {
		const params = await this.buildInteractionParams(request);
		this.ensureInteractionsFetch();

		try {
			const interaction = await (this.ai as any).interactions.create(params);
			return extractModelResponseFromInteraction(interaction);
		} catch (error) {
			this.plugin?.logger.error('[GeminiClient] Error creating interaction:', error);
			throw error;
		}
	}

	/**
	 * Streaming generation via the Interactions API. Consumes the step-based SSE
	 * stream (`stream: true`) through an InteractionStreamAccumulator, emitting
	 * text/reasoning chunks as they arrive and returning the assembled response
	 * (text, thoughts, tool calls, usage) on completion. Cancellation stops
	 * consuming and returns whatever has accumulated so far.
	 */
	private streamViaInteractions(
		request: BaseModelRequest | ExtendedModelRequest,
		onChunk: StreamCallback
	): StreamingModelResponse {
		let cancelled = false;
		const accumulator = new InteractionStreamAccumulator();

		const complete = (async (): Promise<ModelResponse> => {
			const params = await this.buildInteractionParams(request);
			params.stream = true;
			this.ensureInteractionsFetch();

			try {
				const stream = await (this.ai as any).interactions.create(params);
				for await (const event of stream) {
					if (cancelled) break;
					const chunk = accumulator.handleEvent(event);
					if (chunk && (chunk.text || chunk.thought)) {
						onChunk(chunk);
					}
				}
				return accumulator.finalize();
			} catch (error) {
				if (cancelled) {
					return accumulator.finalize();
				}
				this.plugin?.logger.error('[GeminiClient] Error streaming interaction:', error);
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
	 * Build Interactions `create` params from our request format, mirroring
	 * `buildGenerateContentParams` but emitting the snake_case Interactions
	 * surface. Stateless: full history is replayed in `input` and `store` is
	 * false, so no `previous_interaction_id` is used.
	 */
	private async buildInteractionParams(
		request: BaseModelRequest | ExtendedModelRequest
	): Promise<Record<string, unknown>> {
		const isExtended = isExtendedRequest(request);
		const model = request.model || this.config.model || getDefaultModelForRole('chat');

		const generationConfig: Record<string, unknown> = {
			temperature: request.temperature ?? this.config.temperature,
			top_p: request.topP ?? this.config.topP,
			...(this.config.maxOutputTokens && { max_output_tokens: this.config.maxOutputTokens }),
		};
		// Interactions uses lowercase thinking levels; reuse the per-use-case map.
		if (this.supportsThinking(model)) {
			generationConfig.thinking_level =
				THINKING_LEVEL_BY_USE_CASE[this.config.useCase ?? ModelUseCase.CHAT].toLowerCase();
			generationConfig.thinking_summaries = 'auto';
		}

		const params: Record<string, unknown> = {
			model,
			store: false,
			generation_config: generationConfig,
		};

		if (!isExtended) {
			// One-shot request: the prompt is the entire input.
			params.input = request.prompt || '';
			return params;
		}

		const systemInstruction = await this.prompts.buildExtendedSystemInstruction(request);
		if (systemInstruction) params.system_instruction = systemInstruction;

		if (request.availableTools?.length) {
			params.tools = toolsToInteractionTools(request.availableTools);
		}

		const input = this.buildInteractionInput(request);
		params.input = input.length > 0 ? input : request.userMessage || '';
		return params;
	}

	/**
	 * Build the Interactions `input` step array: replayed history followed by the
	 * current user turn (message + per-turn context + inline attachments).
	 */
	private buildInteractionInput(request: ExtendedModelRequest): InteractionStep[] {
		const steps: InteractionStep[] = [];

		for (const entry of request.conversationHistory ?? []) {
			if ('role' in entry && 'parts' in entry) {
				steps.push(...contentToSteps(entry as Content));
			} else if ('role' in entry && 'text' in entry) {
				const legacy = entry as Content & { text: string };
				steps.push(
					...contentToSteps({ role: legacy.role === 'user' ? 'user' : 'model', parts: [{ text: legacy.text }] })
				);
			} else if ('role' in entry && 'message' in entry) {
				const legacy = entry as Content & { role: string; message: string };
				steps.push(
					...contentToSteps({ role: legacy.role === 'user' ? 'user' : 'model', parts: [{ text: legacy.message }] })
				);
			}
		}

		const attachments = [...(request.inlineAttachments || []), ...(request.imageAttachments || [])];
		const userStep = buildUserInputStep(request.userMessage, request.perTurnContext, attachments);
		if (userStep) steps.push(userStep);

		return steps;
	}

	/**
	 * Generate a streaming response
	 */
	generateStreamingResponse(
		request: BaseModelRequest | ExtendedModelRequest,
		onChunk: StreamCallback
	): StreamingModelResponse {
		if (this.useInteractions) {
			return this.streamViaInteractions(request, onChunk);
		}

		let cancelled = false;
		let accumulatedText = '';
		let accumulatedRendered = '';
		let accumulatedThoughts = '';
		let toolCalls: ToolCall[] | undefined;
		let lastUsageMetadata: GenerateContentResponseUsageMetadata | undefined = undefined;

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

					// Accumulate tool calls across chunks, preserving thought signatures.
					// The model may stream different tool calls in separate chunks, or
					// repeat the same calls with/without signatures in later chunks.
					// Match by id when available (supports parallel calls to the same tool),
					// fall back to name matching for older API versions without ids.
					const chunkToolCalls = this.extractToolCallsFromChunk(chunk);
					if (chunkToolCalls?.length) {
						if (!toolCalls) {
							toolCalls = chunkToolCalls;
						} else {
							for (const newCall of chunkToolCalls) {
								const existing = newCall.id
									? toolCalls.find((tc) => tc.id === newCall.id)
									: toolCalls.find((tc) => tc.name === newCall.name);
								if (!existing) {
									toolCalls.push(newCall);
								} else if (!existing.thoughtSignature && newCall.thoughtSignature) {
									existing.thoughtSignature = newCall.thoughtSignature;
								}
							}
						}
					}

					// Extract search grounding (rendered HTML)
					const rendered = this.extractRenderedFromChunk(chunk);
					if (rendered) {
						accumulatedRendered += rendered;
					}

					// Capture usageMetadata from chunks (usually present in last chunk)
					if (chunk.usageMetadata) {
						lastUsageMetadata = chunk.usageMetadata;
						this.plugin?.logger.debug(
							`[GeminiClient] Captured usageMetadata from streaming chunk: ` +
								`prompt=${chunk.usageMetadata.promptTokenCount}, ` +
								`total=${chunk.usageMetadata.totalTokenCount}, ` +
								`cached=${chunk.usageMetadata.cachedContentTokenCount ?? 0}`
						);
					}
				}

				if (!lastUsageMetadata) {
					this.plugin?.logger.debug('[GeminiClient] No usageMetadata received from any streaming chunk');
				}

				return {
					markdown: accumulatedText,
					rendered: accumulatedRendered,
					...(accumulatedThoughts && { thoughts: accumulatedThoughts }),
					...(toolCalls && { toolCalls }),
					...(lastUsageMetadata && { usageMetadata: lastUsageMetadata }),
				};
			} catch (error) {
				if (cancelled) {
					return {
						markdown: accumulatedText,
						rendered: accumulatedRendered,
						...(accumulatedThoughts && { thoughts: accumulatedThoughts }),
						...(toolCalls && { toolCalls }),
						...(lastUsageMetadata && { usageMetadata: lastUsageMetadata }),
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
		const isExtended = isExtendedRequest(request);
		const model = request.model || this.config.model || getDefaultModelForRole('chat');

		// Build system instruction
		let systemInstruction = '';
		if (isExtended) {
			// Build layered system prompt: identity → vault context → project →
			// agent rules → tool catalog → custom instructions → per-turn context
			systemInstruction = await this.prompts.buildExtendedSystemInstruction(request);
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

		// Add thinking config if model supports it. We steer reasoning depth with
		// `thinkingLevel` (Gemini 3.x) per use case — never the legacy
		// `thinkingBudget`, and never both knobs in one request. `includeThoughts`
		// stays true so reasoning persistence (#965) keeps receiving thought parts.
		if (this.supportsThinking(model)) {
			config.thinkingConfig = {
				includeThoughts: true,
				thinkingLevel: THINKING_LEVEL_BY_USE_CASE[this.config.useCase ?? ModelUseCase.CHAT],
			};
		}

		// Add function calling tools
		const hasTools = isExtended && request.availableTools?.length;
		if (hasTools) {
			const tools = request.availableTools!;
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
		} else if (contents.length === 0 && isExtendedRequest(request)) {
			// For ExtendedModelRequest with no history, create a simple user message
			finalContents = request.userMessage || '';
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
		if (!isExtendedRequest(request)) {
			// BaseModelRequest - just send the prompt as user message
			if (!request.prompt) return [];
			return [
				{
					role: 'user',
					parts: [{ text: request.prompt }],
				},
			];
		}

		const extReq = request;
		const contents: Content[] = [];

		// Add conversation history
		if (extReq.conversationHistory?.length) {
			for (const entry of extReq.conversationHistory) {
				// Support Content format (already has role and parts)
				if ('role' in entry && 'parts' in entry) {
					contents.push(entry);
				}
				// Support our internal format with role and text
				else if ('role' in entry && 'text' in entry) {
					const legacy = entry as Content & { text: string };
					contents.push({
						role: legacy.role === 'user' ? 'user' : 'model',
						parts: [{ text: legacy.text }],
					});
				}
				// Support our internal format with role and message
				else if ('role' in entry && 'message' in entry) {
					const legacy = entry as Content & { role: string; message: string };
					contents.push({
						role: legacy.role === 'user' ? 'user' : 'model',
						parts: [{ text: legacy.message }],
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

		// Add per-turn files and context if present
		if (extReq.perTurnContext && extReq.perTurnContext.trim()) {
			userParts.push({ text: extReq.perTurnContext });
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
			...(response.usageMetadata && {
				usageMetadata: {
					promptTokenCount: response.usageMetadata.promptTokenCount,
					candidatesTokenCount: response.usageMetadata.candidatesTokenCount,
					totalTokenCount: response.usageMetadata.totalTokenCount,
					cachedContentTokenCount: response.usageMetadata.cachedContentTokenCount,
				},
			}),
		};
	}

	/**
	 * Extract text from streaming chunk
	 */
	private extractTextFromChunk(chunk: GenerateContentResponse): string {
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
	private extractThoughtFromChunk(chunk: GenerateContentResponse): string {
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
		const isSupported =
			modelLower.includes('gemini-2.5') || modelLower.includes('gemini-3') || modelLower.includes('thinking-exp');

		if (isSupported) {
			this.plugin?.logger.debug(`[GeminiClient] Enabling thinking mode for model: ${model}`);
		}

		return isSupported;
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
					id: part.functionCall.id,
					thoughtSignature: signature,
				});
			}
		}

		return toolCalls.length > 0 ? toolCalls : undefined;
	}

	/**
	 * Extract tool calls from streaming chunk
	 */
	private extractToolCallsFromChunk(chunk: GenerateContentResponse): ToolCall[] | undefined {
		return this.extractToolCallsFromResponse(chunk);
	}

	/**
	 * Extract rendered HTML from response (search grounding)
	 */
	private extractRenderedFromResponse(response: GenerateContentResponse): string {
		// Search grounding metadata is in groundingMetadata
		const metadata = response.candidates?.[0]?.groundingMetadata;
		if (!metadata) return '';

		// Extract and format grounding sources
		const chunks = metadata.groundingChunks || [];

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
	private extractRenderedFromChunk(chunk: GenerateContentResponse): string {
		return this.extractRenderedFromResponse(chunk);
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
