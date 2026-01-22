/**
 * API module for Gemini AI integration
 */

// Re-export the interfaces
export type {
	ModelApi,
	ModelResponse,
	BaseModelRequest,
	ExtendedModelRequest,
	ToolCall,
	ToolDefinition,
} from './interfaces/model-api';

// Export the simplified factory
export { GeminiClientFactory, ModelUseCase } from './simple-factory';

// Export the client
export { GeminiClient } from './gemini-client';
export type { GeminiClientConfig } from './gemini-client';
