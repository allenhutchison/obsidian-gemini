/**
 * OpenAI API implementation of the ModelApi interface.
 *
 * Targets the Chat Completions endpoint (`/v1/chat/completions`) via the
 * official `openai` npm SDK rather than the newer Responses API, so this
 * client also works unmodified against OpenAI-compatible local servers
 * (LM Studio, MLX, Ollama's OpenAI-compatible endpoint) that only implement
 * Chat Completions. The SDK is constructed with `maxRetries: 0` because the
 * plugin already wraps every client in its own `RetryDecorator`.
 *
 * Phase 1 scope:
 *  - chat + tool calling for ExtendedModelRequest
 *  - one-shot chat completion for BaseModelRequest (summary / completions / rewrite)
 *  - streaming chat with cancellation via AbortController
 *  - image attachments as `image_url` content parts (vision-capable models only)
 *  - usageMetadata derived from `usage.prompt_tokens` / `usage.completion_tokens`
 *  - `reasoning_content` -> thoughts, for OpenAI-compatible servers that return
 *    it (not part of the official OpenAI API surface; read via a narrow local
 *    type rather than widening the SDK's own types)
 *
 * Out of scope (no Chat Completions equivalent, or deferred to a later phase):
 *  - cachedContentTokenCount (not exposed on CompletionUsage)
 *  - search grounding / rendered HTML (Gemini-only)
 *  - thoughtSignature / thought part fields (Gemini's thinking-mode replay markers)
 *  - non-image inline attachments (audio/video/pdf) — this client only supports
 *    image vision input, matching the OpenAI-compatible servers it targets
 */

import OpenAI from 'openai';
import {
	ModelApi,
	BaseModelRequest,
	ExtendedModelRequest,
	ModelResponse,
	ToolCall,
	ToolDefinition,
	StreamCallback,
	StreamingModelResponse,
	InlineDataPart,
	isExtendedRequest,
} from '../../interfaces/model-api';
import { GeminiPrompts } from '../../../prompts';
import type { ObsidianGemini } from '../../../types/plugin';
import type { OpenAIClientConfig } from './config';
import { getLegacyEntryText } from '../../../utils/history-normalize';

type ChatMessage = OpenAI.ChatCompletionMessageParam;
type ChatTool = OpenAI.ChatCompletionTool;
type ImageContentPart = OpenAI.ChatCompletionContentPartImage;
type TextContentPart = OpenAI.ChatCompletionContentPartText;

/**
 * Some OpenAI-compatible servers (e.g. reasoning-capable local models served
 * through LM Studio/Ollama) return a non-standard `reasoning_content` field
 * on the assistant message / streaming delta. The official SDK types don't
 * declare it, so these local types widen just enough to read it without an
 * `any` cast at every call site.
 */
type MessageWithReasoning = OpenAI.ChatCompletionMessage & { reasoning_content?: string | null };
type DeltaWithReasoning = OpenAI.ChatCompletionChunk.Choice.Delta & { reasoning_content?: string | null };

/** Accumulator for one in-progress tool call across streaming deltas, keyed by `index`. */
interface StreamingToolCallAccumulator {
	id?: string;
	name?: string;
	arguments: string;
}

export class OpenAIClient implements ModelApi {
	/**
	 * GPT-5.6-family reasoning models reject any non-default `temperature`/
	 * `top_p`, and `/v1/chat/completions` rejects function tools for them
	 * unless `reasoning_effort` is 'none'. Matched by id (not base URL) so the
	 * same handling applies when a proxy serves these models.
	 */
	private static readonly GPT56_MODEL_PATTERN = /^gpt-5\.6/;

	private client: OpenAI;
	private config: OpenAIClientConfig;
	private prompts: GeminiPrompts;
	private plugin?: ObsidianGemini;

	constructor(config: OpenAIClientConfig, prompts?: GeminiPrompts, plugin?: ObsidianGemini) {
		this.config = {
			temperature: 0.7,
			topP: 1,
			streamingEnabled: true,
			...config,
		};
		this.plugin = plugin;
		this.prompts = prompts || new GeminiPrompts(plugin);
		this.client = new OpenAI({
			apiKey: this.config.apiKey,
			baseURL: this.config.baseUrl,
			dangerouslyAllowBrowser: true,
			maxRetries: 0,
		});
	}

