/**
 * API module — public barrel for model provider integration.
 */

// Interfaces
export type {
	ModelApi,
	ModelResponse,
	BaseModelRequest,
	ExtendedModelRequest,
	InlineDataPart,
	ImagePart,
	ToolCall,
	ToolDefinition,
} from './interfaces/model-api';

// Factory
export { ModelClientFactory, ModelUseCase } from './factory';

// Providers
export { GeminiClient } from './providers/gemini';
export type { GeminiClientConfig } from './providers/gemini';
export { OllamaClient } from './providers/ollama';
export type { OllamaClientConfig } from './providers/ollama';
