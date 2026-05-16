import { RetryDecorator, RetryConfig } from '../../src/api/retry-decorator';
import { ModelApi, BaseModelRequest, ModelResponse, StreamingModelResponse } from '../../src/api/interfaces/model-api';
import { Logger } from '../../src/utils/logger';

// Minimal mock for ModelApi
function createMockApi(responses: Array<ModelResponse | Error>): ModelApi {
	let callCount = 0;
	return {
		generateModelResponse: vi.fn(async () => {
			const response = responses[callCount++];
			if (response instanceof Error) throw response;
			return response;
		}),
		generateStreamingResponse: vi.fn(() => {
			const response = responses[callCount++];
			const promise = response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
			// Suppress unhandled rejection detection — the decorator will await this,
			// but there's a microtask gap between creation and the await handler.
			if (response instanceof Error) promise.catch(() => {});
			return {
				complete: promise,
				cancel: vi.fn(),
			} as StreamingModelResponse;
		}),
	};
}

function createRetryConfig(overrides?: Partial<RetryConfig>): RetryConfig {
	return {
		maxRetries: 2,
		initialBackoffDelay: 10, // Very short for tests
		...overrides,
	};
}

const successResponse: ModelResponse = { markdown: 'Hello', rendered: '' };
const dummyRequest: BaseModelRequest = { prompt: 'test' };

