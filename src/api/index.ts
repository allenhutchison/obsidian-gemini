/**
 * API module — public barrel for model provider integration.
 */

// Interfaces
export type { BaseModelRequest, ExtendedModelRequest } from './interfaces/model-api';

// Factory
export { ModelClientFactory, ModelUseCase } from './factory';

// Providers
export { GeminiClient } from './providers/gemini';
