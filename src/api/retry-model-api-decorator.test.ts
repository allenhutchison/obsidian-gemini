jest.mock('obsidian');

import { RetryModelApiDecorator } from './retry-model-api-decorator';
import {
	ModelApi,
	BaseModelRequest,
	StreamCallback,
	StreamingModelResponse,
	ModelResponse,
} from './interfaces/model-api';

// Mock ModelApi implementation for testing
class MockModelApi implements ModelApi {
	generateModelResponse = jest.fn();
	generateStreamingResponse = jest.fn();
}

describe('RetryModelApiDecorator', () => {
	let mockApi: MockModelApi;
	let retryDecorator: RetryModelApiDecorator;
	let mockPlugin: any;

	beforeEach(() => {
		mockApi = new MockModelApi();
		mockPlugin = {
			settings: {
				maxRetries: 3,
				initialBackoffDelay: 1000,
			},
		};
		retryDecorator = new RetryModelApiDecorator(mockApi, mockPlugin);
		jest.clearAllMocks();
	});

	describe('generateStreamingResponse', () => {
		it('should use streaming API when available', async () => {
			const mockStreamResponse: StreamingModelResponse = {
				complete: Promise.resolve({
					markdown: 'Test response',
					rendered: '',
				}),
				cancel: jest.fn(),
			};

			mockApi.generateStreamingResponse!.mockReturnValue(mockStreamResponse);

			const request: BaseModelRequest = {
				prompt: 'Test prompt',
			};

			const receivedChunks: string[] = [];
			const onChunk: StreamCallback = (chunk: string) => {
				receivedChunks.push(chunk);
			};

			const result = retryDecorator.generateStreamingResponse!(request, onChunk);
			const response = await result.complete;

			expect(mockApi.generateStreamingResponse).toHaveBeenCalledWith(request, expect.any(Function));
			expect(response.markdown).toBe('Test response');
		});

		it('should fallback to non-streaming when streaming not available', async () => {
			// Remove streaming method from mock
			delete (mockApi as any).generateStreamingResponse;

			const mockResponse: ModelResponse = {
				markdown: 'Non-streaming response',
				rendered: '',
			};

			mockApi.generateModelResponse.mockResolvedValue(mockResponse);

			const request: BaseModelRequest = {
				prompt: 'Test prompt',
			};

			const receivedChunks: string[] = [];
			const onChunk: StreamCallback = (chunk: string) => {
				receivedChunks.push(chunk);
			};

			const result = retryDecorator.generateStreamingResponse!(request, onChunk);
			const response = await result.complete;

			expect(mockApi.generateModelResponse).toHaveBeenCalledWith(request);
			expect(receivedChunks).toEqual(['Non-streaming response']);
			expect(response.markdown).toBe('Non-streaming response');
		});

		it('should retry streaming API on failure', async () => {
			let callCount = 0;
			const mockStreamResponse: StreamingModelResponse = {
				complete: Promise.resolve({
					markdown: 'Success after retry',
					rendered: '',
				}),
				cancel: jest.fn(),
			};

			mockApi.generateStreamingResponse!.mockImplementation(() => {
				callCount++;
				if (callCount === 1) {
					return {
						complete: Promise.reject(new Error('API Error')),
						cancel: jest.fn(),
					};
				}
				return mockStreamResponse;
			});

			const request: BaseModelRequest = {
				prompt: 'Test prompt',
			};

			const receivedChunks: string[] = [];
			const onChunk: StreamCallback = (chunk: string) => {
				receivedChunks.push(chunk);
			};

			const result = retryDecorator.generateStreamingResponse!(request, onChunk);
			const response = await result.complete;

			expect(mockApi.generateStreamingResponse).toHaveBeenCalledTimes(2);
			expect(response.markdown).toBe('Success after retry');
		});

		it('should handle streaming cancellation properly', async () => {
			const cancelMock = jest.fn();
			const mockStreamResponse: StreamingModelResponse = {
				complete: new Promise(() => {}), // Never resolves
				cancel: cancelMock,
			};

			mockApi.generateStreamingResponse!.mockReturnValue(mockStreamResponse);

			const request: BaseModelRequest = {
				prompt: 'Test prompt',
			};

			const onChunk: StreamCallback = jest.fn();

			const result = retryDecorator.generateStreamingResponse!(request, onChunk);

			// Cancel the streaming
			result.cancel();

			expect(cancelMock).toHaveBeenCalled();
		});

		it('should fail after max retries for streaming', async () => {
			mockApi.generateStreamingResponse!.mockImplementation(() => ({
				complete: Promise.reject(new Error('Persistent API Error')),
				cancel: jest.fn(),
			}));

			const request: BaseModelRequest = {
				prompt: 'Test prompt',
			};

			const onChunk: StreamCallback = jest.fn();

			const result = retryDecorator.generateStreamingResponse!(request, onChunk);

			await expect(result.complete).rejects.toThrow('Persistent API Error');
			expect(mockApi.generateStreamingResponse).toHaveBeenCalledTimes(3); // Initial + 2 retries
		});

		it('should handle retry logic for streaming failures', async () => {
			let callCount = 0;
			mockApi.generateStreamingResponse!.mockImplementation(() => {
				callCount++;
				if (callCount <= 2) {
					return {
						complete: Promise.reject(new Error('Temporary failure')),
						cancel: jest.fn(),
					};
				}
				return {
					complete: Promise.resolve({
						markdown: 'Success after retries',
						rendered: '',
					}),
					cancel: jest.fn(),
				};
			});

			const request: BaseModelRequest = {
				prompt: 'Test prompt',
			};

			const receivedChunks: string[] = [];
			const onChunk: StreamCallback = (chunk: string) => {
				receivedChunks.push(chunk);
			};

			const result = retryDecorator.generateStreamingResponse!(request, onChunk);
			const response = await result.complete;

			// Should have tried streaming multiple times before success
			expect(mockApi.generateStreamingResponse).toHaveBeenCalledTimes(3);
			expect(response.markdown).toBe('Success after retries');
		});

		it('should handle empty chunk callbacks gracefully', async () => {
			const mockStreamResponse: StreamingModelResponse = {
				complete: Promise.resolve({
					markdown: '',
					rendered: '',
				}),
				cancel: jest.fn(),
			};

			mockApi.generateStreamingResponse!.mockReturnValue(mockStreamResponse);

			const request: BaseModelRequest = {
				prompt: 'Empty test',
			};

			const receivedChunks: string[] = [];
			const onChunk: StreamCallback = (chunk: string) => {
				receivedChunks.push(chunk);
			};

			const result = retryDecorator.generateStreamingResponse!(request, onChunk);
			const response = await result.complete;

			expect(response.markdown).toBe('');
			expect(receivedChunks).toEqual([]);
		});
	});

	describe('generateModelResponse (non-streaming)', () => {
		it('should pass through to decorated API', async () => {
			const mockResponse: ModelResponse = {
				markdown: 'Test response',
				rendered: '',
			};

			mockApi.generateModelResponse.mockResolvedValue(mockResponse);

			const request: BaseModelRequest = {
				prompt: 'Test prompt',
			};

			const response = await retryDecorator.generateModelResponse(request);

			expect(mockApi.generateModelResponse).toHaveBeenCalledWith(request);
			expect(response).toEqual(mockResponse);
		});

		it('should retry non-streaming API on failure', async () => {
			let callCount = 0;
			const mockResponse: ModelResponse = {
				markdown: 'Success after retry',
				rendered: '',
			};

			mockApi.generateModelResponse.mockImplementation(() => {
				callCount++;
				if (callCount === 1) {
					return Promise.reject(new Error('API Error'));
				}
				return Promise.resolve(mockResponse);
			});

			const request: BaseModelRequest = {
				prompt: 'Test prompt',
			};

			const response = await retryDecorator.generateModelResponse(request);

			expect(mockApi.generateModelResponse).toHaveBeenCalledTimes(2);
			expect(response.markdown).toBe('Success after retry');
		});
	});
});
