/**
 * Generic retry utility with exponential backoff.
 * Provides reusable retry logic for any async operation.
 */

import { Logger } from './logger';
import { extractErrorDetails, extractStatusCode, isQuotaExhausted } from './error-utils';

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

/**
 * Parse the `retryDelay` value from Google API error responses.
 *
 * Google includes a `RetryInfo` detail with a `retryDelay` field
 * formatted as a duration string (e.g., "17s", "1.5s").
 *
 * @returns Delay in milliseconds, or null if not found/parseable
 */
export function parseRetryDelay(error: unknown): number | null {
	if (!error || typeof error !== 'object') return null;

	// Use centralized detail extraction (handles object properties and message-embedded JSON)
	const details = extractErrorDetails(error);

	for (const detail of details) {
		if (detail['@type']?.includes('RetryInfo') || detail['@type']?.includes('retryInfo')) {
			const delay = detail.retryDelay;
			if (typeof delay === 'string') {
				// Parse duration strings like "17s", "1.5s"
				const match = delay.match(/^(\d+(?:\.\d+)?)s$/);
				if (match) {
					return Math.ceil(parseFloat(match[1]) * 1000);
				}
			}
		}
	}

	return null;
}

/**
 * Determine if an API error is retryable.
 *
 * Non-retryable errors (immediate failure):
 *   - 400, 401, 403, 404 (client errors that won't resolve with retry)
 *   - 429 with quota exhausted (permanent, no free-tier quota)
 *
 * Retryable errors (worth retrying with backoff):
 *   - 429 transient rate limits
 *   - 5xx server errors
 *   - Transient network errors (timeout, connection reset, etc.)
 *   - Unknown errors (default to retryable for safety)
 */
export function isRetryableApiError(error: unknown): boolean {
	const statusCode = extractStatusCode(error);

	if (statusCode !== null) {
		// Non-retryable 4xx errors (excluding 429)
		if (statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
			return false;
		}
		// 429: retryable only if not permanent quota exhaustion
		if (statusCode === 429) {
			return !isQuotaExhausted(error);
		}
		// 5xx: always retryable
		if (statusCode >= 500) {
			return true;
		}
	}

	// Check for transient network errors
	if (isTransientNetworkError(error)) {
		return true;
	}

	// For errors with rate-limit/quota messages but no status code,
	// check if it's a permanent quota issue
	if (error && typeof error === 'object') {
		const message = (error as any).message || '';
		const messageLower = typeof message === 'string' ? message.toLowerCase() : '';
		if (
			messageLower.includes('resource_exhausted') ||
			messageLower.includes('quota') ||
			messageLower.includes('rate limit')
		) {
			return !isQuotaExhausted(error);
		}
	}

	// Default: allow retry for unknown error types
	return true;
}
