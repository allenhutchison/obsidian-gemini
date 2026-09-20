/**
 * Anthropic (Claude) implementation of the ModelApi interface.
 *
 * Targets the Messages API through the official `@anthropic-ai/sdk`. Requests
 * go through the SDK's beta namespace only so that Opus 5 / Fable 5.1 can opt
 * into server-side refusal fallbacks (`fallbacks: 'default'`); every other
 * field is the stable Messages surface. The SDK is constructed with
 * `maxRetries: 0` because the plugin wraps every client in its own
 * `RetryDecorator`, and with `dangerouslyAllowBrowser` because Obsidian runs
 * the plugin in a renderer process (the SDK then sends the direct-browser-access
 * header the API requires for CORS).
 *
 * Scope:
 *  - chat + tool calling for ExtendedModelRequest, streaming and not
 *  - one-shot completion for BaseModelRequest (summary / completions / rewrite)
 *  - adaptive thinking with summarized display -> thoughts, on models that
 *    support it (see `model-catalog.ts`); thinking blocks are replayed across a
 *    tool round via `thinking-replay.ts`
 *  - image and PDF attachments, in the current turn and in history
 *  - usageMetadata from `usage`, including prompt-cache reads
 *  - top-level automatic prompt caching
 *
 * Out of scope: server tools (web search/fetch — the webSearch feature is
 * Gemini-bound), audio/video input, and search grounding HTML.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { BetaMessageStream } from '@anthropic-ai/sdk/lib/BetaMessageStream';
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
import { runCancellableStream } from '../../utils/cancellable-stream';
import { GeminiPrompts } from '../../../prompts';
import type { ObsidianGemini } from '../../../types/plugin';
import type { AnthropicClientConfig } from './config';
import { anthropicModelMetadata } from './model-catalog';
import { decodeThinkingBlocks, encodeThinkingBlocks } from './thinking-replay';
import { walkHistoryEntry } from '../history-walk';
import { SIMPLE_TOOL_ID_PATTERN, ToolIdLedger } from '../tool-id-ledger';
import { describeSdkApiError } from '../../../utils/error-utils';
import { t } from '../../../i18n';

type MessageParam = Anthropic.Beta.BetaMessageParam;
type ContentBlockParam = Anthropic.Beta.BetaContentBlockParam;
type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type BetaMessage = Anthropic.Beta.BetaMessage;

/** Output ceiling for non-streaming requests — keeps them well inside the SDK's HTTP timeout. */
const MAX_TOKENS_NON_STREAMING = 16_000;
/** Output ceiling for streaming requests, which have no timeout concern. */
const MAX_TOKENS_STREAMING = 64_000;
/** Beta that enables `fallbacks: 'default'` (route a refused request to a fallback model server-side). */
const SERVER_SIDE_FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export class AnthropicClient implements ModelApi {
	private client: Anthropic;
	private config: AnthropicClientConfig;
	private prompts: GeminiPrompts;
	private plugin?: ObsidianGemini;

	constructor(config: AnthropicClientConfig, prompts?: GeminiPrompts, plugin?: ObsidianGemini) {
		this.config = config;
		this.plugin = plugin;
		this.prompts = prompts || new GeminiPrompts(plugin);
		this.client = new Anthropic({
			apiKey: this.config.apiKey,
			dangerouslyAllowBrowser: true,
			maxRetries: 0,
		});
	}

	async generateModelResponse(request: BaseModelRequest | ExtendedModelRequest): Promise<ModelResponse> {
		// The factory always populates `config.model` for the use case; there is
		// deliberately no chat-default fallback here (see OpenAIClient).
		const model = request.model || this.config.model;
		if (!model) {
			throw new Error(t('provider.anthropic.noModelSelected'));
		}

		try {
			const params = await this.buildParams(model, request, MAX_TOKENS_NON_STREAMING);
			const message = await this.client.beta.messages.create({ ...params, stream: false });
			return this.toModelResponse(message);
		} catch (error) {
			this.plugin?.logger.error('[AnthropicClient] Error generating content:', describeSdkApiError(error), error);
			throw error;
		}
	}

	generateStreamingResponse(
		request: BaseModelRequest | ExtendedModelRequest,
		onChunk: StreamCallback
	): StreamingModelResponse {
		const model = request.model || this.config.model;
		let accumulatedText = '';
		let accumulatedThoughts = '';
		// `start` receives the helper's signal and returns the SDK stream; both
		// are captured for `finalize`, which runs after the loop exits and
		// needs to branch on the signal and read the aggregate message.
		let signal!: AbortSignal;
		let stream: BetaMessageStream;
		// The SDK aggregates the authoritative message (tool calls, usage) and
		// only exposes it after the iterable ends, so the success arm awaits
		// `finalMessage()` while the cancelled arm returns the local partial.
		// The branch lives inside the single `finalize`, keyed on the signal —
		// `cancel()` aborts the controller and sets the flag together, so the
		// signal is authoritative (the same reading the Gemini and Ollama
		// clients make inside their `start`).
		return runCancellableStream<BetaRawMessageStreamEvent>({
			start: async (helperSignal) => {
				signal = helperSignal;
				if (!model) {
					throw new Error(t('provider.anthropic.noModelSelected'));
				}
				const params = await this.buildParams(model, request, MAX_TOKENS_STREAMING);
				stream = this.client.beta.messages.stream(params, { signal });
				return stream;
			},
			onChunk: (event) => {
				if (event.type !== 'content_block_delta') return;
				if (event.delta.type === 'text_delta') {
					accumulatedText += event.delta.text;
					onChunk({ text: event.delta.text });
				} else if (event.delta.type === 'thinking_delta') {
					accumulatedThoughts += event.delta.thinking;
					onChunk({ text: '', thought: event.delta.thinking });
				}
			},
			finalize: async () => {
				if (signal.aborted) {
					return {
						markdown: accumulatedText,
						rendered: '',
						...(accumulatedThoughts && { thoughts: accumulatedThoughts }),
					};
				}
				return this.toModelResponse(await stream.finalMessage());
			},
			onError: (error) =>
				this.plugin?.logger.error('[AnthropicClient] Streaming error:', describeSdkApiError(error), error),
		});
	}

	/** Request body shared by the streaming and non-streaming paths. */
	private async buildParams(
		model: string,
		request: BaseModelRequest | ExtendedModelRequest,
		maxTokens: number
	): Promise<CreateParams> {
		const meta = anthropicModelMetadata(model);
		const params: CreateParams = {
			model,
			max_tokens: maxTokens,
			messages: [],
			// Automatic caching: the API places the breakpoint on the last
			// cacheable block, so the stable system prompt + history prefix is
			// reused across tool-loop iterations and follow-up turns.
			cache_control: { type: 'ephemeral' },
			...(meta.adaptiveThinking && { thinking: { type: 'adaptive', display: 'summarized' } }),
			...(meta.refusalFallback && { betas: [SERVER_SIDE_FALLBACK_BETA], fallbacks: 'default' }),
		};

		if (!isExtendedRequest(request)) {
			params.messages = [{ role: 'user', content: request.prompt }];
			return params;
		}

		const systemInstruction = await this.prompts.buildExtendedSystemInstruction(request);
		if (systemInstruction) {
			params.system = systemInstruction;
		}
		params.messages = this.buildMessages(request);
		if (request.availableTools?.length) {
			params.tools = this.toAnthropicTools(request.availableTools);
		}
		return params;
	}

	private buildMessages(request: ExtendedModelRequest): MessageParam[] {
		const messages: MessageParam[] = [];
		const ledger = new ToolIdLedger({
			mint: (_name, seq) => `toolu_${seq}`,
			isValidId: (id) => SIMPLE_TOOL_ID_PATTERN.test(id),
		});
		for (const entry of request.conversationHistory ?? []) {
			const converted = this.convertHistoryEntry(entry, ledger);
			if (converted) messages.push(converted);
		}

		// Final user turn: attachments before text, as the API recommends.
		const content: ContentBlockParam[] = (request.inlineAttachments ?? []).map((att) => {
			if (!att.mimeType.startsWith('image/') && att.mimeType !== 'application/pdf') {
				throw new Error(t('provider.unsupportedAttachmentPdf', { provider: 'Anthropic', mimeType: att.mimeType }));
			}
			return this.toAttachmentBlock(att);
		});
		for (const text of [request.userMessage, request.perTurnContext]) {
			if (text && text.trim()) content.push({ type: 'text', text });
		}
		if (content.length) {
			messages.push({ role: 'user', content });
		}

		// The API requires the conversation to open with a user turn. A history
		// that starts mid-exchange (e.g. trimmed by compaction) gets a minimal
		// placeholder rather than a 400.
		if (messages.length && messages[0].role !== 'user') {
			messages.unshift({ role: 'user', content: '(Earlier conversation omitted.)' });
		}
		return messages;
	}

	private toAttachmentBlock(att: InlineDataPart): ContentBlockParam {
		if (att.mimeType === 'application/pdf') {
			return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: att.base64 } };
		}
		return {
			type: 'image',
			source: {
				type: 'base64',
				media_type: att.mimeType as Anthropic.Beta.BetaBase64ImageSource['media_type'],
				data: att.base64,
			},
		};
	}

	/**
	 * Convert one history entry (Gemini `Content` or the legacy internal shape)
	 * into a single Anthropic message.
	 *
	 * An assistant turn carries its replayed thinking blocks first, then text,
	 * then `tool_use` blocks. A user turn carries `tool_result` blocks first —
	 * the API requires them to lead the message that answers a tool round —
	 * then attachments, then text. A `system` entry has no in-history
	 * equivalent that every Claude model accepts, so it is sent as user text.
	 */
	private convertHistoryEntry(entry: unknown, ledger: ToolIdLedger): MessageParam | null {
		const walked = walkHistoryEntry(entry, 'Anthropic', { acceptsPdf: true });
		if (!walked) return null;

		const { calls, responses } = ledger.resolveEntry(walked.toolCalls, walked.toolResponses);

		const content: ContentBlockParam[] = [];
		if (walked.role === 'assistant') {
			const thoughtSignature = calls.find((call) => call.thoughtSignature)?.thoughtSignature;
			content.push(...decodeThinkingBlocks(thoughtSignature));
			if (walked.text) content.push({ type: 'text', text: walked.text });
			for (const call of calls) {
				content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.args });
			}
			return content.length ? { role: 'assistant', content } : null;
		}

		for (const response of responses) {
			if (response.id === null) {
				// Its tool_use was trimmed by history compaction; the API rejects a
				// tool_result with no matching tool_use.
				this.plugin?.logger?.log('Anthropic history: dropping orphaned tool result for', response.name);
				continue;
			}
			const failed = !!response.response && (response.response as { success?: unknown }).success === false;
			content.push({
				type: 'tool_result',
				tool_use_id: response.id,
				content: typeof response.response === 'string' ? response.response : JSON.stringify(response.response),
				...(failed && { is_error: true }),
			});
		}
		content.push(...[...walked.images, ...walked.documents].map((att) => this.toAttachmentBlock(att)));
		if (walked.text) content.push({ type: 'text', text: walked.text });
		return content.length ? { role: 'user', content } : null;
	}

	private toAnthropicTools(tools: ToolDefinition[]): Anthropic.Beta.BetaTool[] {
		return tools.map((tool) => ({
			name: tool.name,
			description: tool.description,
			input_schema: {
				type: 'object' as const,
				properties: tool.parameters.properties ?? {},
				required: tool.parameters.required ?? [],
			},
		}));
	}

	private toModelResponse(message: BetaMessage): ModelResponse {
		if (message.stop_reason === 'refusal') {
			const category = message.stop_details?.category;
			throw new Error(`Claude declined to respond to this request${category ? ` (${category})` : ''}.`);
		}

		let markdown = '';
		let thoughts = '';
		let toolCalls: ToolCall[] = [];
		for (const block of message.content) {
			if (block.type === 'text') {
				markdown += block.text;
			} else if (block.type === 'thinking') {
				thoughts += block.thinking;
			} else if (block.type === 'tool_use') {
				toolCalls.push({ id: block.id, name: block.name, arguments: this.toolInput(block.input) });
			}
		}

		if (toolCalls.length && message.stop_reason === 'max_tokens') {
			// The last tool_use may be cut off mid-input; running it would act on
			// truncated arguments.
			this.plugin?.logger.warn('[AnthropicClient] Response hit max_tokens mid tool call; dropping tool calls');
			toolCalls = [];
		}
		const thoughtSignature = toolCalls.length ? encodeThinkingBlocks(message.content) : undefined;
		if (thoughtSignature) {
			toolCalls[0] = { ...toolCalls[0], thoughtSignature };
		}

		const usage = message.usage;
		const cacheRead = usage.cache_read_input_tokens ?? 0;
		const promptTokenCount = usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + cacheRead;
		return {
			markdown,
			rendered: '',
			...(thoughts && { thoughts }),
			...(toolCalls.length && { toolCalls }),
			usageMetadata: {
				promptTokenCount,
				candidatesTokenCount: usage.output_tokens,
				totalTokenCount: promptTokenCount + usage.output_tokens,
				...(cacheRead > 0 && { cachedContentTokenCount: cacheRead }),
			},
		};
	}

	private toolInput(input: unknown): Record<string, unknown> {
		if (input && typeof input === 'object' && !Array.isArray(input)) {
			return input as Record<string, unknown>;
		}
		this.plugin?.logger.warn('[AnthropicClient] Ignoring non-object tool input:', input);
		return {};
	}
}