	async generateModelResponse(request: BaseModelRequest | ExtendedModelRequest): Promise<ModelResponse> {
		const isExtended = isExtendedRequest(request);
		// The factory (`ModelClientFactory.resolveModelName`) is the single
		// source of role-aware model resolution and always populates
		// `config.model` per use case (chat / summary / completions / rewrite).
		// We don't fall back to a chat default here — that would silently route
		// e.g. a summary request to the chat model when `config.model` is empty.
		const model = request.model || this.config.model;
		if (!model) {
			throw new Error('No OpenAI model selected. Choose a model in settings.');
		}

		try {
			if (!isExtended) {
				const completion = await this.client.chat.completions.create({
					model,
					messages: [{ role: 'user', content: request.prompt }],
					stream: false,
					...this.samplingParams(model, request),
				});
				return this.toModelResponse(completion);
			}

			const { messages, tools } = await this.buildChatRequest(request);
			const completion = await this.client.chat.completions.create({
				model,
				messages,
				stream: false,
				...this.samplingParams(model, request),
				...this.toolParams(model, tools),
			});
			return this.toModelResponse(completion);
		} catch (error) {
			this.plugin?.logger.error('[OpenAIClient] Error generating content:', this.describeError(error), error);
			throw error;
		}
	}

	generateStreamingResponse(
		request: BaseModelRequest | ExtendedModelRequest,
		onChunk: StreamCallback
	): StreamingModelResponse {
		const isExtended = isExtendedRequest(request);
		// See note in generateModelResponse — the factory provides the
		// role-correct model; no chat-default fallback here.
		const model = request.model || this.config.model;

		let cancelled = false;
		// Unlike Ollama's post-hoc `stream.abort()` (which races cancel() firing
		// before the stream reference is assigned), the signal is threaded into
		// the request from the start, so aborting it is safe to call at any time
		// — before, during, or after the awaits below.
		const controller = new AbortController();
		let accumulatedText = '';
		let accumulatedThoughts = '';
		const toolCallAccumulators = new Map<number, StreamingToolCallAccumulator>();
		let usage: OpenAI.CompletionUsage | undefined;

		const buildResult = (): ModelResponse => {
			const toolCalls = this.finalizeToolCalls(toolCallAccumulators);
			const usageMetadata = this.toUsageMetadata(usage);
			return {
				markdown: accumulatedText,
				rendered: '',
				...(accumulatedThoughts && { thoughts: accumulatedThoughts }),
				...(toolCalls && toolCalls.length && { toolCalls }),
				...(usageMetadata && { usageMetadata }),
			};
		};

		const complete = (async (): Promise<ModelResponse> => {
			if (!model) {
				throw new Error('No OpenAI model selected. Choose a model in settings.');
			}

			try {
				let stream: AsyncIterable<OpenAI.ChatCompletionChunk>;
				if (!isExtended) {
					stream = await this.client.chat.completions.create(
						{
							model,
							messages: [{ role: 'user', content: request.prompt }],
							stream: true,
							// Servers that ignore this option simply omit `usage` on chunks;
							// toUsageMetadata() tolerates that by returning undefined.
							stream_options: { include_usage: true },
							...this.samplingParams(model, request),
						},
						{ signal: controller.signal }
					);
				} else {
					const { messages, tools } = await this.buildChatRequest(request);
					stream = await this.client.chat.completions.create(
						{
							model,
							messages,
							stream: true,
							stream_options: { include_usage: true },
							...this.samplingParams(model, request),
							...this.toolParams(model, tools),
						},
						{ signal: controller.signal }
					);
				}

				// cancel() may have fired while the awaits above were outstanding —
				// abort immediately so the server stops generating.
				if (cancelled) {
					controller.abort();
				}

				for await (const chunk of stream) {
					if (cancelled) break;
					this.accumulateStreamChunk(
						chunk,
						toolCallAccumulators,
						(text) => {
							accumulatedText += text;
							onChunk({ text });
						},
						(thought) => {
							accumulatedThoughts += thought;
							onChunk({ text: '', thought });
						}
					);
					if (chunk.usage) {
						usage = chunk.usage;
					}
				}

				return buildResult();
			} catch (error) {
				if (cancelled) {
					return buildResult();
				}
				this.plugin?.logger.error('[OpenAIClient] Streaming error:', this.describeError(error), error);
				throw error;
			}
		})();

		return {
			complete,
			cancel: () => {
				cancelled = true;
				try {
					controller.abort();
				} catch (err) {
					this.plugin?.logger.debug('[OpenAIClient] Abort failed:', err);
				}
			},
		};
	}