describe('RetryDecorator', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe('non-retryable errors', () => {
		test('400 errors are not retried', async () => {
			const error = Object.assign(new Error('Bad request'), { status: 400 });
			const api = createMockApi([error]);
			const decorator = new RetryDecorator(api, createRetryConfig());

			await expect(decorator.generateModelResponse(dummyRequest)).rejects.toThrow('Bad request');
			expect(api.generateModelResponse).toHaveBeenCalledTimes(1);
		});

		test('401 errors are not retried', async () => {
			const error = Object.assign(new Error('Unauthorized'), { status: 401 });
			const api = createMockApi([error]);
			const decorator = new RetryDecorator(api, createRetryConfig());

			await expect(decorator.generateModelResponse(dummyRequest)).rejects.toThrow('Unauthorized');
			expect(api.generateModelResponse).toHaveBeenCalledTimes(1);
		});

		test('403 errors are not retried', async () => {
			const error = Object.assign(new Error('Forbidden'), { status: 403 });
			const api = createMockApi([error]);
			const decorator = new RetryDecorator(api, createRetryConfig());

			await expect(decorator.generateModelResponse(dummyRequest)).rejects.toThrow('Forbidden');
			expect(api.generateModelResponse).toHaveBeenCalledTimes(1);
		});

		test('404 errors are not retried', async () => {
			const error = Object.assign(new Error('Not found'), { status: 404 });
			const api = createMockApi([error]);
			const decorator = new RetryDecorator(api, createRetryConfig());

			await expect(decorator.generateModelResponse(dummyRequest)).rejects.toThrow('Not found');
			expect(api.generateModelResponse).toHaveBeenCalledTimes(1);
		});

		test('429 with quota exhaustion is not retried', async () => {
			const error = Object.assign(new Error('RESOURCE_EXHAUSTED'), {
				status: 429,
				details: [
					{
						'@type': 'type.googleapis.com/google.rpc.QuotaFailure',
						violations: [{ quotaMetric: 'GenerateContentInputTokensPerModelPerDay-FreeTier', limit: 0 }],
					},
				],
			});
			const api = createMockApi([error]);
			const decorator = new RetryDecorator(api, createRetryConfig());

			await expect(decorator.generateModelResponse(dummyRequest)).rejects.toThrow('RESOURCE_EXHAUSTED');
			expect(api.generateModelResponse).toHaveBeenCalledTimes(1);
		});
	});

	describe('retryable errors', () => {
		test('429 transient rate limit is retried and succeeds', async () => {
			const error = Object.assign(new Error('Too many requests'), { status: 429 });
			const api = createMockApi([error, successResponse]);
			const decorator = new RetryDecorator(api, createRetryConfig());

			const promise = decorator.generateModelResponse(dummyRequest);
			// Advance timers to allow retry sleep to resolve
			await vi.advanceTimersByTimeAsync(100);
			const result = await promise;

			expect(result).toEqual(successResponse);
			expect(api.generateModelResponse).toHaveBeenCalledTimes(2);
		});

		test('500 server error is retried and succeeds', async () => {
			const error = Object.assign(new Error('Internal server error'), { status: 500 });
			const api = createMockApi([error, successResponse]);
			const decorator = new RetryDecorator(api, createRetryConfig());

			const promise = decorator.generateModelResponse(dummyRequest);
			await vi.advanceTimersByTimeAsync(100);
			const result = await promise;

			expect(result).toEqual(successResponse);
			expect(api.generateModelResponse).toHaveBeenCalledTimes(2);
		});
	});

	describe('API-provided retry delay', () => {
		test('uses retryDelay from API error response', async () => {
			const error = Object.assign(new Error('Rate limited'), {
				status: 429,
				details: [
					{
						'@type': 'type.googleapis.com/google.rpc.RetryInfo',
						retryDelay: '5s',
					},
				],
			});
			const api = createMockApi([error, successResponse]);
			const decorator = new RetryDecorator(api, createRetryConfig());

			const promise = decorator.generateModelResponse(dummyRequest);

			// Verify that it hasn't resolved before the 5000ms delay has elapsed
			let resolved = false;
			promise.then(() => {
				resolved = true;
			});

			await vi.advanceTimersByTimeAsync(4000);
			expect(resolved).toBe(false);

			// Advance past the remaining delay
			await vi.advanceTimersByTimeAsync(1500);
			await promise;
			expect(resolved).toBe(true);
		});
	});

	describe('streaming retries', () => {
		test('non-retryable errors are not retried in streaming', async () => {
			const error = Object.assign(new Error('Forbidden'), { status: 403 });
			const api = createMockApi([error]);
			const decorator = new RetryDecorator(api, createRetryConfig());

			const stream = decorator.generateStreamingResponse(dummyRequest, vi.fn());
			await expect(stream.complete).rejects.toThrow('Forbidden');
		});

		test('streaming retry succeeds after failure', async () => {
			const error = Object.assign(new Error('Internal server error'), { status: 500 });
			const api = createMockApi([error, successResponse]);
			const decorator = new RetryDecorator(api, createRetryConfig());

			const stream = decorator.generateStreamingResponse(dummyRequest, vi.fn());
			await vi.advanceTimersByTimeAsync(100);
			const result = await stream.complete;

			expect(result).toEqual(successResponse);
			expect(api.generateStreamingResponse).toHaveBeenCalledTimes(2);
		});

		test('streaming exhausts all retries', async () => {
			const error = Object.assign(new Error('Internal server error'), { status: 500 });
			// maxRetries=2 means 3 total attempts, all failing
			const api = createMockApi([error, error, error]);
			const decorator = new RetryDecorator(api, createRetryConfig());

			const stream = decorator.generateStreamingResponse(dummyRequest, vi.fn());
			// Attach rejection handler BEFORE advancing timers to avoid unhandled rejection
			const assertion = expect(stream.complete).rejects.toThrow('Internal server error');
			await vi.advanceTimersByTimeAsync(1000);
			await assertion;
			expect(api.generateStreamingResponse).toHaveBeenCalledTimes(3);
		});

		test('streaming API-provided delay capped at MAX_API_DELAY_MS (60000)', async () => {
			const error = Object.assign(new Error('Rate limited'), {
				status: 429,
				details: [
					{
						'@type': 'type.googleapis.com/google.rpc.RetryInfo',
						retryDelay: '120s',
					},
				],
			});
			const api = createMockApi([error, successResponse]);
			const sleepSpy = vi.spyOn(RetryDecorator.prototype as any, 'sleep');
			const decorator = new RetryDecorator(api, createRetryConfig());

			const stream = decorator.generateStreamingResponse(dummyRequest, vi.fn());
			await vi.advanceTimersByTimeAsync(70000);
			await stream.complete;

			// 120s = 120000ms should be capped to MAX_API_DELAY_MS = 60000ms
			expect(sleepSpy).toHaveBeenCalledWith(60000);
			sleepSpy.mockRestore();
		});
	});

	describe('cancel() propagation', () => {
		test('cancel() sets cancelled and calls currentStream.cancel()', async () => {
			// Use a promise that never resolves so the stream stays active
			const neverResolve = new Promise<ModelResponse>(() => {});
			const cancelFn = vi.fn();
			const api: ModelApi = {
				generateModelResponse: vi.fn(),
				generateStreamingResponse: vi.fn(() => ({
					complete: neverResolve,
					cancel: cancelFn,
				})),
			};
			const decorator = new RetryDecorator(api, createRetryConfig());

			const stream = decorator.generateStreamingResponse(dummyRequest, vi.fn());
			// Let the stream start
			await vi.advanceTimersByTimeAsync(0);
			stream.cancel();

			expect(cancelFn).toHaveBeenCalledTimes(1);
		});

		test('cancel() before stream starts throws Stream was cancelled', async () => {
			const error = Object.assign(new Error('Internal server error'), { status: 500 });
			const api = createMockApi([error, successResponse]);
			const decorator = new RetryDecorator(api, createRetryConfig());

			const stream = decorator.generateStreamingResponse(dummyRequest, vi.fn());
			// Attach rejection handler BEFORE cancel/advance to avoid unhandled rejection
			const assertion = expect(stream.complete).rejects.toThrow('Stream was cancelled');
			// Cancel immediately — before the retry loop can start the next attempt
			stream.cancel();
			await vi.advanceTimersByTimeAsync(1000);
			await assertion;
		});

		test('cancel() during retry wait throws Stream was cancelled', async () => {
			const error = Object.assign(new Error('Internal server error'), { status: 500 });
			const api = createMockApi([error, successResponse]);
			const decorator = new RetryDecorator(api, createRetryConfig({ initialBackoffDelay: 5000 }));

			const stream = decorator.generateStreamingResponse(dummyRequest, vi.fn());
			// Attach rejection handler early to avoid unhandled rejection
			const assertion = expect(stream.complete).rejects.toThrow('Stream was cancelled');
			// Advance past the first failure but not past the full sleep
			await vi.advanceTimersByTimeAsync(100);
			// Cancel during the retry sleep
			stream.cancel();
			// Advance past the sleep so attemptStream runs and sees cancelled=true
			await vi.advanceTimersByTimeAsync(10000);
			await assertion;
		});
	});

	describe('wrapped API without streaming', () => {
		test('throws when wrapped API does not support streaming', () => {
			const api: ModelApi = {
				generateModelResponse: vi.fn(),
				generateStreamingResponse: undefined,
			};
			const decorator = new RetryDecorator(api, createRetryConfig());

			expect(() => decorator.generateStreamingResponse(dummyRequest, vi.fn())).toThrow(
				'Wrapped API does not support streaming'
			);
		});
	});

	describe('non-streaming exhausts all retries', () => {
		test('throws after maxRetries+1 attempts with retryable errors', async () => {
			const error = Object.assign(new Error('Internal server error'), { status: 500 });
			// maxRetries=2 means 3 total attempts
			const api = createMockApi([error, error, error]);
			const decorator = new RetryDecorator(api, createRetryConfig());

			const promise = decorator.generateModelResponse(dummyRequest);
			// Attach rejection handler BEFORE advancing timers
			const assertion = expect(promise).rejects.toThrow('Internal server error');
			await vi.runAllTimersAsync();
			await assertion;
			expect(api.generateModelResponse).toHaveBeenCalledTimes(3);
		});
	});

	describe('logger integration', () => {
		function createMockLogger() {
			return {
				log: vi.fn(),
				debug: vi.fn(),
				warn: vi.fn(),
				error: vi.fn(),
				child: vi.fn(),
			} as unknown as Logger;
		}

		test('warn() called during retries for non-streaming', async () => {
			const error = Object.assign(new Error('Internal server error'), { status: 500 });
			const api = createMockApi([error, successResponse]);
			const mockLogger = createMockLogger();
			const decorator = new RetryDecorator(api, createRetryConfig(), mockLogger);

			const promise = decorator.generateModelResponse(dummyRequest);
			await vi.advanceTimersByTimeAsync(100);
			await promise;

			expect(mockLogger.warn).toHaveBeenCalledTimes(1);
			expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Retrying'), expect.any(Error));
		});

		test('error() called on final failure for non-streaming', async () => {
			const error = Object.assign(new Error('Internal server error'), { status: 500 });
			const api = createMockApi([error, error, error]);
			const mockLogger = createMockLogger();
			const decorator = new RetryDecorator(api, createRetryConfig(), mockLogger);

			const promise = decorator.generateModelResponse(dummyRequest);
			// Attach rejection handler BEFORE advancing timers
			const assertion = expect(promise).rejects.toThrow('Internal server error');
			await vi.runAllTimersAsync();
			await assertion;

			// warn() called for attempts 1 and 2, error() called on final failure
			expect(mockLogger.warn).toHaveBeenCalledTimes(2);
			expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('failed after'), expect.any(Error));
		});

		test('error() called for non-retryable error', async () => {
			const error = Object.assign(new Error('Forbidden'), { status: 403 });
			const api = createMockApi([error]);
			const mockLogger = createMockLogger();
			const decorator = new RetryDecorator(api, createRetryConfig(), mockLogger);

			await expect(decorator.generateModelResponse(dummyRequest)).rejects.toThrow('Forbidden');

			expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('non-retryable'), expect.any(Error));
			expect(mockLogger.warn).not.toHaveBeenCalled();
		});
	});
});
