import { GoogleGenAI } from '@google/genai';
import { ModelApi, BaseModelRequest, ExtendedModelRequest, ModelResponse, ToolCall, StreamCallback, StreamingModelResponse } from '../interfaces/model-api';
import { ModelConfig, ApiFeatures } from '../config/model-config';
import { GeminiPrompts } from '../../prompts';

/**
 * Configuration-based implementation of the Gemini API
 * This is the new preferred implementation that doesn't depend on the plugin instance
 */
export class GeminiApiConfig implements ModelApi {
	private ai: GoogleGenAI;
	private config: ModelConfig;
	private features: ApiFeatures;
	private prompts: GeminiPrompts;

	constructor(config: ModelConfig, features: ApiFeatures = { searchGrounding: false, streamingEnabled: true }, prompts?: GeminiPrompts) {
		this.config = config;
		this.features = features;
		this.prompts = prompts || new GeminiPrompts();
		this.ai = new GoogleGenAI({
			apiKey: config.apiKey
		});
	}

	/**
	 * Build the request configuration for the model
	 */
	private buildRequestConfig(request: BaseModelRequest | ExtendedModelRequest): any {
		// Determine effective configuration
		const temperature = (request as ExtendedModelRequest).temperature ?? this.config.temperature;
		const topP = (request as ExtendedModelRequest).topP ?? this.config.topP;
		const maxOutputTokens = this.config.maxOutputTokens;

		// Build the config object
		const config: any = {
			model: this.config.model,
			contents: this.buildContents(request),
			config: {
				temperature,
				topP,
				...(maxOutputTokens && { maxOutputTokens }),
			},
		};

		// Handle search grounding
		if (this.features.searchGrounding && !(request as ExtendedModelRequest).availableTools?.length) {
			config.tools = [{ googleSearch: {} }];
		}

		// Handle function calling tools
		if ((request as ExtendedModelRequest).availableTools?.length) {
			const functionDeclarations = (request as ExtendedModelRequest).availableTools!.map(tool => ({
				name: tool.name,
				description: tool.description,
				parameters: {
					type: 'object' as const,
					properties: tool.parameters.properties || {},
					required: tool.parameters.required || []
				}
			}));
			if (functionDeclarations.length > 0) {
				config.tools = config.tools || [];
				config.tools.push({ functionDeclarations });
			}
		}

		return config;
	}

	/**
	 * Generate a streaming response
	 */
	generateStreamingResponse(
		request: BaseModelRequest | ExtendedModelRequest,
		onChunk: StreamCallback
	): StreamingModelResponse {
		if (!this.features.streamingEnabled) {
			throw new Error('Streaming is not enabled');
		}

		let cancelled = false;

		const complete = (async (): Promise<ModelResponse> => {
			try {
				const requestConfig = this.buildRequestConfig(request);
				
				// Generate streaming response
				const result = await this.ai.models.generateContentStream(requestConfig);

				let fullMarkdown = '';
				const toolCalls: ToolCall[] = [];

				// Process the stream
				for await (const chunk of result) {
					if (cancelled) break;
					
					if (chunk.text) {
						fullMarkdown += chunk.text;
						onChunk(chunk.text);
					}
					
					// Check for tool calls in streaming chunks
					if (chunk.candidates?.[0]?.content?.parts) {
						for (const part of chunk.candidates[0].content.parts) {
							if (part.functionCall) {
								toolCalls.push({
									name: part.functionCall.name || '',
									arguments: part.functionCall.args || {}
								});
							}
						}
					}
				}

				return {
					markdown: fullMarkdown,
					rendered: fullMarkdown,
					toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
				};
			} catch (error) {
				console.error('Error during streaming:', error);
				throw error;
			}
		})();

		return {
			complete,
			cancel: () => {
				cancelled = true;
			}
		};
	}

	/**
	 * Generate a non-streaming response
	 */
	async generateModelResponse(request: BaseModelRequest | ExtendedModelRequest): Promise<ModelResponse> {
		try {
			const requestConfig = this.buildRequestConfig(request);
			
			// Generate response
			const result = await this.ai.models.generateContent(requestConfig);

			// Extract text
			let text = '';
			if (result.candidates?.[0]?.content?.parts) {
				for (const part of result.candidates[0].content.parts) {
					if (part.text) {
						text += part.text;
					}
				}
			}

			// Parse tool calls from response
			const toolCalls: ToolCall[] = [];
			
			if (result.candidates?.[0]?.content?.parts) {
				for (const part of result.candidates[0].content.parts) {
					if (part.functionCall) {
						toolCalls.push({
							name: part.functionCall.name || '',
							arguments: part.functionCall.args || {}
						});
					}
				}
			}

			return {
				markdown: text,
				rendered: text,
				toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
			};
		} catch (error) {
			console.error('Error generating response:', error);
			throw error;
		}
	}

	/**
	 * Build content array from request
	 */
	private buildContents(request: BaseModelRequest | ExtendedModelRequest): any[] {
		const contents: any[] = [];

		// System instruction is handled separately in the API config, not in contents

		// Add conversation history if available
		if ((request as ExtendedModelRequest).conversationHistory) {
			contents.push(...(request as ExtendedModelRequest).conversationHistory!);
		}

		// Add the current prompt
		contents.push({
			role: 'user',
			parts: [{ text: request.prompt }],
		});

		return contents;
	}
}