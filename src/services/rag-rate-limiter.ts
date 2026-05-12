import type { Logger } from '../utils/logger';
import { isRateLimitError as isRateLimitErrorUtil } from '../utils/error-utils';
import { parseRetryDelay } from '../utils/retry';
import { RATE_LIMIT_BASE_DELAY_MS, RATE_LIMIT_MAX_DELAY_MS, RATE_LIMIT_MAX_RETRIES } from './rag-types';

/**
 * Callbacks for the rate limiter to interact with the service.
 */
export interface RateLimiterCallbacks {
	onStatusChange: (status: 'rate_limited') => void;
	onUpdateStatusBar: () => void;
	onNotifyListeners: () => void;
}

/**
 * Manages rate limit detection, backoff, and retry tracking for the RAG indexing service.
 */
export class RagRateLimiter {
	private logger: Logger;
	private callbacks: RateLimiterCallbacks;
	private consecutiveRateLimits: number = 0;
	private rateLimitResumeTime?: number;
	private rateLimitTimer?: number;

	constructor(logger: Logger, callbacks: RateLimiterCallbacks) {
		this.logger = logger;
		this.callbacks = callbacks;
	}

	/**
	 * Check if an error is a rate limit (429) error from the API.
	 * Delegates to the centralized utility in error-utils.
	 */
	isRateLimitError(error: unknown): boolean {
		return isRateLimitErrorUtil(error);
	}

	/**
	 * Get the current consecutive rate limit count.
	 */
	get consecutiveCount(): number {
		return this.consecutiveRateLimits;
	}

	/**
	 * Maximum retry attempts before failing.
	 */
	get maxRetries(): number {
		return RATE_LIMIT_MAX_RETRIES;
	}

	/**
	 * Handle a rate limit by pausing operations with backoff.
	 * Respects API-provided retry delays when available,
	 * falling back to exponential backoff.
	 */
	async handleRateLimit(error?: unknown): Promise<void> {
		this.consecutiveRateLimits++;

		// Use API-provided retry delay if available, otherwise exponential backoff
		const apiDelay = error ? parseRetryDelay(error) : null;
		const delay =
			apiDelay !== null
				? Math.min(apiDelay, RATE_LIMIT_MAX_DELAY_MS)
				: Math.min(RATE_LIMIT_BASE_DELAY_MS * Math.pow(2, this.consecutiveRateLimits - 1), RATE_LIMIT_MAX_DELAY_MS);

		this.rateLimitResumeTime = Date.now() + delay;
		this.callbacks.onStatusChange('rate_limited');

		this.logger.warn(
			`RAG Indexing: Rate limited. Waiting ${Math.round(delay / 1000)}s before retry ` +
				`(attempt ${this.consecutiveRateLimits})${apiDelay ? ' (API-provided delay)' : ''}`
		);

		// Update status bar with countdown
		this.callbacks.onUpdateStatusBar();
		this.callbacks.onNotifyListeners();

		// Start countdown timer for status bar updates (clear any existing one first)
		if (this.rateLimitTimer) {
			window.clearInterval(this.rateLimitTimer);
		}
		this.rateLimitTimer = window.setInterval(() => {
			this.callbacks.onUpdateStatusBar();
		}, 1000);

		// Wait for cooldown
		await new Promise((resolve) => window.setTimeout(resolve, delay));

		// Clear timer and reset state
		if (this.rateLimitTimer) {
			window.clearInterval(this.rateLimitTimer);
			this.rateLimitTimer = undefined;
		}
		this.rateLimitResumeTime = undefined;
		this.logger.log('RAG Indexing: Rate limit cooldown complete, resuming...');
	}

	/**
	 * Reset rate limit tracking after successful operations.
	 */
	resetTracking(): void {
		this.consecutiveRateLimits = 0;
		this.rateLimitResumeTime = undefined;
		if (this.rateLimitTimer) {
			window.clearInterval(this.rateLimitTimer);
			this.rateLimitTimer = undefined;
		}
	}

	/**
	 * Get remaining seconds until rate limit cooldown ends.
	 */
	getRemainingSeconds(): number {
		if (!this.rateLimitResumeTime) return 0;
		return Math.max(0, Math.ceil((this.rateLimitResumeTime - Date.now()) / 1000));
	}

	/**
	 * Cleanup resources
	 */
	destroy(): void {
		if (this.rateLimitTimer) {
			window.clearInterval(this.rateLimitTimer);
			this.rateLimitTimer = undefined;
		}
		this.rateLimitResumeTime = undefined;
		this.consecutiveRateLimits = 0;
	}
}
