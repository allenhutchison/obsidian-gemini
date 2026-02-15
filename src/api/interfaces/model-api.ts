/**
 * Common interfaces for model API implementations
 */

import { CustomPrompt } from '../../prompts/types';

/**
 * Represents a response from a model.
 *
 * @property markdown - The primary text response in markdown format
 * @property rendered - Optional rendered HTML content (used for search grounding)
 * @property toolCalls - Optional array of tool/function calls requested by the model
 */
export interface ModelResponse {
	markdown: string;
	rendered: string;
	thoughts?: string;
	toolCalls?: ToolCall[];
}

/**
 * Represents a tool call requested by the model
 */
export interface ToolCall {
	name: string;
	arguments: Record<string, any>;
	thoughtSignature?: string;
}

/**
 * Represents a basic request to a model.
 *
 * @property model - Optional model identifier. If not provided, the default model will be used.
 * @property prompt - The prompt or input text for the model. Should be fully processed.
 */
export interface BaseModelRequest {
	model?: string;
	prompt: string;
	temperature?: number;
	topP?: number;
}

/**
 * Represents an inline data attachment for multimodal input (images, audio, video, PDF)
 */
export interface InlineDataPart {
	base64: string;
	mimeType: string;
}

/** Backward-compatible alias */
export type ImagePart = InlineDataPart;

/**
 * Represents an extended model request with conversation history and a user message.
 *
 * @extends BaseModelRequest
 *
 * @property conversationHistory - An array representing the history of the conversation.
 * @property userMessage - The message from the user.
 * @property renderContent - Whether to render the content in responses (default: true)
 * @property customPrompt - Optional custom prompt to modify system behavior
 * @property availableTools - Optional array of tool definitions for function calling
 * @property inlineAttachments - Optional array of inline data attachments for multimodal input
 * @property imageAttachments - Deprecated alias for inlineAttachments
 */
export interface ExtendedModelRequest extends BaseModelRequest {
	conversationHistory: any[];
	userMessage: string;
	renderContent?: boolean;
	customPrompt?: CustomPrompt;
	availableTools?: ToolDefinition[];
	inlineAttachments?: InlineDataPart[];
	/** @deprecated Use inlineAttachments instead */
	imageAttachments?: InlineDataPart[];
}

/**
 * Represents a tool definition for function calling
 */
export interface ToolDefinition {
	name: string;
	description: string;
	parameters: {
		type: 'object';
		properties: Record<string, any>;
		required?: string[];
	};
}

/**
 * Streaming chunk data passed to callback
 */
export interface StreamChunk {
	/** Text content chunk */
	text: string;
	/** Thought/reasoning content chunk (if available) */
	thought?: string;
}

/**
 * Callback function for handling streaming responses
 *
 * @param chunk - The chunk data received from the stream
 */
export type StreamCallback = (chunk: StreamChunk) => void;

/**
 * Represents a streaming response from a model
 *
 * @property complete - Promise that resolves when streaming is complete with the full response
 * @property cancel - Function to cancel the stream
 */
export interface StreamingModelResponse {
	complete: Promise<ModelResponse>;
	cancel: () => void;
}

/**
 * Interface for model API implementations
 */
export interface ModelApi {
	/**
	 * Generate a response from a model
	 *
	 * @param request - Either a BaseModelRequest or ExtendedModelRequest
	 * @returns A promise resolving to a ModelResponse
	 */
	generateModelResponse(request: BaseModelRequest | ExtendedModelRequest): Promise<ModelResponse>;

	/**
	 * Generate a streaming response from a model
	 *
	 * @param request - Either a BaseModelRequest or ExtendedModelRequest
	 * @param onChunk - Callback function called for each text chunk
	 * @returns A StreamingModelResponse with completion promise and cancel function
	 *
	 * @remarks
	 * Implementations that don't support streaming should fall back to
	 * non-streaming behavior by calling generateModelResponse and
	 * emitting the full response as a single chunk.
	 */
	generateStreamingResponse?(
		request: BaseModelRequest | ExtendedModelRequest,
		onChunk: StreamCallback
	): StreamingModelResponse;
}
