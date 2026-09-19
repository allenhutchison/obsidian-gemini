/**
 * Ollama API implementation of the ModelApi interface.
 *
 * Uses ollama-js (via the browser entry point) so it works inside Obsidian's
 * Electron renderer without Node-specific imports. The Ollama daemon runs
 * locally with no auth, so configuration is just the base URL plus model.
 *
 * Phase 1 scope:
 *  - chat + tool calling for ExtendedModelRequest
 *  - generate for BaseModelRequest (summary / completions / rewrite)
 *  - streaming chat with cancellation
 *  - image attachments via the `images` array (vision-capable models only)
 *  - usageMetadata derived from prompt_eval_count / eval_count
 *
 * Out of scope (no Ollama equivalent):
 *  - cachedContentTokenCount (Ollama does not expose cache hits)
 *  - search grounding / rendered HTML (Gemini-only)
 *  - thoughtSignature (used by Gemini's thinking mode for tool-call replay)
 */

import { Ollama, ChatRequest, ChatResponse, Message, Tool } from 'ollama/browser';
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
import type { OllamaClientConfig } from './config';
import { walkHistoryEntry } from '../history-walk';
import { runCancellableStream } from '../../utils/cancellable-stream';
import { t } from '../../../i18n';

export class OllamaClient implements ModelApi {
	private client: Ollama;
	private config: OllamaClientConfig;
	private prompts: GeminiPrompts;
	private plugin?: ObsidianGemini;

	constructor(config: OllamaClientConfig, prompts?: GeminiPrompts, plugin?: ObsidianGemini) {
		this.config = config;
		this.plugin = plugin;
		this.prompts = prompts || new GeminiPrompts(plugin);
		this.client = new Ollama({ host: this.config.baseUrl });
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
			throw new Error('No Ollama model selected. Pull a model with `ollama pull <name>` and choose it in settings.');
		}

		try {
			if (!isExtended) {
				const generateResponse = await this.client.generate({
					model,
					prompt: request.prompt,
					stream: false,
					options: this.buildOptions(),
				});
				const usageMetadata = this.toUsageMetadata(generateResponse.prompt_eval_count, generateResponse.eval_count);
				return {
					markdown: generateResponse.response,
					rendered: '',
					...(usageMetadata && { usageMetadata }),
				};
			}

			const chatRequest = await this.buildChatRequest(request, model, false);
			const response = await this.client.chat(chatRequest as ChatRequest & { stream: false });
			return this.toModelResponse(response);
		} catch (error) {
			this.plugin?.logger.error('[OllamaClient] Error generating content:', error);
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
			toolCalls: undefined as ToolCall[] | undefined,
			promptEvalCount: undefined as number | undefined,
			evalCount: undefined as number | undefined,
		};

		const finalize = (): ModelResponse => {
			const usageMetadata = this.toUsageMetadata(state.promptEvalCount, state.evalCount);
			return {
				markdown: state.accumulatedText,
				rendered: '',
				...(state.accumulatedThoughts && { thoughts: state.accumulatedThoughts }),
				...(state.toolCalls && state.toolCalls.length && { toolCalls: state.toolCalls }),
				...(usageMetadata && { usageMetadata }),
			};
		};

		// The Ollama SDK's requests take no signal; its streams expose abort().
		// The helper's signal covers the lifecycle; `onCancel` and the
		// post-`start` abort inside the callbacks reach the transport, closing
		// the cancel-before-the-stream-reference window the signal-first shape
		// (openai) avoids by construction.
		let activeStream: { abort: () => void } | null = null;