	/**
	 * Flattens an SDK `APIError` into a readable string. The console serializes
	 * an APIError's nested `error` body as the useless `"error":"Object"`, which
	 * hides the one field that identifies the failure — the server's message.
	 * Matched structurally rather than with `instanceof OpenAI.APIError` so the
	 * check doesn't depend on the error carrying that exact class identity.
	 *
	 * Log this *alongside* the original error, never instead of it: for anything
	 * that isn't an API error (a `TypeError` out of `buildChatRequest`, say) the
	 * string is just `error.message` and the stack trace is the useful part.
	 */
	private describeError(error: unknown): string {
		const apiError = error as { status?: number; code?: string | null; error?: { message?: string } } | null;
		if (apiError && typeof apiError === 'object' && typeof apiError.status === 'number') {
			const detail = apiError.error?.message ?? (error instanceof Error ? error.message : undefined) ?? 'unknown error';
			return `HTTP ${apiError.status}${apiError.code ? ` [${apiError.code}]` : ''}: ${detail}`;
		}
		return error instanceof Error ? error.message : String(error);
	}

	/** Whether `model` is a GPT-5.6-family reasoning model. */
	private isGpt56Model(model: string): boolean {
		return OpenAIClient.GPT56_MODEL_PATTERN.test(model);
	}

	/**
	 * Sampling params for a request. GPT-5.6 models accept only the default
	 * temperature/top_p and 400 on anything else, so they're omitted entirely
	 * rather than sent with the configured values.
	 */
	private samplingParams(
		model: string,
		request: BaseModelRequest | ExtendedModelRequest
	): { temperature?: number; top_p?: number } {
		if (this.isGpt56Model(model)) {
			return {};
		}
		return {
			temperature: request.temperature ?? this.config.temperature,
			top_p: request.topP ?? this.config.topP,
		};
	}

	/**
	 * Tool params for a request. `/v1/chat/completions` rejects function tools
	 * for GPT-5.6 models unless reasoning is disabled, so those requests pin
	 * `reasoning_effort: 'none'`. (Tool calling with reasoning would require the
	 * Responses API, which this client deliberately doesn't target — see the
	 * module header.)
	 */
	private toolParams(
		model: string,
		tools?: ChatTool[]
	): { tools?: ChatTool[]; reasoning_effort?: OpenAI.ReasoningEffort } {
		if (!tools || !tools.length) {
			return {};
		}
		return {
			tools,
			...(this.isGpt56Model(model) && { reasoning_effort: 'none' as const }),
		};
	}

