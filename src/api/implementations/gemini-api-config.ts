import { GenerativeModel, GoogleGenerativeAI, Content, FunctionDeclaration } from '@google/generative-ai';
import { ModelApi, BaseModelRequest, ExtendedModelRequest, ModelResponse, ToolCall } from '../interfaces/model-api';
import { StreamCallback, StreamingModelResponse } from '../interfaces/streaming';
import { ModelConfig, ApiFeatures } from '../config/model-config';
import { GeminiPrompts } from '../../prompts';
import { convertGeminiTools } from '../../tools/tool-converter';

/**
 * Configuration-based implementation of the Gemini API
 * This is the new preferred implementation that doesn't depend on the plugin instance
 */
export class GeminiApiConfig implements ModelApi {
	private ai: GoogleGenerativeAI;
	private model: GenerativeModel | null = null;
	private config: ModelConfig;
	private features: ApiFeatures;
	private prompts: GeminiPrompts;

	constructor(config: ModelConfig, features: ApiFeatures = { searchGrounding: false, streamingEnabled: true }, prompts?: GeminiPrompts) {
		this.config = config;
		this.features = features;
		this.prompts = prompts || new GeminiPrompts();
		this.ai = new GoogleGenerativeAI(config.apiKey);
	}

	/**
	 * Get or create the generative model instance
	 */
	private getModel(request: BaseModelRequest | ExtendedModelRequest): GenerativeModel {
		// Determine effective configuration
		const temperature = (request as ExtendedModelRequest).temperature ?? this.config.temperature;
		const topP = (request as ExtendedModelRequest).topP ?? this.config.topP;
		const maxOutputTokens = (request as ExtendedModelRequest).maxOutputTokens ?? this.config.maxOutputTokens;

		// Prepare tools array if needed
		const tools: any[] = [];
		
		// Handle search grounding
		if (this.features.searchGrounding && !(request as ExtendedModelRequest).availableTools?.length) {
			tools.push({ googleSearch: {} });
		}

		// Handle function calling tools
		if ((request as ExtendedModelRequest).availableTools?.length) {
			const functionDeclarations = convertGeminiTools((request as ExtendedModelRequest).availableTools!);
			if (functionDeclarations.length > 0) {
				tools.push({ functionDeclarations });
			}
		}

		// Create model with configuration
		const modelConfig: any = {
			temperature,
			topP,
			...(maxOutputTokens && { maxOutputTokens }),
		};

		// Add tools if any
		if (tools.length > 0) {
			modelConfig.tools = tools;
		}

		return this.ai.getGenerativeModel({
			model: this.config.model,
			generationConfig: modelConfig,
		});
	}

	/**
	 * Generate a streaming response
	 */
	async generateStreamingResponse(
		request: BaseModelRequest | ExtendedModelRequest,
		onChunk: StreamCallback
	): Promise<StreamingModelResponse> {
		if (!this.features.streamingEnabled) {
			throw new Error('Streaming is not enabled');
		}

		try {
			const model = this.getModel(request);
			
			// Build content array
			const contents: Content[] = this.buildContents(request);

			// Generate streaming response
			const result = await model.generateContentStream({ contents });

			// Process the stream
			for await (const chunk of result.stream) {
				const text = chunk.text();
				if (text) {
					onChunk(text);
				}
			}

			// Get the final response for metadata
			const response = await result.response;
			return {
				cancel: () => {
					// Streaming already completed
				},
			};
		} catch (error) {
			console.error('Error during streaming:', error);
			throw error;
		}
	}

	/**
	 * Generate a non-streaming response
	 */
	async generateModelResponse(request: BaseModelRequest | ExtendedModelRequest): Promise<ModelResponse> {
		try {
			const model = this.getModel(request);
			
			// Build content array
			const contents: Content[] = this.buildContents(request);

			// Generate response
			const result = await model.generateContent({ contents });
			const response = result.response;

			// Extract text
			const text = response.text();

			// Parse tool calls from response
			const toolCalls: ToolCall[] = [];
			
			if (response.candidates && response.candidates.length > 0) {
				const candidate = response.candidates[0];
				if (candidate.content && candidate.content.parts) {
					for (const part of candidate.content.parts) {
						if (part.functionCall) {
							toolCalls.push({
								name: part.functionCall.name,
								arguments: part.functionCall.args || {}
							});
						}
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
	private buildContents(request: BaseModelRequest | ExtendedModelRequest): Content[] {
		const contents: Content[] = [];

		// Add system instruction if available
		if ((request as ExtendedModelRequest).systemInstruction) {
			contents.push({
				role: 'user',
				parts: [{ text: (request as ExtendedModelRequest).systemInstruction! }],
			});
			contents.push({
				role: 'model',
				parts: [{ text: 'I understand and will follow these instructions.' }],
			});
		}

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