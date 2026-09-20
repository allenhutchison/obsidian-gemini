/**
 * API module — public barrel for model provider integration.
 */

// Interfaces
export type { BaseModelRequest, ExtendedModelRequest } from './interfaces/model-api';
export type { ImageGenerationApi } from './interfaces/image-generation-api';

// Factory
export { ModelClientFactory, ModelUseCase } from './factory';
