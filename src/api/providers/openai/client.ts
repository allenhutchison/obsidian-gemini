import { requestUrl } from 'obsidian';
import {
	ModelApi,
	BaseModelRequest,
	ExtendedModelRequest,
	ModelResponse,
	ToolCall,
	ToolDefinition,
	StreamCallback,
	StreamingModelResponse,
} from '../../interfaces/model-api';
import { GeminiPrompts } from '../../../prompts';
import type ObsidianGemini from '../../../main';
import type { OpenAiClientConfig } from './config';
import { convertContentToMessages, OpenAiMessage } from './format-converter';
import { parseSseStream, SseChunk } from './sse-parser';

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
						toolCalls = toolCalls || [];
						for (const tc of delta.tool_calls) {
							const existing = toolCalls.find((t) => t.id === tc.id);
							if (existing) {
								// Append arguments for streaming tool calls
								if (tc.function?.arguments) {
									existing.arguments = this.mergeArguments(existing.arguments, tc.function.arguments);
								}
							} else {
								toolCalls.push({
									name: tc.function?.name || '',
									arguments: tc.function?.arguments ? JSON.parse(tc.function.arguments) : {},
									id: tc.id || `call_${toolCalls.length}`,
								});
							}
						}
					}
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
	): Promise<Record<string, any>> {
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
				const content: Array<{ type: string; [key: string]: any }> = [];
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

		const body: Record<string, any> = {
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
					parameters: tool.parameters,
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

	private async makeRequest(endpoint: string, body: Record<string, any>): Promise<any> {
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
			const error = new Error(`OpenAI API error ${response.status}: ${errorText}`);
			(error as any).status = response.status;
			throw error;
		}

		return response;
	}

	private parseResponse(response: any): ModelResponse {
		const data = response.json;
		const message = data.choices?.[0]?.message;

		const toolCalls: ToolCall[] | undefined = message?.tool_calls?.length
			? message.tool_calls.map((tc: any) => ({
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

	private mergeArguments(existing: Record<string, any>, delta: string): Record<string, any> {
		// For streaming tool calls, arguments come in chunks as JSON string fragments
		// We need to accumulate and parse when complete
		// This is a simplified approach — full implementation would buffer and parse
		try {
			return JSON.parse(delta);
		} catch {
			return existing;
		}
	}
}