	private async buildChatRequest(
		request: ExtendedModelRequest
	): Promise<{ messages: ChatMessage[]; tools?: ChatTool[] }> {
		const systemInstruction = await this.buildSystemInstruction(request);
		const messages: ChatMessage[] = [];

		if (systemInstruction) {
			messages.push({ role: 'system', content: systemInstruction });
		}

		// Convert conversation history. Entries may be in Gemini Content shape
		// (role + parts[]) or our internal {role, message|text} shape. We flatten
		// function-call / function-response parts into OpenAI's `tool_calls` /
		// tool-role messages. `pendingCallIds` pairs functionCall parts with their
		// functionResponse parts across adjacent Contents — see convertHistoryEntry.
		const pendingCallIds = new Map<string, string[]>();
		const declaredCallIds = new Set<string>();
		let toolCallSeq = 0;
		for (const entry of request.conversationHistory ?? []) {
			const converted = this.convertHistoryEntry(entry, pendingCallIds, declaredCallIds, () => toolCallSeq++);
			if (converted) messages.push(...converted);
		}

		// Final user turn
		const userTextParts: string[] = [];
		if (request.userMessage && request.userMessage.trim()) {
			userTextParts.push(request.userMessage);
		}
		if (request.perTurnContext && request.perTurnContext.trim()) {
			userTextParts.push(request.perTurnContext);
		}
		const combinedText = userTextParts.join('\n\n');

		const allAttachments: InlineDataPart[] = request.inlineAttachments ?? [];
		const imageParts: ImageContentPart[] = [];
		for (const att of allAttachments) {
			if (att.mimeType.startsWith('image/')) {
				imageParts.push(this.toImageContentPart(att));
			} else {
				throw new Error(
					`OpenAI only supports image attachments; received ${att.mimeType}. ` +
						`Switch to the Gemini provider for PDF, audio, or video input.`
				);
			}
		}

		if (combinedText || imageParts.length) {
			if (imageParts.length) {
				const content: (TextContentPart | ImageContentPart)[] = [];
				if (combinedText) content.push({ type: 'text', text: combinedText });
				content.push(...imageParts);
				messages.push({ role: 'user', content });
			} else {
				messages.push({ role: 'user', content: combinedText });
			}
		}

		const tools = request.availableTools ? this.toOpenAITools(request.availableTools) : undefined;

		return { messages, ...(tools && tools.length ? { tools } : {}) };
	}

	private async buildSystemInstruction(request: ExtendedModelRequest): Promise<string> {
		return this.prompts.buildExtendedSystemInstruction(request);
	}

	private toImageContentPart(att: InlineDataPart): ImageContentPart {
		return { type: 'image_url', image_url: { url: `data:${att.mimeType};base64,${att.base64}` } };
	}

