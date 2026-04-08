import { RetryDecorator, RetryConfig } from '../../src/api/retry-decorator';
import { ModelApi, BaseModelRequest, ModelResponse, StreamingModelResponse } from '../../src/api/interfaces/model-api';

// Minimal mock for ModelApi
function createMockApi(responses: Array<ModelResponse | Error>): ModelApi {
	let callCount = 0;
	return {
		generateModelResponse: jest.fn(async () => {
			const response = responses[callCount++];
			if (response instanceof Error) throw response;
			return response;
		}),
		generateStreamingResponse: jest.fn(() => {
			const response = responses[callCount++];
			return {
				complete: response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
				cancel: jest.fn(),
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
		jest.useFakeTimers();
	});

	afterEach(() => {
		jest.useRealTimers();
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
			await jest.advanceTimersByTimeAsync(100);
			const result = await promise;

			expect(result).toEqual(successResponse);
			expect(api.generateModelResponse).toHaveBeenCalledTimes(2);
		});

		test('500 server error is retried and succeeds', async () => {
			const error = Object.assign(new Error('Internal server error'), { status: 500 });
			const api = createMockApi([error, successResponse]);
			const decorator = new RetryDecorator(api, createRetryConfig());

			const promise = decorator.generateModelResponse(dummyRequest);
			await jest.advanceTimersByTimeAsync(100);
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
			const sleepSpy = jest.spyOn(RetryDecorator.prototype as any, 'sleep');
			const decorator = new RetryDecorator(api, createRetryConfig());

			const promise = decorator.generateModelResponse(dummyRequest);
			await jest.advanceTimersByTimeAsync(6000);
			await promise;

			// Should have used the API-provided 5000ms delay instead of the 10ms initial backoff
			expect(sleepSpy).toHaveBeenCalledWith(5000);
			sleepSpy.mockRestore();
		});
	});

	describe('streaming retries', () => {
		test('non-retryable errors are not retried in streaming', async () => {
			const error = Object.assign(new Error('Forbidden'), { status: 403 });
			const api = createMockApi([error]);
			const decorator = new RetryDecorator(api, createRetryConfig());

			const stream = decorator.generateStreamingResponse(dummyRequest, jest.fn());
			await expect(stream.complete).rejects.toThrow('Forbidden');
		});
	});
});
