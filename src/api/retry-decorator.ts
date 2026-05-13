/**
 * Simple retry decorator for ModelApi implementations
 *
 * Adds retry logic with exponential backoff to handle transient API failures
 */

import {
	ModelApi,
	BaseModelRequest,
	ExtendedModelRequest,
	ModelResponse,
	StreamCallback,
	StreamingModelResponse,
} from './interfaces/model-api';
import { Logger } from '../utils/logger';
import { isRetryableApiError, parseRetryDelay } from '../utils/retry';

export interface RetryConfig {
	maxRetries: number;
	initialBackoffDelay: number;
}

/**
 * Decorator that adds retry logic to any ModelApi implementation
 */
export class RetryDecorator implements ModelApi {
	private wrappedApi: ModelApi;
	private config: RetryConfig;
	private logger?: Logger;

	constructor(wrappedApi: ModelApi, config: RetryConfig, logger?: Logger) {
		this.wrappedApi = wrappedApi;
		this.config = config;
		this.logger = logger;
	}

	/**
	 * Sleep for a specified number of milliseconds
	 */
	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => window.setTimeout(resolve, ms));
	}

	/** Maximum delay cap when using API-provided retry delays (60 seconds) */
	private static readonly MAX_API_DELAY_MS = 60000;

	/**
	 * Execute a function with retry logic and exponential backoff.
	 *
	 * Non-retryable errors (4xx except 429, or 429 with quota exhaustion)
	 * are thrown immediately without retry. API-provided retry delays
	 * are respected when available, falling back to exponential backoff.
	 */
	private async executeWithRetry<T>(operation: () => Promise<T>, operationName: string): Promise<T> {
		let lastError: Error | undefined;

		for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
			try {
				return await operation();
			} catch (error) {
				lastError = error as Error;

				// Skip retry for non-retryable errors (auth failures, quota exhaustion, etc.)
				if (!isRetryableApiError(error)) {
					this.logger?.error(`${operationName} failed with non-retryable error:`, error);
					throw error;
				}

				// Don't retry if we've exhausted our attempts
				if (attempt === this.config.maxRetries) {
					this.logger?.error(`${operationName} failed after ${this.config.maxRetries + 1} attempts:`, error);
					throw error;
				}

				// Use API-provided retry delay if available, otherwise exponential backoff
				const apiDelay = parseRetryDelay(error);
				const backoffDelay = apiDelay
					? Math.min(apiDelay, RetryDecorator.MAX_API_DELAY_MS)
					: this.config.initialBackoffDelay * Math.pow(2, attempt);

				this.logger?.warn(
					`${operationName} failed (attempt ${attempt + 1}/${this.config.maxRetries + 1}). ` +
						`Retrying in ${backoffDelay}ms${apiDelay ? ' (API-provided delay)' : ''}...`,
					error
				);

				await this.sleep(backoffDelay);
			}
		}

		// This should never be reached, but TypeScript needs it
		throw lastError || new Error(`${operationName} failed after all retry attempts`);
	}

	/**
	 * Generate a non-streaming response with retry logic
	 */
	async generateModelResponse(request: BaseModelRequest | ExtendedModelRequest): Promise<ModelResponse> {
		return this.executeWithRetry(() => this.wrappedApi.generateModelResponse(request), 'generateModelResponse');
	}

	/**
	 * Generate a streaming response with retry logic
	 *
	 * Note: Streaming retries are more complex. If a stream fails mid-stream,
	 * we retry from the beginning. This means chunks may be duplicated.
	 */
	generateStreamingResponse(
		request: BaseModelRequest | ExtendedModelRequest,
		onChunk: StreamCallback
	): StreamingModelResponse {
		if (!this.wrappedApi.generateStreamingResponse) {
			throw new Error('Wrapped API does not support streaming');
		}

		let currentAttempt = 0;
		let cancelled = false;
		let currentStream: StreamingModelResponse | null = null;

		const attemptStream = async (): Promise<ModelResponse> => {
			if (cancelled) {
				throw new Error('Stream was cancelled');
			}

			try {
				currentAttempt++;
				currentStream = this.wrappedApi.generateStreamingResponse!(request, onChunk);
				return await currentStream.complete;
			} catch (error) {
				if (cancelled) {
					throw new Error('Stream was cancelled');
				}

				// Skip retry for non-retryable errors
				if (!isRetryableApiError(error)) {
					this.logger?.error(`Streaming failed with non-retryable error:`, error);
					throw error;
				}

				// Check if we should retry
				if (currentAttempt <= this.config.maxRetries) {
					// Use API-provided retry delay if available, otherwise exponential backoff
					const apiDelay = parseRetryDelay(error);
					const backoffDelay = apiDelay
						? Math.min(apiDelay, RetryDecorator.MAX_API_DELAY_MS)
						: this.config.initialBackoffDelay * Math.pow(2, currentAttempt - 1);

					this.logger?.warn(
						`Streaming failed (attempt ${currentAttempt}/${this.config.maxRetries + 1}). ` +
							`Retrying in ${backoffDelay}ms${apiDelay ? ' (API-provided delay)' : ''}...`,
						error
					);

					await this.sleep(backoffDelay);
					return attemptStream();
				} else {
					this.logger?.error(`Streaming failed after ${this.config.maxRetries + 1} attempts:`, error);
					throw error;
				}
			}
		};

		return {
			complete: attemptStream(),
			cancel: () => {
				cancelled = true;
				if (currentStream) {
					currentStream.cancel();
				}
			},
		};
	}
}
