import {
	parseRetryDelay,
	isRetryableApiError,
	isRetryableHttpStatus,
	isTransientNetworkError,
	executeWithRetry,
} from '../../src/utils/retry';

describe('retry utilities', () => {
	describe('parseRetryDelay', () => {
		test('parses integer seconds from RetryInfo details', () => {
			const error = {
				details: [
					{
						'@type': 'type.googleapis.com/google.rpc.RetryInfo',
						retryDelay: '17s',
					},
				],
			};
			expect(parseRetryDelay(error)).toBe(17000);
		});

		test('parses fractional seconds', () => {
			const error = {
				details: [
					{
						'@type': 'type.googleapis.com/google.rpc.RetryInfo',
						retryDelay: '1.5s',
					},
				],
			};
			expect(parseRetryDelay(error)).toBe(1500);
		});

		test('parses details nested under .error', () => {
			const error = {
				error: {
					details: [
						{
							'@type': 'type.googleapis.com/google.rpc.RetryInfo',
							retryDelay: '5s',
						},
					],
				},
			};
			expect(parseRetryDelay(error)).toBe(5000);
		});

		test('returns null when no RetryInfo detail present', () => {
			const error = {
				details: [
					{
						'@type': 'type.googleapis.com/google.rpc.QuotaFailure',
						violations: [],
					},
				],
			};
			expect(parseRetryDelay(error)).toBeNull();
		});

		test('returns null for null/undefined errors', () => {
			expect(parseRetryDelay(null)).toBeNull();
			expect(parseRetryDelay(undefined)).toBeNull();
		});

		test('returns null when no details array exists', () => {
			const error = { status: 429, message: 'Too many requests' };
			expect(parseRetryDelay(error)).toBeNull();
		});

		test('returns null for invalid delay format', () => {
			const error = {
				details: [
					{
						'@type': 'type.googleapis.com/google.rpc.RetryInfo',
						retryDelay: 'invalid',
					},
				],
			};
			expect(parseRetryDelay(error)).toBeNull();
		});

		test('returns null for non-object errors', () => {
			expect(parseRetryDelay('string error')).toBeNull();
			expect(parseRetryDelay(42)).toBeNull();
		});

		test('rounds up fractional milliseconds', () => {
			const error = {
				details: [
					{
						'@type': 'type.googleapis.com/google.rpc.RetryInfo',
						retryDelay: '0.001s',
					},
				],
			};
			expect(parseRetryDelay(error)).toBe(1);
		});

		test('parses RetryInfo embedded as JSON in error message', () => {
			const error = new Error(
				'RESOURCE_EXHAUSTED: {"error":{"details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"1.7s"}]}}'
			);
			expect(parseRetryDelay(error)).toBe(Math.ceil(1.7 * 1000));
		});

		test('parses RetryInfo from flat details in error message', () => {
			const error = new Error(
				'Rate limited: {"details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"10s"}]}'
			);
			expect(parseRetryDelay(error)).toBe(10000);
		});
	});

	describe('isRetryableApiError', () => {
		test('400 Bad Request is not retryable', () => {
			const error = { status: 400, message: 'Bad request' };
			expect(isRetryableApiError(error)).toBe(false);
		});

		test('401 Unauthorized is not retryable', () => {
			const error = { status: 401, message: 'Unauthorized' };
			expect(isRetryableApiError(error)).toBe(false);
		});

		test('403 Forbidden is not retryable', () => {
			const error = { status: 403, message: 'Forbidden' };
			expect(isRetryableApiError(error)).toBe(false);
		});

		test('404 Not Found is not retryable', () => {
			const error = { status: 404, message: 'Not found' };
			expect(isRetryableApiError(error)).toBe(false);
		});

		test('429 transient rate limit is retryable', () => {
			const error = { status: 429, message: 'Too many requests' };
			expect(isRetryableApiError(error)).toBe(true);
		});

		test('429 with quota exhaustion is not retryable', () => {
			const error = {
				status: 429,
				message: 'RESOURCE_EXHAUSTED',
				details: [
					{
						'@type': 'type.googleapis.com/google.rpc.QuotaFailure',
						violations: [{ quotaMetric: 'GenerateContentInputTokensPerModelPerDay-FreeTier', limit: 0 }],
					},
				],
			};
			expect(isRetryableApiError(error)).toBe(false);
		});

		test('500 Internal Server Error is retryable', () => {
			const error = { status: 500, message: 'Internal error' };
			expect(isRetryableApiError(error)).toBe(true);
		});

		test('503 Service Unavailable is retryable', () => {
			const error = { status: 503, message: 'Service unavailable' };
			expect(isRetryableApiError(error)).toBe(true);
		});

		test('network timeout error is retryable', () => {
			const error = new Error('Request timeout after 30s');
			expect(isRetryableApiError(error)).toBe(true);
		});

		test('connection refused error is retryable', () => {
			const error = new Error('ECONNREFUSED');
			expect(isRetryableApiError(error)).toBe(true);
		});

		test('unknown error defaults to retryable', () => {
			const error = new Error('Something unexpected happened');
			expect(isRetryableApiError(error)).toBe(true);
		});

		test('RESOURCE_EXHAUSTED with FreeTier message is not retryable', () => {
			const error = new Error('RESOURCE_EXHAUSTED: quotaMetric: GenerateContentInputTokensPerModelPerDay-FreeTier');
			expect(isRetryableApiError(error)).toBe(false);
		});

		test('RESOURCE_EXHAUSTED without FreeTier message is retryable', () => {
			const error = new Error('RESOURCE_EXHAUSTED: Too many requests per minute');
			expect(isRetryableApiError(error)).toBe(true);
		});

		test('quota message without status code and without FreeTier is retryable', () => {
			const error = { message: 'rate limit exceeded temporarily' };
			expect(isRetryableApiError(error)).toBe(true);
		});
	});

	describe('isRetryableHttpStatus', () => {
		test('returns true for 500', () => {
			expect(isRetryableHttpStatus(500)).toBe(true);
		});

		test('returns true for 503', () => {
			expect(isRetryableHttpStatus(503)).toBe(true);
		});

		test('returns true for 429', () => {
			expect(isRetryableHttpStatus(429)).toBe(true);
		});

		test('returns false for 200', () => {
			expect(isRetryableHttpStatus(200)).toBe(false);
		});

		test('returns false for 400', () => {
			expect(isRetryableHttpStatus(400)).toBe(false);
		});
	});

	describe('isTransientNetworkError', () => {
		test('returns true for timeout errors', () => {
			expect(isTransientNetworkError(new Error('Connection timeout'))).toBe(true);
		});

		test('returns true for ECONNRESET', () => {
			expect(isTransientNetworkError(new Error('ECONNRESET'))).toBe(true);
		});

		test('returns true for ECONNREFUSED', () => {
			expect(isTransientNetworkError(new Error('ECONNREFUSED'))).toBe(true);
		});

		test('returns true for ENOTFOUND', () => {
			expect(isTransientNetworkError(new Error('ENOTFOUND'))).toBe(true);
		});

		test('returns true for network errors', () => {
			expect(isTransientNetworkError(new Error('network error'))).toBe(true);
		});

		test('returns true for dns errors', () => {
			expect(isTransientNetworkError(new Error('dns resolution failed'))).toBe(true);
		});

		test('returns true for socket errors', () => {
			expect(isTransientNetworkError(new Error('socket hang up'))).toBe(true);
		});

		test('returns false for non-transient errors', () => {
			expect(isTransientNetworkError(new Error('Invalid URL'))).toBe(false);
		});

		test('returns false for non-Error values', () => {
			expect(isTransientNetworkError('string error')).toBe(false);
			expect(isTransientNetworkError(42)).toBe(false);
			expect(isTransientNetworkError(null)).toBe(false);
		});
	});

	describe('executeWithRetry', () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		test('returns the result on first success', async () => {
			const op = vi.fn().mockResolvedValue('ok');
			const result = await executeWithRetry(
				op,
				{ maxRetries: 3, initialDelayMs: 100, jitter: false },
				{ operationName: 'test' }
			);
			expect(result).toBe('ok');
			expect(op).toHaveBeenCalledTimes(1);
		});

		test('retries and succeeds on second attempt', async () => {
			const op = vi.fn().mockRejectedValueOnce(new Error('fail')).mockResolvedValue('ok');

			const promise = executeWithRetry(
				op,
				{ maxRetries: 3, initialDelayMs: 100, jitter: false },
				{ operationName: 'test' }
			);
			// Flush all pending timers
			await vi.runAllTimersAsync();

			const result = await promise;
			expect(result).toBe('ok');
			expect(op).toHaveBeenCalledTimes(2);
		});

		test('throws after exhausting all retries and logs error with logger', async () => {
			vi.useRealTimers();
			const mockLogger = { log: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() };
			const op = vi.fn().mockImplementation(() => Promise.reject(new Error('persistent failure')));

			await expect(
				executeWithRetry(
					op,
					{ maxRetries: 2, initialDelayMs: 1, jitter: false },
					{ operationName: 'testOp', logger: mockLogger as any }
				)
			).rejects.toThrow('persistent failure');

			expect(op).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
			expect(mockLogger.error).toHaveBeenCalledWith(
				expect.stringContaining('testOp failed after 3 attempts'),
				expect.any(Error)
			);
			expect(mockLogger.warn).toHaveBeenCalled();
			vi.useFakeTimers();
		});

		test('does not retry when isRetryable returns false', async () => {
			const op = vi.fn().mockRejectedValue(new Error('not retryable'));

			await expect(
				executeWithRetry(
					op,
					{ maxRetries: 3, initialDelayMs: 100, jitter: false },
					{ operationName: 'test', isRetryable: () => false }
				)
			).rejects.toThrow('not retryable');
			expect(op).toHaveBeenCalledTimes(1);
		});
	});
});
