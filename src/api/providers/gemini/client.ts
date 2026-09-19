/**
 * Simplified Gemini API implementation using js-genai SDK
 *
 * This replaces the complex API abstraction layer with a single,
 * streamlined implementation powered by @google/genai.
 */
import { createGoogleGenAI } from './google-genai-factory';
import { GoogleGenAI, Content, GenerateContentParameters } from '@google/genai';
import type { ThinkingLevel } from '@google/genai';
import {
	ModelApi,
	BaseModelRequest,
	ExtendedModelRequest,
	ModelResponse,
	StreamCallback,
	StreamingModelResponse,
	isExtendedRequest,
} from '../../interfaces/model-api';
import { GeminiPrompts } from '../../../prompts';
import type { ObsidianGemini } from '../../../types/plugin';
import { getDefaultModelForRole, isInteractionsOnlyModel } from '../../../models';
import { normalizeToContent } from '../../../utils/history-normalize';
import { runCancellableStream } from '../../utils/cancellable-stream';
import { t } from '../../../i18n';
import type { GeminiClientConfig } from './config';
import { ModelUseCase } from '../../model-use-case';
import {
	buildUserInputStep,
	contentToSteps,
	extractImageDataFromInteraction,
	extractModelResponseFromInteraction,
	toolsToInteractionTools,
	InteractionStreamAccumulator,
	type InteractionStep,
} from './interactions-mapper';

