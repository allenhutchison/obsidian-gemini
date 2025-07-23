import { ModelApi, BaseModelRequest, ExtendedModelRequest, ModelResponse, StreamCallback, StreamingModelResponse } from './interfaces/model-api';
import { RetryConfig } from './config/model-config';

/**
 * Configuration-based retry decorator for ModelApi implementations
 * This decorator adds retry logic with exponential backoff to any ModelApi implementation
 */
export class RetryDecoratorConfig implements ModelApi {
	private wrappedApi: ModelApi;
	private config: RetryConfig;

	constructor(wrappedApi: ModelApi, config: RetryConfig) {
		this.wrappedApi = wrappedApi;
		this.config = config;
	}

	/**
	 * Sleep for a specified number of milliseconds
	 */
	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	/**
	 * Execute a function with retry logic
	 */
	private async executeWithRetry<T>(
		operation: () => Promise<T>,
		operationName: string
	): Promise<T> {
		let lastError: Error | undefined;
		
		for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
			try {
				return await operation();
			} catch (error) {
				lastError = error as Error;
				
				// Don't retry if we've exhausted our attempts
				if (attempt === this.config.maxRetries) {
					console.error(`${operationName} failed after ${this.config.maxRetries + 1} attempts:`, error);
					throw error;
				}

				// Calculate backoff delay with exponential increase
				const backoffDelay = this.config.initialBackoffDelay * Math.pow(2, attempt);
				
				console.warn(
					`${operationName} failed (attempt ${attempt + 1}/${this.config.maxRetries + 1}). ` +
					`Retrying in ${backoffDelay}ms...`,
					error
				);

				await this.sleep(backoffDelay);
			}
		}

		// This should never be reached, but TypeScript needs it
		throw lastError || new Error(`${operationName} failed after all retry attempts`);
	}

	/**
	 * Generate a streaming response with retry logic
	 */
	generateStreamingResponse(
		request: BaseModelRequest | ExtendedModelRequest,
		onChunk: StreamCallback
	): StreamingModelResponse {
		// For streaming, we need to handle retries differently
		// We can't use executeWithRetry directly because it expects a Promise
		if (!this.wrappedApi.generateStreamingResponse) {
			throw new Error('Wrapped API does not support streaming');
		}
		
		// Return the streaming response directly
		// The retry logic would need to be implemented within the streaming process
		return this.wrappedApi.generateStreamingResponse(request, onChunk);
	}

	/**
	 * Generate a model response with retry logic
	 */
	async generateModelResponse(
		request: BaseModelRequest | ExtendedModelRequest
	): Promise<ModelResponse> {
		return this.executeWithRetry(
			() => this.wrappedApi.generateModelResponse(request),
			'generateModelResponse'
		);
	}
}