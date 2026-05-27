import { requestUrl } from 'obsidian';
import {
	ModelApi,
	BaseModelRequest,
	ExtendedModelRequest,
	ModelResponse,
	ToolCall,
	StreamCallback,
	StreamingModelResponse,
} from '../../interfaces/model-api';
import { GeminiPrompts } from '../../../prompts';
import type ObsidianGemini from '../../../main';
import type { OpenAiClientConfig } from './config';
import { convertContentToMessages, OpenAiMessage } from './format-converter';
import { parseSseStream } from './sse-parser';

interface OpenAiChatCompletionRequest {
	model: string;
	messages: OpenAiMessage[];
	stream: boolean;
	temperature?: number;
	top_p?: number;
	max_tokens?: number;
	tools?: Array<{
		type: 'function';
		function: {
			name: string;
			description: string;
			parameters: Record<string, unknown>;
		};
	}>;
}

interface OpenAiChatCompletionResponse {
	choices: Array<{
		message: {
			role: string;
			content?: string;
			tool_calls?: Array<{
				id: string;
				type: string;
				function: { name: string; arguments: string };
			}>;
		};
		finish_reason?: string;
	}>;
	usage?: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
}

class OpenAiApiError extends Error {
	status: number;
	constructor(message: string, status: number) {
		super(message);
		this.status = status;
		this.name = 'OpenAiApiError';
	}
}

export class OpenAiClient implements ModelApi {
	private config: OpenAiClientConfig;
	private prompts: GeminiPrompts;
	private plugin?: ObsidianGemini;

	constructor(config: OpenAiClientConfig, prompts?: GeminiPrompts, plugin?: ObsidianGemini) {
		this.config = {
			temperature: 0.7,
			topP: 1,
			streamingEnabled: true,
			...config,
		};
		this.plugin = plugin;
		this.prompts = prompts || new GeminiPrompts(plugin);
	}

	async generateModelResponse(request: BaseModelRequest | ExtendedModelRequest): Promise<ModelResponse> {
		const model = request.model || this.config.model;
		if (!model) {
			throw new Error('No OpenAI model selected. Enter a model name in settings.');
		}

		try {
			const body = await this.buildRequestBody(request, model, false);
			const response = await this.makeRequest('/chat/completions', body);
			return this.parseResponse(response);
		} catch (error) {
			this.plugin?.logger.error('[OpenAiClient] Error generating content:', error);
			throw error;
		}
	}