	/**
	 * Convert one history entry (Gemini `Content` shape or the legacy internal
	 * `{role, text|message}` shape) into zero or more OpenAI chat messages.
	 *
	 * `pendingCallIds` is a FIFO queue per tool name, threaded across the whole
	 * history by the caller: each `functionCall` part pushes the id it was
	 * assigned (its own `id` field if present, else a synthesized
	 * `call_<name>_<seq>`), and each `functionResponse` part without its own
	 * `id` pops the oldest pending id for its name so `tool_call_id` on the
	 * resulting `tool` message lines up with the `id` on the assistant message's
	 * `tool_calls` entry — mirroring Gemini's positional call/response pairing.
	 *
	 * `declaredCallIds` records every id emitted on an assistant `tool_calls`
	 * entry. A `tool` message whose id was never declared (its functionCall was
	 * trimmed away by history compaction) is dropped rather than emitted — the
	 * Chat Completions API rejects the whole request otherwise.
	 */
	private convertHistoryEntry(
		entry: unknown,
		pendingCallIds: Map<string, string[]>,
		declaredCallIds: Set<string>,
		nextSeq: () => number
	): ChatMessage[] | null {
		if (!entry || typeof entry !== 'object') return null;
		const record = entry as Record<string, unknown>;

		// Gemini Content shape: { role: 'user'|'model', parts: Part[] }
		if ('role' in record && Array.isArray(record.parts)) {
			const role = record.role === 'model' ? 'assistant' : record.role === 'system' ? 'system' : 'user';
			const textChunks: string[] = [];
			const imageParts: ImageContentPart[] = [];
			const toolCallParts: { id: string; name: string; arguments: Record<string, unknown> }[] = [];
			const toolResponseParts: { id: string; response: unknown }[] = [];

			for (const rawPart of record.parts) {
				const part = rawPart as {
					text?: unknown;
					inlineData?: { mimeType?: string; data?: string };
					functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
					functionResponse?: { name: string; response?: unknown; id?: string };
				};
				if (typeof part?.text === 'string') {
					textChunks.push(part.text);
				} else if (part?.inlineData?.mimeType?.startsWith('image/') && part.inlineData.data) {
					imageParts.push(
						this.toImageContentPart({ mimeType: part.inlineData.mimeType, base64: part.inlineData.data })
					);
				} else if (part?.inlineData?.mimeType) {
					// Mirror buildChatRequest's current-turn handling so resumed sessions
					// don't silently drop PDF/audio/video context the model never sees.
					throw new Error(
						`OpenAI only supports image attachments; conversation history contains ${part.inlineData.mimeType}. ` +
							`Switch to the Gemini provider for PDF, audio, or video input.`
					);
				} else if (part?.functionCall) {
					const name = part.functionCall.name;
					const id = part.functionCall.id ?? `call_${name}_${nextSeq()}`;
					const queue = pendingCallIds.get(name) ?? [];
					queue.push(id);
					pendingCallIds.set(name, queue);
					toolCallParts.push({ id, name, arguments: part.functionCall.args || {} });
				} else if (part?.functionResponse) {
					const name = part.functionResponse.name;
					const queue = pendingCallIds.get(name);
					const id = part.functionResponse.id ?? queue?.shift() ?? `call_${name}_${nextSeq()}`;
					toolResponseParts.push({ id, response: part.functionResponse.response });
				}
			}

			const out: ChatMessage[] = [];

			// Assistant turn first (text + tool calls together): the API requires
			// the assistant message declaring `tool_calls` to precede the tool-role
			// messages that answer it.
			if (role === 'assistant' && (textChunks.length || toolCallParts.length)) {
				const message: OpenAI.ChatCompletionAssistantMessageParam = {
					role: 'assistant',
					content: textChunks.join('\n').trim() || null,
				};
				if (toolCallParts.length) {
					message.tool_calls = toolCallParts.map((tc) => {
						declaredCallIds.add(tc.id);
						return {
							id: tc.id,
							type: 'function' as const,
							function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
						};
					});
				}
				out.push(message);
			}

			// Tool responses become tool-role messages. Don't coalesce `null` to
			// `{}` — an explicit null response carries different meaning ("no
			// result") than an empty object, and JSON.stringify(null) === "null"
			// is the correct serialization to preserve that. Responses whose call
			// was never declared (trimmed by compaction) are dropped — the API
			// rejects a `tool` message with an unknown `tool_call_id`.
			for (const tr of toolResponseParts) {
				if (!declaredCallIds.has(tr.id)) {
					this.plugin?.logger?.log('OpenAI history: dropping orphaned tool response', tr.id);
					continue;
				}
				const responseText = typeof tr.response === 'string' ? tr.response : JSON.stringify(tr.response);
				out.push({ role: 'tool', tool_call_id: tr.id, content: responseText });
			}

			if (role !== 'assistant' && (textChunks.length || imageParts.length)) {
				const text = textChunks.join('\n\n').trim();
				if (role === 'user' && imageParts.length) {
					const content: (TextContentPart | ImageContentPart)[] = [];
					if (text) content.push({ type: 'text', text });
					content.push(...imageParts);
					out.push({ role: 'user', content });
				} else {
					out.push({ role, content: text });
				}
			}

			return out.length ? out : null;
		}

		// Internal shape: { role, text } or { role, message }
		if ('role' in record) {
			const text = getLegacyEntryText(record);
			if (typeof text !== 'string' || !text.trim()) return null;
			const role = record.role === 'model' || record.role === 'assistant' ? 'assistant' : 'user';
			return [{ role, content: text }];
		}

		return null;
	}

	private toOpenAITools(tools: ToolDefinition[]): ChatTool[] {
		return tools.map((tool) => ({
			type: 'function' as const,
			function: {
				name: tool.name,
				description: tool.description,
				parameters: {
					type: tool.parameters.type ?? 'object',
					properties: tool.parameters.properties ?? {},
					required: tool.parameters.required ?? [],
				},
			},
		}));
	}

	private toModelResponse(completion: OpenAI.ChatCompletion): ModelResponse {
		const message = completion.choices?.[0]?.message as MessageWithReasoning | undefined;
		const toolCalls = this.toolCallsFromMessage(message);
		const usageMetadata = this.toUsageMetadata(completion.usage);
		return {
			markdown: message?.content ?? '',
			rendered: '',
			...(message?.reasoning_content && { thoughts: message.reasoning_content }),
			...(toolCalls && toolCalls.length && { toolCalls }),
			...(usageMetadata && { usageMetadata }),
		};
	}

