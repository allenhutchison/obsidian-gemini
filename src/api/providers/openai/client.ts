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
import { walkHistoryEntry } from '../history-walk';
import { runCancellableStream } from '../../utils/cancellable-stream';
import { SIMPLE_TOOL_ID_PATTERN, ToolIdLedger } from '../tool-id-ledger';
import type { ResolvedToolCall } from '../tool-id-ledger';
import { describeSdkApiError } from '../../../utils/error-utils';
import { t } from '../../../i18n';

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
	 * GPT-5.6-family reasoning models: `/v1/chat/completions` rejects function
	 * tools for them unless `reasoning_effort` is 'none'. Matched by id (not
	 * base URL) so the same handling applies when a proxy serves these models.
	 */
	private static readonly GPT56_MODEL_PATTERN = /^gpt-5\.6/;

	private client: OpenAI;
	private config: OpenAIClientConfig;
	private prompts: GeminiPrompts;
	private plugin?: ObsidianGemini;

	constructor(config: OpenAIClientConfig, prompts?: GeminiPrompts, plugin?: ObsidianGemini) {
		this.config = config;
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
			throw new Error(t('provider.openai.noModelSelected'));
		}

		try {
			if (!isExtended) {
				const completion = await this.client.chat.completions.create({
					model,
					messages: [{ role: 'user', content: request.prompt }],
					stream: false,
				});
				return this.toModelResponse(completion);
			}

			const { messages, tools } = await this.buildChatRequest(request);
			const completion = await this.client.chat.completions.create({
				model,
				messages,
				stream: false,
				...this.toolParams(model, tools),
			});
			return this.toModelResponse(completion);
		} catch (error) {
			this.plugin?.logger.error('[OpenAIClient] Error generating content:', describeSdkApiError(error), error);
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

		const state = {
			accumulatedText: '',
			accumulatedThoughts: '',
			toolCallAccumulators: new Map<number, StreamingToolCallAccumulator>(),
			usage: undefined as OpenAI.CompletionUsage | undefined,
		};

		const finalize = (): ModelResponse => {
			const toolCalls = this.finalizeToolCalls(state.toolCallAccumulators);
			const usageMetadata = this.toUsageMetadata(state.usage);
			return {
				markdown: state.accumulatedText,
				rendered: '',
				...(state.accumulatedThoughts && { thoughts: state.accumulatedThoughts }),
				...(toolCalls && toolCalls.length && { toolCalls }),
				...(usageMetadata && { usageMetadata }),
			};
		};

		// Signal-first: the helper's controller exists before `start` runs, and
		// the signal is threaded into the request options, so aborting it is
		// safe at any point — before, during, or after the awaits. (Transports
		// without signal support need the post-`start` re-check Ollama has.)
		return runCancellableStream<OpenAI.ChatCompletionChunk>({
			start: async (signal) => {
				if (!model) {
					throw new Error(t('provider.openai.noModelSelected'));
				}
				if (!isExtended) {
					return this.client.chat.completions.create(
						{
							model,
							messages: [{ role: 'user', content: request.prompt }],
							stream: true,
							// Servers that ignore this option simply omit `usage` on chunks;
							// toUsageMetadata() tolerates that by returning undefined.
							stream_options: { include_usage: true },
						},
						{ signal }
					);
				}
				const { messages, tools } = await this.buildChatRequest(request);
				return this.client.chat.completions.create(
					{
						model,
						messages,
						stream: true,
						stream_options: { include_usage: true },
						...this.toolParams(model, tools),
					},
					{ signal }
				);
			},
			onChunk: (chunk) => {
				this.accumulateStreamChunk(
					chunk,
					state.toolCallAccumulators,
					(text) => {
						state.accumulatedText += text;
						onChunk({ text });
					},
					(thought) => {
						state.accumulatedThoughts += thought;
						onChunk({ text: '', thought });
					}
				);
				if (chunk.usage) {
					state.usage = chunk.usage;
				}
			},
			finalize: () => finalize(),
			onError: (error) =>
				this.plugin?.logger.error('[OpenAIClient] Streaming error:', describeSdkApiError(error), error),
		});
	}

	/** Whether `model` is a GPT-5.6-family reasoning model. */
	private isGpt56Model(model: string): boolean {
		return OpenAIClient.GPT56_MODEL_PATTERN.test(model);
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
		const systemInstruction = await this.prompts.buildExtendedSystemInstruction(request);
		const messages: ChatMessage[] = [];

		if (systemInstruction) {
			messages.push({ role: 'system', content: systemInstruction });
		}

		// Convert conversation history. Entries may be in Gemini Content shape
		// (role + parts[]) or our internal {role, message|text} shape. We flatten
		// function-call / function-response parts into OpenAI's `tool_calls` /
		// tool-role messages. `ledger` pairs functionCall parts with their
		// functionResponse parts across adjacent Contents — see tool-id-ledger.ts.
		const ledger = new ToolIdLedger({
			mint: (name, seq) => `call_${name}_${seq}`,
			isValidId: (id) => SIMPLE_TOOL_ID_PATTERN.test(id),
		});
		for (const entry of request.conversationHistory ?? []) {
			const converted = this.convertHistoryEntry(entry, ledger);
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
				throw new Error(t('provider.unsupportedAttachment', { provider: 'OpenAI', mimeType: att.mimeType }));
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

	private toImageContentPart(att: InlineDataPart): ImageContentPart {
		return { type: 'image_url', image_url: { url: `data:${att.mimeType};base64,${att.base64}` } };
	}

	/**
	 * Convert one history entry (Gemini `Content` shape or the legacy internal
	 * `{role, text|message}` shape) into zero or more OpenAI chat messages.
	 *
	 * Id resolution and call/response pairing are delegated to the shared
	 * `ToolIdLedger` (see `tool-id-ledger.ts`); only the emission —
	 * `tool_call_id`, `tool_calls`, tool-role messages — is OpenAI-specific
	 * here. This method keeps the provider-specific orphan-drop log line.
	 */
	private convertHistoryEntry(entry: unknown, ledger: ToolIdLedger): ChatMessage[] | null {
		const walked = walkHistoryEntry(entry, 'OpenAI');
		if (!walked) return null;

		const { calls: resolvedCalls, responses: resolvedResponses } = ledger.resolveEntry(
			walked.toolCalls,
			walked.toolResponses
		);

		const out: ChatMessage[] = [];

		// Assistant turn first (text + tool calls together): the API requires
		// the assistant message declaring `tool_calls` to precede the tool-role
		// messages that answer it.
		if (walked.role === 'assistant' && (walked.hasText || resolvedCalls.length)) {
			const message: OpenAI.ChatCompletionAssistantMessageParam = {
				role: 'assistant',
				content: walked.text || null,
			};
			if (resolvedCalls.length) {
				message.tool_calls = resolvedCalls.map((tc: ResolvedToolCall) => ({
					id: tc.id,
					type: 'function' as const,
					function: { name: tc.name, arguments: JSON.stringify(tc.args) },
				}));
			}
			out.push(message);
		}

		// Tool responses become tool-role messages. Don't coalesce `null` to
		// `{}` — an explicit null response carries different meaning ("no
		// result") than an empty object, and JSON.stringify(null) === "null"
		// is the correct serialization to preserve that. Responses whose call
		// was never declared (trimmed by compaction) are dropped — the API
		// rejects a `tool` message with an unknown `tool_call_id`.
		for (const tr of resolvedResponses) {
			if (tr.id === null) {
				this.plugin?.logger?.log('OpenAI history: dropping orphaned tool response', tr.name);
				continue;
			}
			const responseText = typeof tr.response === 'string' ? tr.response : JSON.stringify(tr.response);
			out.push({ role: 'tool', tool_call_id: tr.id, content: responseText });
		}

		if (walked.role !== 'assistant' && (walked.hasText || walked.images.length)) {
			const text = walked.text;
			if (walked.role === 'user' && walked.images.length) {
				const content: (TextContentPart | ImageContentPart)[] = [];
				if (text) content.push({ type: 'text', text });
				content.push(...walked.images.map((image) => this.toImageContentPart(image)));
				out.push({ role: 'user', content });
			} else {
				out.push({ role: walked.role, content: text });
			}
		}

		return out.length ? out : null;
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
