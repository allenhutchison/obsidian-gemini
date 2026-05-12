vi.mock('../../src/utils/error-utils', () => ({
	isRateLimitError: (error: unknown) => {
		if (!error) return false;
		const msg = error instanceof Error ? error.message : String(error);
		return (
			msg.includes('429') ||
			msg.includes('RESOURCE_EXHAUSTED') ||
			msg.includes('rate limit') ||
			msg.includes('quota exceeded') ||
			msg.includes('too many requests')
		);
	},
}));

vi.mock('../../src/utils/retry', () => ({
	parseRetryDelay: (error: unknown) => {
		if (error && (error as any).retryAfter) {
			return (error as any).retryAfter * 1000;
		}
		return null;
	},
}));

import { RagRateLimiter } from '../../src/services/rag-rate-limiter';

describe('RagRateLimiter', () => {
	let limiter: RagRateLimiter;
	let mockCallbacks: any;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();

		mockCallbacks = {
			onStatusChange: vi.fn(),
			onUpdateStatusBar: vi.fn(),
			onNotifyListeners: vi.fn(),
		};

		const mockLogger = {
			log: vi.fn(),
			debug: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		};

		limiter = new RagRateLimiter(mockLogger as any, mockCallbacks);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe('isRateLimitError', () => {
		it('should detect rate limit errors', () => {
			expect(limiter.isRateLimitError(new Error('429 Too Many Requests'))).toBe(true);
			expect(limiter.isRateLimitError(new Error('RESOURCE_EXHAUSTED'))).toBe(true);
			expect(limiter.isRateLimitError(new Error('rate limit exceeded'))).toBe(true);
		});

		it('should not detect non-rate-limit errors', () => {
			expect(limiter.isRateLimitError(new Error('Network error'))).toBe(false);
			expect(limiter.isRateLimitError(null)).toBe(false);
			expect(limiter.isRateLimitError(undefined)).toBe(false);
		});
	});

	describe('getRemainingSeconds', () => {
		it('should return 0 when no rate limit active', () => {
			expect(limiter.getRemainingSeconds()).toBe(0);
		});

		it('should return remaining seconds', () => {
			(limiter as any).rateLimitResumeTime = Date.now() + 30000;
			const remaining = limiter.getRemainingSeconds();
			expect(remaining).toBeGreaterThanOrEqual(29);
			expect(remaining).toBeLessThanOrEqual(30);
		});
	});

	describe('handleRateLimit', () => {
		it('should set status to rate_limited', async () => {
			const promise = limiter.handleRateLimit();

			expect(mockCallbacks.onStatusChange).toHaveBeenCalledWith('rate_limited');

			vi.advanceTimersByTime(35000);
			await promise;
		});

		it('should increment consecutive count', async () => {
			expect(limiter.consecutiveCount).toBe(0);

			const promise = limiter.handleRateLimit();
			expect(limiter.consecutiveCount).toBe(1);

			vi.advanceTimersByTime(35000);
			await promise;
		});

		it('should start and clear countdown timer', async () => {
			const promise = limiter.handleRateLimit();

			expect((limiter as any).rateLimitTimer).not.toBeUndefined();
			expect(mockCallbacks.onUpdateStatusBar).toHaveBeenCalled();

			vi.advanceTimersByTime(35000);
			await promise;

			expect((limiter as any).rateLimitTimer).toBeUndefined();
		});
	});

	describe('resetTracking', () => {
		it('should clear all rate limit state', () => {
			(limiter as any).consecutiveRateLimits = 3;
			(limiter as any).rateLimitResumeTime = Date.now() + 10000;
			(limiter as any).rateLimitTimer = window.setInterval(() => {}, 1000);

			limiter.resetTracking();

			expect(limiter.consecutiveCount).toBe(0);
			expect(limiter.getRemainingSeconds()).toBe(0);
			expect((limiter as any).rateLimitTimer).toBeUndefined();
		});
	});

	describe('maxRetries', () => {
		it('should return configured max retries', () => {
			expect(limiter.maxRetries).toBe(5);
		});
	});

	describe('destroy', () => {
		it('should clear all state', () => {
			(limiter as any).consecutiveRateLimits = 3;
			(limiter as any).rateLimitTimer = window.setInterval(() => {}, 1000);

			limiter.destroy();

			expect(limiter.consecutiveCount).toBe(0);
			expect((limiter as any).rateLimitTimer).toBeUndefined();
		});
	});
});
