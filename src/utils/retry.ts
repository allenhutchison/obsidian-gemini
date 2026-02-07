/**
 * Generic retry utility with exponential backoff.
 * Provides reusable retry logic for any async operation.
 */

import { Logger } from './logger';

/**
 * Configuration for retry behavior
 */
export interface RetryConfig {
	/** Maximum number of retry attempts (default: 3) */
	maxRetries: number;
	/** Initial delay in milliseconds before first retry (default: 1000) */
	initialDelayMs: number;
	/** Maximum delay cap in milliseconds (default: 30000) */
	maxDelayMs?: number;
	/** Whether to add jitter to delays (default: true) */
	jitter?: boolean;
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
	maxRetries: 3,
	initialDelayMs: 1000,
	maxDelayMs: 30000,
	jitter: true,
};

/**
 * Options for a single retry operation
 */
export interface RetryOptions {
	/** Name of the operation for logging purposes */
	operationName: string;
	/** Optional logger for retry attempts */
	logger?: Logger;
	/** Optional function to determine if an error is retryable (default: retry all errors) */
	isRetryable?: (error: unknown) => boolean;
}

/**
 * Sleep for a specified number of milliseconds
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate backoff delay with optional jitter
 */
function calculateDelay(attempt: number, config: RetryConfig): number {
	const baseDelay = config.initialDelayMs * Math.pow(2, attempt);
	const cappedDelay = config.maxDelayMs ? Math.min(baseDelay, config.maxDelayMs) : baseDelay;

	if (config.jitter !== false) {
		// Add 10% jitter
		const jitter = Math.random() * cappedDelay * 0.1;
		return Math.floor(cappedDelay + jitter);
	}

	return cappedDelay;
}

/**
 * Execute an async operation with exponential backoff retry logic.
 *
 * @param operation - The async function to execute
 * @param config - Retry configuration
 * @param options - Operation-specific options
 * @returns The result of the operation
 * @throws The last error if all retries are exhausted
 *
 * @example
 * ```ts
 * const result = await executeWithRetry(
 *   () => fetchData(),
 *   { maxRetries: 3, initialDelayMs: 1000 },
 *   { operationName: 'fetchData', logger: this.logger }
 * );
 * ```
 */
export async function executeWithRetry<T>(
	operation: () => Promise<T>,
	config: RetryConfig = DEFAULT_RETRY_CONFIG,
	options: RetryOptions
): Promise<T> {
	const { operationName, logger, isRetryable } = options;
	let lastError: Error | undefined;

	for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
		try {
			return await operation();
		} catch (error) {
			lastError = error as Error;

			// Check if error is retryable (if filter provided)
			if (isRetryable && !isRetryable(error)) {
				throw error;
			}

			// Don't retry if we've exhausted our attempts
			if (attempt === config.maxRetries) {
				logger?.error(`${operationName} failed after ${config.maxRetries + 1} attempts:`, error);
				throw error;
			}

			const backoffDelay = calculateDelay(attempt, config);

			logger?.warn(
				`${operationName} failed (attempt ${attempt + 1}/${config.maxRetries + 1}). ` +
					`Retrying in ${backoffDelay}ms...`,
				error
			);

			await sleep(backoffDelay);
		}
	}

	// This should never be reached, but TypeScript needs it
	throw lastError || new Error(`${operationName} failed after all retry attempts`);
}

/**
 * Check if an HTTP status code indicates a retryable error
 */
export function isRetryableHttpStatus(status: number): boolean {
	// Retry on 5xx server errors
	if (status >= 500 && status < 600) {
		return true;
	}
	// Retry on 429 (rate limiting)
	if (status === 429) {
		return true;
	}
	return false;
}

/**
 * Check if an error is a transient network error that should be retried
 */
export function isTransientNetworkError(error: unknown): boolean {
	if (error instanceof Error) {
		const message = error.message.toLowerCase();
		// Retry on connection, timeout, and DNS errors
		return (
			message.includes('timeout') ||
			message.includes('econnreset') ||
			message.includes('econnrefused') ||
			message.includes('enotfound') ||
			message.includes('network') ||
			message.includes('dns') ||
			message.includes('socket')
		);
	}
	return false;
}