	generateStreamingResponse(
		request: BaseModelRequest | ExtendedModelRequest,
		onChunk: StreamCallback
	): StreamingModelResponse {
		const model = request.model || this.config.model;
		let cancelled = false;
		let accumulatedText = '';
		let accumulatedThoughts = '';
		let toolCalls: ToolCall[] | undefined;
		let usageMetadata: ModelResponse['usageMetadata'] | undefined;
		const toolCallBuffers: Map<string, { name: string; argsBuffer: string }> = new Map();

		const complete = (async (): Promise<ModelResponse> => {
			if (!model) {
				throw new Error('No OpenAI model selected. Enter a model name in settings.');
			}

			try {
				const body = await this.buildRequestBody(request, model, true);
				const response = await this.makeRequest('/chat/completions', body);

				if (typeof response.text !== 'string') {
					throw new Error('Streaming response did not return text');
				}

				const chunks = parseSseStream(response.text);

				for (const chunk of chunks) {
					if (cancelled) break;

					const delta = chunk.choices[0]?.delta;
					if (!delta) continue;

					// Text content
					if (delta.content) {
						accumulatedText += delta.content;
						onChunk({ text: delta.content });
					}

					// Tool calls (accumulate across chunks)
					if (delta.tool_calls) {
						for (const tc of delta.tool_calls) {
							const id = tc.id || `call_${tc.index}`;
							if (!toolCallBuffers.has(id)) {
								toolCallBuffers.set(id, { name: tc.function?.name || '', argsBuffer: '' });
							}
							const buffer = toolCallBuffers.get(id)!;
							if (tc.function?.arguments) {
								buffer.argsBuffer += tc.function.arguments;
							}
						}
					}
				}

				// After the loop, convert buffers to ToolCall[]
				if (toolCallBuffers.size > 0) {
					toolCalls = [];
					for (const [id, buffer] of toolCallBuffers) {
						try {
							toolCalls.push({
								name: buffer.name,
								arguments: JSON.parse(buffer.argsBuffer || '{}'),
								id,
							});
						} catch {
							toolCalls.push({
								name: buffer.name,
								arguments: {},
								id,
							});
						}
					}
				}

				// Check for usage in the last chunk
				const lastChunk = chunks[chunks.length - 1];
				if (lastChunk?.usage) {
					usageMetadata = {
						promptTokenCount: lastChunk.usage.prompt_tokens,
						candidatesTokenCount: lastChunk.usage.completion_tokens,
						totalTokenCount: lastChunk.usage.total_tokens,
					};
				}

				return {
					markdown: accumulatedText,
					rendered: '',
					...(accumulatedThoughts && { thoughts: accumulatedThoughts }),
					...(toolCalls && toolCalls.length && { toolCalls }),
					...(usageMetadata && { usageMetadata }),
				};
			} catch (error) {
				if (cancelled) {
					return {
						markdown: accumulatedText,
						rendered: '',
						...(accumulatedThoughts && { thoughts: accumulatedThoughts }),
						...(toolCalls && toolCalls.length && { toolCalls }),
						...(usageMetadata && { usageMetadata }),
					};
				}
				this.plugin?.logger.error('[OpenAiClient] Streaming error:', error);
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

	private async buildRequestBody(
		request: BaseModelRequest | ExtendedModelRequest,
		model: string,
		stream: boolean
	): Promise<OpenAiChatCompletionRequest> {
		const isExtended = 'userMessage' in request;

		if (!isExtended) {
			return {
				model,
				messages: [{ role: 'user', content: request.prompt }],
				stream,
				temperature: request.temperature ?? this.config.temperature,
				top_p: request.topP ?? this.config.topP,
				...(this.config.maxOutputTokens && { max_tokens: this.config.maxOutputTokens }),
			};
		}

		const extReq = request as ExtendedModelRequest;
		const messages: OpenAiMessage[] = [];

		// System instruction
		const systemInstruction = await this.buildSystemInstruction(extReq);
		if (systemInstruction) {
			messages.push({ role: 'system', content: systemInstruction });
		}

		// Conversation history
		if (extReq.conversationHistory?.length) {
			messages.push(...convertContentToMessages(extReq.conversationHistory));
		}

		// Current user message
		const userParts: string[] = [];
		if (extReq.userMessage?.trim()) userParts.push(extReq.userMessage);
		if (extReq.perTurnContext?.trim()) userParts.push(extReq.perTurnContext);

		const allAttachments = [...(extReq.inlineAttachments || []), ...(extReq.imageAttachments || [])];
		if (userParts.length || allAttachments.length) {
			const message: OpenAiMessage = { role: 'user' };

			if (allAttachments.length) {
				const content: Array<
				| { type: 'text'; text: string }
				| { type: 'image_url'; image_url: { url: string } }
			> = [];
				if (userParts.length) content.push({ type: 'text', text: userParts.join('\n\n') });

				for (const att of allAttachments) {
					content.push({
						type: 'image_url',
						image_url: { url: `data:${att.mimeType};base64,${att.base64}` },
					});
				}
				message.content = content;
			} else {
				message.content = userParts.join('\n\n');
			}

			messages.push(message);
		}

		const body: OpenAiChatCompletionRequest = {
			model,
			messages,
			stream,
			temperature: request.temperature ?? this.config.temperature,
			top_p: request.topP ?? this.config.topP,
			...(this.config.maxOutputTokens && { max_tokens: this.config.maxOutputTokens }),
		};

		// Tools
		if (extReq.availableTools?.length) {
			body.tools = extReq.availableTools.map((tool) => ({
				type: 'function',
				function: {
					name: tool.name,
					description: tool.description,
					parameters: tool.parameters as Record<string, unknown>,
				},
			}));
		}

		return body;
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
			request.sessionStartedAt
		);
	}

	private async makeRequest(
		endpoint: string,
		body: OpenAiChatCompletionRequest
	): Promise<{ status: number; json: OpenAiChatCompletionResponse; text?: string }> {
		const baseUrl = this.config.baseUrl.replace(/\/$/, '');
		const url = `${baseUrl}${endpoint}`;

		// Security: reject http unless explicitly allowed
		if (url.startsWith('http:') && !this.config.allowInsecure) {
			throw new Error(
				'Insecure HTTP connections are not allowed. Enable "Allow insecure HTTP" in settings or use HTTPS.'
			);
		}

		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			...(this.config.apiKey && { Authorization: `Bearer ${this.config.apiKey}` }),
		};

		if (body.stream) {
			headers['Accept'] = 'text/event-stream';
		}

		const response = await requestUrl({
			url,
			method: 'POST',
			headers,
			body: JSON.stringify(body),
			throw: false,
		});

		if (response.status !== 200) {
			const errorText = typeof response.text === 'string' ? response.text : JSON.stringify(response.json);
			throw new OpenAiApiError(`OpenAI API error ${response.status}: ${errorText}`, response.status);
		}

		return response;
	}

	private parseResponse(response: { json: OpenAiChatCompletionResponse }): ModelResponse {
		const data = response.json;
		const message = data.choices?.[0]?.message;

		const toolCalls: ToolCall[] | undefined = message?.tool_calls?.length
			? message.tool_calls.map((tc) => ({
					name: tc.function?.name || '',
					arguments: tc.function?.arguments ? JSON.parse(tc.function.arguments) : {},
					id: tc.id,
				}))
			: undefined;

		return {
			markdown: message?.content || '',
			rendered: '',
			...(toolCalls && { toolCalls }),
			...(data.usage && {
				usageMetadata: {
					promptTokenCount: data.usage.prompt_tokens,
					candidatesTokenCount: data.usage.completion_tokens,
					totalTokenCount: data.usage.total_tokens,
				},
			}),
		};
	}

}
