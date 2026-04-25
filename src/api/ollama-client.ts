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
} from './interfaces/model-api';
import { GeminiPrompts } from '../prompts';
import type ObsidianGemini from '../main';
import { getDefaultModelForRole } from '../models';

export interface OllamaClientConfig {
	baseUrl: string;
	model?: string;
	temperature?: number;
	topP?: number;
	maxOutputTokens?: number;
	streamingEnabled?: boolean;
}

export class OllamaClient implements ModelApi {
	private client: Ollama;
	private config: OllamaClientConfig;
	private prompts: GeminiPrompts;
	private plugin?: ObsidianGemini;

	constructor(config: OllamaClientConfig, prompts?: GeminiPrompts, plugin?: ObsidianGemini) {
		this.config = {
			temperature: 0.7,
			topP: 1,
			streamingEnabled: true,
			...config,
		};
		this.plugin = plugin;
		this.prompts = prompts || new GeminiPrompts(plugin);
		this.client = new Ollama({ host: this.config.baseUrl });
	}

	async generateModelResponse(request: BaseModelRequest | ExtendedModelRequest): Promise<ModelResponse> {
		const isExtended = 'userMessage' in request;
		const model = request.model || this.config.model || getDefaultModelForRole('chat', 'ollama');
		if (!model) {
			throw new Error('No Ollama model selected. Pull a model with `ollama pull <name>` and choose it in settings.');
		}

		try {
			if (!isExtended) {
				const generateResponse = await this.client.generate({
					model,
					prompt: request.prompt,
					stream: false,
					options: this.buildOptions(request),
				});
				return {
					markdown: generateResponse.response,
					rendered: '',
					usageMetadata: this.toUsageMetadata(generateResponse.prompt_eval_count, generateResponse.eval_count),
				};
			}

			const chatRequest = await this.buildChatRequest(request as ExtendedModelRequest, model, false);
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
		const isExtended = 'userMessage' in request;
		const model = request.model || this.config.model || getDefaultModelForRole('chat', 'ollama');

		let cancelled = false;
		let accumulatedText = '';
		let accumulatedThoughts = '';
		let toolCalls: ToolCall[] | undefined;
		let promptEvalCount: number | undefined;
		let evalCount: number | undefined;
		let activeStream: { abort: () => void } | null = null;

		const complete = (async (): Promise<ModelResponse> => {
			if (!model) {
				throw new Error('No Ollama model selected. Pull a model with `ollama pull <name>` and choose it in settings.');
			}

			try {
				if (!isExtended) {
					// generate() supports streaming too; route the same way for consistency
					const stream = await this.client.generate({
						model,
						prompt: request.prompt,
						stream: true,
						options: this.buildOptions(request),
					});
					activeStream = stream;
					// cancel() may have fired while the await above was outstanding —
					// abort immediately so the daemon stops generating.
					if (cancelled) {
						stream.abort();
					}

					for await (const chunk of stream) {
						if (cancelled) break;
						if (chunk.response) {
							accumulatedText += chunk.response;
							onChunk({ text: chunk.response });
						}
						if (chunk.done) {
							promptEvalCount = chunk.prompt_eval_count;
							evalCount = chunk.eval_count;
						}
					}
				} else {
					const chatRequest = await this.buildChatRequest(request as ExtendedModelRequest, model, true);
					const stream = await this.client.chat(chatRequest as ChatRequest & { stream: true });
					activeStream = stream;
					if (cancelled) {
						stream.abort();
					}

					for await (const chunk of stream) {
						if (cancelled) break;
						const msg = chunk.message;
						if (msg?.content) {
							accumulatedText += msg.content;
							onChunk({ text: msg.content });
						}
						if (msg?.thinking) {
							accumulatedThoughts += msg.thinking;
							onChunk({ text: '', thought: msg.thinking });
						}
						if (msg?.tool_calls?.length) {
							toolCalls = toolCalls ?? [];
							for (const tc of msg.tool_calls) {
								toolCalls.push({
									name: tc.function.name,
									arguments: tc.function.arguments || {},
								});
							}
						}
						if (chunk.done) {
							promptEvalCount = chunk.prompt_eval_count;
							evalCount = chunk.eval_count;
						}
					}
				}

				return {
					markdown: accumulatedText,
					rendered: '',
					...(accumulatedThoughts && { thoughts: accumulatedThoughts }),
					...(toolCalls && toolCalls.length && { toolCalls }),
					usageMetadata: this.toUsageMetadata(promptEvalCount, evalCount),
				};
			} catch (error) {
				if (cancelled) {
					return {
						markdown: accumulatedText,
						rendered: '',
						...(accumulatedThoughts && { thoughts: accumulatedThoughts }),
						...(toolCalls && toolCalls.length && { toolCalls }),
						usageMetadata: this.toUsageMetadata(promptEvalCount, evalCount),
					};
				}
				this.plugin?.logger.error('[OllamaClient] Streaming error:', error);
				throw error;
			}
		})();

		return {
			complete,
			cancel: () => {
				cancelled = true;
				try {
					activeStream?.abort();
				} catch (err) {
					this.plugin?.logger.debug('[OllamaClient] Abort failed:', err);
				}
			},
		};
	}

	private buildOptions(request: BaseModelRequest): Record<string, unknown> {
		const options: Record<string, unknown> = {};
		const temperature = request.temperature ?? this.config.temperature;
		const topP = request.topP ?? this.config.topP;
		if (typeof temperature === 'number') options.temperature = temperature;
		if (typeof topP === 'number') options.top_p = topP;
		if (typeof this.config.maxOutputTokens === 'number') options.num_predict = this.config.maxOutputTokens;
		return options;
	}

	private async buildChatRequest(
		request: ExtendedModelRequest,
		model: string,
		stream: boolean
	): Promise<ChatRequest & { stream: boolean }> {
		const systemInstruction = await this.buildSystemInstruction(request);
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
		const allAttachments: InlineDataPart[] = [
			...(request.inlineAttachments || []),
			...(request.imageAttachments || []),
		];
		for (const att of allAttachments) {
			if (att.mimeType.startsWith('image/')) {
				userImages.push(att.base64);
			} else {
				throw new Error(
					`Ollama only supports image attachments; received ${att.mimeType}. ` +
						`Switch to the Gemini provider for PDF, audio, or video input.`
				);
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
			options: this.buildOptions(request),
			...(tools && tools.length ? { tools } : {}),
		};
	}

	private async buildSystemInstruction(request: ExtendedModelRequest): Promise<string> {
		let agentsMemory: string | null = null;
		if (this.plugin?.agentsMemory) {
			try {
				agentsMemory = await this.plugin.agentsMemory.read();
			} catch (error) {
				this.plugin.logger.warn('Failed to load AGENTS.md:', error);
			}
		}

		let availableSkills: { name: string; description: string }[] = [];
		if (this.plugin?.skillManager) {
			try {
				availableSkills = await this.plugin.skillManager.getSkillSummaries();
			} catch (error) {
				this.plugin.logger.warn('Failed to load skill summaries:', error);
			}
		}

		if (request.projectSkills && request.projectSkills.length > 0) {
			availableSkills = availableSkills.filter((s) => request.projectSkills!.includes(s.name));
		}

		return this.prompts.getSystemPromptWithCustom(
			request.availableTools,
			request.customPrompt,
			agentsMemory,
			availableSkills,
			request.projectInstructions,
			request.perTurnContext ?? request.prompt,
			request.sessionStartedAt
		);
	}

	private convertHistoryEntry(entry: any): Message[] | null {
		if (!entry) return null;

		// Gemini Content shape: { role: 'user'|'model', parts: Part[] }
		if ('role' in entry && Array.isArray(entry.parts)) {
			const role = entry.role === 'model' ? 'assistant' : entry.role === 'system' ? 'system' : 'user';
			const textChunks: string[] = [];
			const images: string[] = [];
			const toolCallParts: { name: string; arguments: Record<string, any> }[] = [];
			const toolResponseParts: { name: string; response: any }[] = [];
			for (const part of entry.parts) {
				if (typeof part?.text === 'string') {
					textChunks.push(part.text);
				} else if (part?.inlineData?.mimeType?.startsWith('image/') && part.inlineData.data) {
					images.push(part.inlineData.data);
				} else if (part?.inlineData?.mimeType) {
					// Mirror buildChatRequest's current-turn handling so resumed sessions
					// don't silently drop PDF/audio/video context the model never sees.
					throw new Error(
						`Ollama only supports image attachments; conversation history contains ${part.inlineData.mimeType}. ` +
							`Switch to the Gemini provider for PDF, audio, or video input.`
					);
				} else if (part?.functionCall) {
					toolCallParts.push({
						name: part.functionCall.name,
						arguments: part.functionCall.args || {},
					});
				} else if (part?.functionResponse) {
					toolResponseParts.push({
						name: part.functionResponse.name,
						response: part.functionResponse.response,
					});
				}
			}

			const out: Message[] = [];

			// Tool responses become tool-role messages. Don't coalesce `null` to
			// `{}` — an explicit null response carries different meaning ("no
			// result") than an empty object, and JSON.stringify(null) === "null"
			// is the correct serialization to preserve that.
			for (const tr of toolResponseParts) {
				const responseText = typeof tr.response === 'string' ? tr.response : JSON.stringify(tr.response);
				out.push({ role: 'tool', content: responseText, tool_name: tr.name });
			}

			// Assistant turn (text + tool calls together)
			if (role === 'assistant' && (textChunks.length || toolCallParts.length)) {
				const message: Message = {
					role: 'assistant',
					content: textChunks.join('\n').trim(),
				};
				if (toolCallParts.length) {
					message.tool_calls = toolCallParts.map((tc) => ({
						function: { name: tc.name, arguments: tc.arguments },
					}));
				}
				out.push(message);
			} else if (role !== 'assistant' && (textChunks.length || images.length)) {
				const message: Message = {
					role,
					content: textChunks.join('\n\n').trim(),
				};
				if (images.length) message.images = images;
				out.push(message);
			}

			return out.length ? out : null;
		}

		// Internal shape: { role, text } or { role, message }
		if ('role' in entry) {
			const text = entry.text ?? entry.message;
			if (typeof text !== 'string' || !text.trim()) return null;
			const role = entry.role === 'model' || entry.role === 'assistant' ? 'assistant' : 'user';
			return [{ role, content: text }];
		}

		return null;
	}

	private toOllamaTools(tools: ToolDefinition[]): Tool[] {
		return tools.map((tool) => ({
			type: 'function',
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

	private toModelResponse(response: ChatResponse): ModelResponse {
		const message = response.message ?? ({} as Message);
		const toolCalls: ToolCall[] | undefined = message.tool_calls?.length
			? message.tool_calls.map((tc) => ({
					name: tc.function.name,
					arguments: tc.function.arguments || {},
				}))
			: undefined;

		return {
			markdown: message.content ?? '',
			rendered: '',
			...(message.thinking && { thoughts: message.thinking }),
			...(toolCalls && { toolCalls }),
			usageMetadata: this.toUsageMetadata(response.prompt_eval_count, response.eval_count),
		};
	}

	private toUsageMetadata(promptTokens: number | undefined, candidateTokens: number | undefined) {
		const prompt = promptTokens ?? 0;
		const candidates = candidateTokens ?? 0;
		return {
			promptTokenCount: prompt,
			candidatesTokenCount: candidates,
			totalTokenCount: prompt + candidates,
		};
	}
}