	private toolCallsFromMessage(message: OpenAI.ChatCompletionMessage | undefined): ToolCall[] | undefined {
		const rawToolCalls = message?.tool_calls;
		if (!rawToolCalls?.length) return undefined;
		const calls = rawToolCalls
			.filter((tc): tc is OpenAI.ChatCompletionMessageFunctionToolCall => tc.type === 'function')
			.map((tc) => ({
				id: tc.id,
				name: tc.function.name,
				arguments: this.parseToolArguments(tc.function.name, tc.function.arguments),
			}));
		return calls.length ? calls : undefined;
	}

	/**
	 * Parse a tool call's JSON-encoded arguments string. The model does not
	 * always emit valid JSON (truncated streaming output, hallucinated
	 * arguments); fall back to an empty object and log rather than let a
	 * malformed tool call crash the whole response.
	 */
	private parseToolArguments(name: string, raw: string): Record<string, unknown> {
		if (!raw) return {};
		try {
			return JSON.parse(raw) as Record<string, unknown>;
		} catch (error) {
			this.plugin?.logger.warn(`[OpenAIClient] Failed to parse tool call arguments for ${name}:`, error);
			return {};
		}
	}

	/**
	 * Accumulate one streaming chunk's delta into the running text/thoughts
	 * (via the provided emitters, which also forward to the caller's onChunk)
	 * and the tool-call accumulator map, keyed by the delta's `index`. Tool
	 * call id/name typically arrive on the first delta for that index;
	 * arguments arrive as accumulating string fragments across many deltas.
	 */
	private accumulateStreamChunk(
		chunk: OpenAI.ChatCompletionChunk,
		toolCallAccumulators: Map<number, StreamingToolCallAccumulator>,
		onText: (text: string) => void,
		onThought: (thought: string) => void
	): void {
		const delta = chunk.choices?.[0]?.delta as DeltaWithReasoning | undefined;
		if (!delta) return;

		if (delta.content) {
			onText(delta.content);
		}
		if (delta.reasoning_content) {
			onThought(delta.reasoning_content);
		}
		if (delta.tool_calls?.length) {
			for (const tc of delta.tool_calls) {
				const existing = toolCallAccumulators.get(tc.index) ?? { arguments: '' };
				if (tc.id) existing.id = tc.id;
				if (tc.function?.name) existing.name = tc.function.name;
				if (tc.function?.arguments) existing.arguments += tc.function.arguments;
				toolCallAccumulators.set(tc.index, existing);
			}
		}
	}

	private finalizeToolCalls(accumulators: Map<number, StreamingToolCallAccumulator>): ToolCall[] | undefined {
		if (!accumulators.size) return undefined;
		const indices = Array.from(accumulators.keys()).sort((a, b) => a - b);
		const calls: ToolCall[] = [];
		for (const index of indices) {
			const acc = accumulators.get(index);
			if (!acc?.name) continue;
			calls.push({
				id: acc.id,
				name: acc.name,
				arguments: this.parseToolArguments(acc.name, acc.arguments),
			});
		}
		return calls.length ? calls : undefined;
	}

	/**
	 * Build a usageMetadata object from OpenAI's `CompletionUsage`. Unlike
	 * Ollama's `prompt_eval_count`/`eval_count` (which can arrive independently),
	 * OpenAI's `usage` is an atomic object present only when the server actually
	 * reports token counts (always on non-streaming responses; only on the final
	 * chunk when `stream_options.include_usage` is honored). Returning
	 * `undefined` when absent preserves the distinction between "unknown" and
	 * "zero tokens" in the token UI and eval reporter.
	 */
	private toUsageMetadata(usage: OpenAI.CompletionUsage | undefined): ModelResponse['usageMetadata'] | undefined {
		if (!usage) return undefined;
		return {
			promptTokenCount: usage.prompt_tokens,
			candidatesTokenCount: usage.completion_tokens,
			totalTokenCount: usage.total_tokens,
		};
	}
}
