/**
 * API module for interacting with various LLM providers
 */

// Re-export the interfaces
export type { ModelApi, ModelResponse, BaseModelRequest, ExtendedModelRequest } from './interfaces/model-api';

// Export the factory and provider enum
export { ApiFactory, ApiProvider } from './api-factory';

// Export implementations directly for backward compatibility
export { OllamaApi } from './implementations/ollama-api';
