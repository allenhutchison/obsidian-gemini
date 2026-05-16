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
import { isRetryableApiError, parseRetryDelay, executeWithRetry } from '../utils/retry';

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
	 */
	private async executeWithRetry<T>(operation: () => Promise<T>, operationName: string): Promise<T> {
		return executeWithRetry(
			operation,
			{
				maxRetries: this.config.maxRetries,
				initialDelayMs: this.config.initialBackoffDelay,
				maxDelayMs: RetryDecorator.MAX_API_DELAY_MS,
			},
			{
				operationName,
				logger: this.logger,
				isRetryable: isRetryableApiError,
			}
		);
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
