/**
 * Common interfaces for model API implementations
 */

/**
 * Represents a response from a model.
 * 
 * @property markdown - The primary text response in markdown format
 * @property rendered - Optional rendered HTML content (used for search grounding)
 */
export interface ModelResponse {
	markdown: string;
	rendered: string;
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
}

/**
 * Represents an extended model request with conversation history and a user message.
 *
 * @extends BaseModelRequest
 *
 * @property conversationHistory - An array representing the history of the conversation.
 * @property userMessage - The message from the user.
 * @property renderContent - Whether to render the content in responses (default: true)
 */
export interface ExtendedModelRequest extends BaseModelRequest {
	conversationHistory: any[];
	userMessage: string;
	renderContent?: boolean;
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
} 