		return runCancellableStream<ChatResponse & { response?: string }>({
			start: async (signal) => {
				if (!model) {
					throw new Error(
						'No Ollama model selected. Pull a model with `ollama pull <name>` and choose it in settings.'
					);
				}
				let stream: AsyncIterable<ChatResponse> & { abort: () => void };
				if (!isExtended) {
					// generate() supports streaming too; route the same way for consistency
					stream = (await this.client.generate({
						model,
						prompt: request.prompt,
						stream: true,
						options: this.buildOptions(),
					})) as AsyncIterable<ChatResponse> & { abort: () => void };
				} else {
					const chatRequest = await this.buildChatRequest(request, model, true);
					stream = (await this.client.chat(
						chatRequest as ChatRequest & { stream: true }
					)) as AsyncIterable<ChatResponse> & { abort: () => void };
				}
				activeStream = stream;
				// cancel() may have fired while the await above was outstanding —
				// abort immediately so the daemon stops generating.
				if (signal.aborted) {
					try {
						stream.abort();
					} catch (err) {
						this.plugin?.logger.debug('[OllamaClient] Abort failed:', err);
					}
				}
				return stream;
			},
			onCancel: () => {
				try {
					activeStream?.abort();
				} catch (err) {
					this.plugin?.logger.debug('[OllamaClient] Abort failed:', err);
				}
			},
			onChunk: (chunk) => {
				if (!isExtended) {
					// generate() chunks carry `.response` (and no message shape).
					if (chunk.response) {
						state.accumulatedText += chunk.response;
						onChunk({ text: chunk.response });
					}
				} else {
					const msg = chunk.message;
					if (msg?.content) {
						state.accumulatedText += msg.content;
						onChunk({ text: msg.content });
					}
					if (msg?.thinking) {
						state.accumulatedThoughts += msg.thinking;
						onChunk({ text: '', thought: msg.thinking });
					}
					if (msg?.tool_calls?.length) {
						state.toolCalls = state.toolCalls ?? [];
						for (const tc of msg.tool_calls) {
							state.toolCalls.push({
								name: tc.function.name,
								arguments: tc.function.arguments || {},
							});
						}
					}
				}
				if (chunk.done) {
					state.promptEvalCount = chunk.prompt_eval_count;
					state.evalCount = chunk.eval_count;
				}
			},
			finalize,
			onError: (error) => this.plugin?.logger.error('[OllamaClient] Streaming error:', error),
		});
	}

	private buildOptions(): Record<string, unknown> {
		const options: Record<string, unknown> = {};
		if (typeof this.config.maxOutputTokens === 'number') options.num_predict = this.config.maxOutputTokens;
		return options;
	}

	private async buildChatRequest(
		request: ExtendedModelRequest,
		model: string,
		stream: boolean
	): Promise<ChatRequest & { stream: boolean }> {
		const systemInstruction = await this.prompts.buildExtendedSystemInstruction(request);
		const messages: Message[] = [];

		if (systemInstruction) {
			messages.push({ role: 'system', content: systemInstruction });
		}

		// Convert conversation history. Entries may be in Gemini Content shape
		// (role + parts[]) or our internal {role, message|text} shape. We
		// flatten function-call / function-response parts into Ollama's
		// `tool_calls` / tool-role messages.
		for (const entry of request.conversationHistory ?? []) {
			const converted = this.convertHistoryEntry(entry);
			if (converted) messages.push(...converted);
		}

		// Final user turn
		const userParts: string[] = [];
		const userImages: string[] = [];
		if (request.userMessage && request.userMessage.trim()) {
			userParts.push(request.userMessage);
		}
		if (request.perTurnContext && request.perTurnContext.trim()) {
			userParts.push(request.perTurnContext);
		}
		const allAttachments: InlineDataPart[] = request.inlineAttachments ?? [];
		for (const att of allAttachments) {
			if (att.mimeType.startsWith('image/')) {
				userImages.push(att.base64);
			} else {
				throw new Error(t('provider.unsupportedAttachment', { provider: 'Ollama', mimeType: att.mimeType }));
			}
		}
		if (userParts.length || userImages.length) {
			const message: Message = {
				role: 'user',
				content: userParts.join('\n\n'),
			};
			if (userImages.length) {
				message.images = userImages;
			}
			messages.push(message);
		}

		const tools = request.availableTools ? this.toOllamaTools(request.availableTools) : undefined;

		return {
			model,
			messages,
			stream,
			options: this.buildOptions(),
			...(tools && tools.length ? { tools } : {}),
		};
	}

	private convertHistoryEntry(entry: unknown): Message[] | null {
		const walked = walkHistoryEntry(entry, 'Ollama');
		if (!walked) return null;

		const out: Message[] = [];

		// Tool responses become tool-role messages. Don't coalesce `null` to
		// `{}` — an explicit null response carries different meaning ("no
		// result") than an empty object, and JSON.stringify(null) === "null"
		// is the correct serialization to preserve that.
		//
		// Ordering note: these precede the assistant message, the opposite of
		// OpenAIClient.convertHistoryEntry. That is not a contradiction — the
		// Chat Completions API *requires* the `tool_calls`-declaring assistant
		// message to come first, while Ollama imposes no such constraint, so
		// this half of the pair is arbitrary rather than load-bearing.
		for (const tr of walked.toolResponses) {
			const responseText = typeof tr.response === 'string' ? tr.response : JSON.stringify(tr.response);
			out.push({ role: 'tool', content: responseText, tool_name: tr.name });
		}

		// Assistant turn (text + tool calls together)
		if (walked.role === 'assistant' && (walked.hasText || walked.toolCalls.length)) {
			const message: Message = { role: 'assistant', content: walked.text };
			if (walked.toolCalls.length) {
				message.tool_calls = walked.toolCalls.map((tc) => ({
					function: { name: tc.name, arguments: tc.args },
				}));
			}
			out.push(message);
		} else if (walked.role !== 'assistant' && (walked.hasText || walked.images.length)) {
			const message: Message = { role: walked.role, content: walked.text };
			if (walked.images.length) message.images = walked.images.map((image) => image.base64);
			out.push(message);
		}

		return out.length ? out : null;
	}

	private toOllamaTools(tools: ToolDefinition[]): Tool[] {
		return tools.map((tool) => ({
			type: 'function',
			function: {
				name: tool.name,
				description: tool.description,
				parameters: {
					type: tool.parameters.type ?? 'object',
					// `ToolDefinition.parameters.properties` is a provider-agnostic JSON-schema
					// bag (`Record<string, unknown>`); narrow it to Ollama's property-schema map
					// at this boundary where the shapes are known to line up.
					properties: (tool.parameters.properties ?? {}) as NonNullable<
						NonNullable<Tool['function']['parameters']>['properties']
					>,
					required: tool.parameters.required ?? [],
				},
			},
		}));
	}

	private toModelResponse(response: ChatResponse): ModelResponse {
		const message = response.message ?? ({} as Message);
		const toolCalls: ToolCall[] | undefined = message.tool_calls?.length
			? message.tool_calls.map((tc) => ({
					name: tc.function.name,
					arguments: tc.function.arguments || {},
				}))
			: undefined;

		const usageMetadata = this.toUsageMetadata(response.prompt_eval_count, response.eval_count);
		return {
			markdown: message.content ?? '',
			rendered: '',
			...(message.thinking && { thoughts: message.thinking }),
			...(toolCalls && { toolCalls }),
			...(usageMetadata && { usageMetadata }),
		};
	}

	/**
	 * Build a usageMetadata object from Ollama's `prompt_eval_count` /
	 * `eval_count` fields, which only arrive on the terminal `done` chunk.
	 * Returning `undefined` (rather than `{0,0,0}`) when both inputs are
	 * missing preserves the distinction between "stream cancelled, counts
	 * unknown" and "stream completed with zero tokens" in the token UI and
	 * eval reporter.
	 */
	private toUsageMetadata(
		promptTokens: number | undefined,
		candidateTokens: number | undefined
	): ModelResponse['usageMetadata'] | undefined {
		if (promptTokens === undefined && candidateTokens === undefined) {
			return undefined;
		}
		const meta: NonNullable<ModelResponse['usageMetadata']> = {};
		if (promptTokens !== undefined) meta.promptTokenCount = promptTokens;
		if (candidateTokens !== undefined) meta.candidatesTokenCount = candidateTokens;
		if (promptTokens !== undefined && candidateTokens !== undefined) {
			meta.totalTokenCount = promptTokens + candidateTokens;
		}
		return meta;
	}
}