/**
 * Per-use-case reasoning depth for Gemini 3.x `thinkingConfig.thinkingLevel`
 * on the Interactions API (which accepts `thinking_level` for every
 * thinking-capable model, including Gemini 2.5 — see `supportsThinking`).
 * These are starting points
 * (see #621; tune against the eval suite in #619): latency-sensitive paths
 * think the least, while CHAT — which is the agent loop — thinks the most.
 *
 * | Use case    | level    | why                                            |
 * | ----------- | -------- | ---------------------------------------------- |
 * | Completions | MINIMAL  | latency-sensitive, simple next-token output    |
 * | Summary     | LOW      | bounded, templated output                      |
 * | Rewrite     | LOW      | short, focused edits                           |
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
	[ModelUseCase.CHAT]: 'HIGH',
} as Record<ModelUseCase, ThinkingLevel>;

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
		this.config = config;
		this.plugin = plugin;
		this.prompts = prompts || new GeminiPrompts(plugin);
		this.ai = this.plugin ? createGoogleGenAI(this.plugin, config.apiKey) : new GoogleGenAI({ apiKey: config.apiKey });
	}

	/**
	 * Resolve the effective model for a request: per-request override, then the
	 * client's configured model, then the bundled chat default. Single source of
	 * truth for the routing decision and both param builders.
	 */
	private resolveModel(request: BaseModelRequest | ExtendedModelRequest): string {
		return request.model || this.config.model || getDefaultModelForRole('chat');
	}

	/**
	 * Generate a non-streaming response.
	 *
	 * The conversational transport unconditionally uses the GA Interactions API
	 * as of the settings redesign (the "Use Interactions API" toggle is gone).
	 */
	async generateModelResponse(request: BaseModelRequest | ExtendedModelRequest): Promise<ModelResponse> {
		return this.generateViaInteractions(request);
	}

	/**
	 * Typed accessor for the SDK's experimental Interactions surface. `interactions`
	 * is marked experimental and omitted from `GoogleGenAI`'s public types, so we
	 * narrow the `create` boundary here in one place instead of scattering `as any`.
	 * The return type advertises
	 * both the non-streaming interaction record and the streaming async-iterable
	 * shape; which the SDK actually returns depends on `params.stream`.
	 */
	private get interactionsClient(): {
		create(
			params: Record<string, unknown>,
			options?: { signal?: AbortSignal }
		): Promise<Record<string, unknown> & AsyncIterable<Record<string, unknown>> & { controller?: AbortController }>;
	} {
		return (
			this.ai as unknown as {
				interactions: {
					create(
						params: Record<string, unknown>,
						options?: { signal?: AbortSignal }
					): Promise<
						Record<string, unknown> & AsyncIterable<Record<string, unknown>> & { controller?: AbortController }
					>;
				};
			}
		).interactions;
	}

	/**
	 * Non-streaming generation via the Interactions API (stateless transport).
	 */
	private async generateViaInteractions(request: BaseModelRequest | ExtendedModelRequest): Promise<ModelResponse> {
		const params = await this.buildInteractionParams(request);

		try {
			const interaction = await this.interactionsClient.create(params);
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
		const accumulator = new InteractionStreamAccumulator();
		// Per-call, not an instance field: two overlapping calls on the same
		// client must not be able to cancel each other's stream.
		let activeStream: { controller?: AbortController } | undefined;
		const abortActiveStream = () => {
			try {
				activeStream?.controller?.abort();
			} catch {
				// Best-effort: an SDK stream without a controller still stops via the flag.
			}
		};

		// Two cancellation paths, both needed. The signal rides the create
		// request itself (RequestInit `signal` reaches the fetch), so a cancel
		// *while create is pending* stops the HTTP call; the SDK's Stream then
		// exposes its own AbortController, which actively interrupts an
		// in-flight SSE read so cancel() doesn't have to wait for the next
		// frame (or the server) to unblock the `for await`.
		return runCancellableStream<Record<string, unknown>>({
			start: async (signal) => {
				const params = await this.buildInteractionParams(request);
				params.stream = true;
				const stream = await this.interactionsClient.create(params, { signal });
				activeStream = stream;
				// cancel() may have fired while the create was pending — the
				// signal already aborted the request; abort the stream's
				// controller too so a returned-but-unread stream doesn't sit
				// open.
				if (signal.aborted) {
					abortActiveStream();
				}
				return stream;
			},
			onChunk: (event) => {
				const chunk = accumulator.handleEvent(event);
				if (chunk && (chunk.text || chunk.thought)) {
					onChunk(chunk);
				}
			},
			finalize: () => accumulator.finalize(),
			onCancel: abortActiveStream,
			onError: (error) => this.plugin?.logger.error('[GeminiClient] Error streaming interaction:', error),
		});
	}

	/**
	 * Build Interactions `create` params from our request format, emitting the
	 * snake_case Interactions surface. Stateless: full history is replayed in
	 * `input` and `store` is false, so no `previous_interaction_id` is used.
	 */
	private async buildInteractionParams(
		request: BaseModelRequest | ExtendedModelRequest
	): Promise<Record<string, unknown>> {
		const isExtended = isExtendedRequest(request);
		const model = this.resolveModel(request);

		const generationConfig: Record<string, unknown> = {
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
	 * Normalize a conversation-history entry to a `Content`, tolerating two legacy
	 * runtime shapes (`{ role, text }` and `{ role, message }`) alongside the
	 * canonical `{ role, parts }`. Returns null for unrecognized entries.
	 */
	private normalizeHistoryEntry(entry: Content): Content | null {
		return normalizeToContent(entry, (role) => this.coerceHistoryRole(role));
	}

	/**
	 * Map a legacy history role to a Gemini `Content` role. Only `user`/`model`
	 * are valid Content roles; a `system` (or any other unexpected) role is
	 * coerced to `model`, deliberately and with a warning rather than silently,
	 * since replaying it as a model turn is a lossy fallback.
	 */
	private coerceHistoryRole(role: string | undefined): 'user' | 'model' {
		if (role === 'user') return 'user';
		if (role !== 'model') {
			this.plugin?.logger.warn(`Unexpected conversation-history role "${role}", coercing to "model"`);
		}
		return 'model';
	}

	/**
	 * Build the Interactions `input` step array: replayed history followed by the
	 * current user turn (message + per-turn context + inline attachments).
	 */
	private buildInteractionInput(request: ExtendedModelRequest): InteractionStep[] {
		const steps: InteractionStep[] = [];

		for (const entry of request.conversationHistory ?? []) {
			const content = this.normalizeHistoryEntry(entry);
			if (content) steps.push(...contentToSteps(content));
		}

		const attachments = request.inlineAttachments ?? [];
		const userStep = buildUserInputStep(request.userMessage, request.perTurnContext, attachments);
		if (userStep) steps.push(userStep);

		return steps;
	}

	/**
	 * Generate a streaming response.
	 *
	 * The conversational transport unconditionally uses the GA Interactions API
	 * as of the settings redesign (the "Use Interactions API" toggle is gone).
	 */
	generateStreamingResponse(
		request: BaseModelRequest | ExtendedModelRequest,
		onChunk: StreamCallback
	): StreamingModelResponse {
		return this.streamViaInteractions(request, onChunk);
	}

	/**
	 * Check if a model supports thinking/reasoning mode. Gated on this alone —
	 * unlike `generateContent`, the Interactions API accepts `thinking_level`
	 * for every thinking-capable model (Gemini 2.5, 3.x, thinking-exp) and
	 * normalizes it server-side, so there is no separate "does this model take
	 * the 3.x-only knob" check on this transport.
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
	 * Generate an image from a text prompt.
	 *
	 * Intentionally stays on `generateContent` even though the conversational
	 * transport always uses Interactions (see #1016): image generation is a
	 * distinct one-shot capability on a dedicated image model, and the existing
	 * path is proven across image-tools and scheduled tasks.
	 * The exception is interactions-only image models (e.g.
	 * gemini-omni-flash-preview), which `generateContent` rejects with a 400 —
	 * those route through the Interactions image-output surface.
	 *
	 * @param prompt - Text description of the image to generate
	 * @param model - Image generation model (defaults to gemini-2.5-flash-image-preview)
	 * @returns Base64 encoded image data
	 */
	async generateImage(prompt: string, model: string): Promise<string> {
		if (isInteractionsOnlyModel(model)) {
			return this.generateImageViaInteractions(prompt, model);
		}

		try {
			const params: GenerateContentParameters = {
				model,
				contents: prompt,
				config: {},
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
			throw new Error(t('provider.gemini.noImageData'));
		} catch (error) {
			this.plugin?.logger.error('[GeminiClient] Error generating image:', error);
			throw error;
		}
	}

	/**
	 * Image generation via the Interactions API, for models `generateContent`
	 * refuses to serve. One-shot and stateless like the generateContent path:
	 * the prompt is the whole input, and the base64 image is pulled from the
	 * response's `model_output` steps (via the `output_image` convenience when
	 * the SDK provides it).
	 */
	private async generateImageViaInteractions(prompt: string, model: string): Promise<string> {
		try {
			const interaction = await this.interactionsClient.create({
				model,
				store: false,
				input: prompt,
			});

			const imageData = extractImageDataFromInteraction(interaction);
			if (!imageData) {
				throw new Error(t('provider.gemini.noImageData'));
			}
			return imageData;
		} catch (error) {
			this.plugin?.logger.error('[GeminiClient] Error generating image via interactions:', error);
			throw error;
		}
	}
}
