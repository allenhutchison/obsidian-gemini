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
import { isRetryableApiError, executeWithRetry, RetryOptions } from '../utils/retry';

/**
 * Settings-shaped retry configuration for the decorator.
 *
 * Deliberately distinct from `RetryConfig` in `src/utils/retry.ts`: this pair mirrors the
 * `settings.maxRetries` / `settings.initialBackoffDelay` surface, while the retry engine's
 * config also carries the delay cap and jitter switch. The decorator translates between them.
 */
export interface ApiRetryConfig {
	maxRetries: number;
	initialBackoffDelay: number;
}

/**
 * Decorator that adds retry logic to any ModelApi implementation
 */
export class RetryDecorator implements ModelApi {
	private wrappedApi: ModelApi;
	private config: ApiRetryConfig;
	private logger?: Logger;

	constructor(wrappedApi: ModelApi, config: ApiRetryConfig, logger?: Logger) {
		this.wrappedApi = wrappedApi;
		this.config = config;
		this.logger = logger;
	}

	/** Maximum delay cap for retry backoff, whether API-provided or exponential (60 seconds) */
	private static readonly MAX_API_DELAY_MS = 60000;

	/**
	 * Execute a function with retry logic and exponential backoff.
	 *
	 * Both the streaming and non-streaming paths funnel through here, so they share one delay
	 * policy — jitter, the delay cap, and the API-provided-delay decision.
	 */
	private async executeWithRetry<T>(
		operation: () => Promise<T>,
		operationName: string,
		cancellation?: Pick<RetryOptions, 'shouldAbort' | 'abortError'>
	): Promise<T> {
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
				...cancellation,
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
	 *
	 * The retry loop itself is the shared one — cancellation is threaded through as a
	 * `shouldAbort` hook so that this path cannot drift from the non-streaming delay policy.
	 * `cancel()` keeps its shape: it flags the abort and reaches the in-flight stream.
	 */
	generateStreamingResponse(
		request: BaseModelRequest | ExtendedModelRequest,
		onChunk: StreamCallback
	): StreamingModelResponse {
		if (!this.wrappedApi.generateStreamingResponse) {
			throw new Error('Wrapped API does not support streaming');
		}

		let cancelled = false;
		let currentStream: StreamingModelResponse | null = null;

		const complete = this.executeWithRetry<ModelResponse>(
			async () => {
				currentStream = this.wrappedApi.generateStreamingResponse!(request, onChunk);
				return await currentStream.complete;
			},
			'Streaming',
			{
				shouldAbort: () => cancelled,
				abortError: () => new Error('Stream was cancelled'),
			}
		);

		return {
			complete,
			cancel: () => {
				cancelled = true;
				if (currentStream) {
					currentStream.cancel();
				}
			},
		};
	}
}
