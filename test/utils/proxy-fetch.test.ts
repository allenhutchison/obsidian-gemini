// @vitest-environment node

import { proxyFetch } from '../../src/utils/proxy-fetch';

// Mock Obsidian's requestUrl
const mockRequestUrl = vi.fn();

vi.mock('obsidian', () => ({
	requestUrl: (params: any) => mockRequestUrl(params),
}));

describe('proxyFetch', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('request building', () => {
		it('should make a GET request by default', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 200,
				headers: {},
				arrayBuffer: new ArrayBuffer(0),
			});

			await proxyFetch('https://api.example.com/data');

			expect(mockRequestUrl).toHaveBeenCalledWith({
				url: 'https://api.example.com/data',
				method: 'GET',
				throw: false,
			});
		});

		it('should pass method from init', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 200,
				headers: {},
				arrayBuffer: new ArrayBuffer(0),
			});

			await proxyFetch('https://api.example.com/data', { method: 'POST' });

			expect(mockRequestUrl).toHaveBeenCalledWith(
				expect.objectContaining({
					method: 'POST',
				})
			);
		});

		it('should handle Headers object', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 200,
				headers: {},
				arrayBuffer: new ArrayBuffer(0),
			});

			const headers = new Headers();
			headers.set('Content-Type', 'application/json');
			headers.set('Authorization', 'Bearer token');

			await proxyFetch('https://api.example.com/data', { headers });

			expect(mockRequestUrl).toHaveBeenCalledWith(
				expect.objectContaining({
					headers: {
						'content-type': 'application/json',
						authorization: 'Bearer token',
					},
				})
			);
		});

		it('should handle plain object headers', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 200,
				headers: {},
				arrayBuffer: new ArrayBuffer(0),
			});

			await proxyFetch('https://api.example.com/data', {
				headers: { 'Content-Type': 'application/json' },
			});

			expect(mockRequestUrl).toHaveBeenCalledWith(
				expect.objectContaining({
					headers: { 'Content-Type': 'application/json' },
				})
			);
		});

		it('should handle string body', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 200,
				headers: {},
				arrayBuffer: new ArrayBuffer(0),
			});

			await proxyFetch('https://api.example.com/data', {
				method: 'POST',
				body: '{"key": "value"}',
			});

			expect(mockRequestUrl).toHaveBeenCalledWith(
				expect.objectContaining({
					body: '{"key": "value"}',
				})
			);
		});

		it('should handle ArrayBuffer body', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 200,
				headers: {},
				arrayBuffer: new ArrayBuffer(0),
			});

			const buffer = new ArrayBuffer(8);
			await proxyFetch('https://api.example.com/data', {
				method: 'POST',
				body: buffer,
			});

			expect(mockRequestUrl).toHaveBeenCalledWith(
				expect.objectContaining({
					body: buffer,
				})
			);
		});

		it('should handle Request object input', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 200,
				headers: {},
				arrayBuffer: new ArrayBuffer(0),
			});

			const request = new Request('https://api.example.com/data', {
				method: 'PUT',
				headers: { 'X-Custom': 'value' },
			});

			await proxyFetch(request);

			expect(mockRequestUrl).toHaveBeenCalledWith(
				expect.objectContaining({
					url: 'https://api.example.com/data',
					method: 'PUT',
					headers: expect.objectContaining({
						'x-custom': 'value',
					}),
				})
			);
		});

		it('should extract body from Request when init.body is not provided', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 200,
				headers: {},
				arrayBuffer: new ArrayBuffer(0),
			});

			const request = new Request('https://api.example.com/data', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: '{"key":"value"}',
			});

			await proxyFetch(request);

			expect(mockRequestUrl).toHaveBeenCalledWith(
				expect.objectContaining({
					body: '{"key":"value"}',
				})
			);
		});

		it('should prefer init.body over Request body', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 200,
				headers: {},
				arrayBuffer: new ArrayBuffer(0),
			});

			const request = new Request('https://api.example.com/data', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: '{"from":"request"}',
			});

			await proxyFetch(request, { body: '{"from":"init"}' });

			expect(mockRequestUrl).toHaveBeenCalledWith(
				expect.objectContaining({
					body: '{"from":"init"}',
				})
			);
		});

		it('should merge init headers over Request headers', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 200,
				headers: {},
				arrayBuffer: new ArrayBuffer(0),
			});

			const request = new Request('https://api.example.com/data', {
				headers: { 'X-Req': 'from-request', 'X-Shared': 'request-value' },
			});

			await proxyFetch(request, {
				headers: { 'X-Shared': 'init-value', 'X-Init': 'from-init' },
			});

			expect(mockRequestUrl).toHaveBeenCalledWith(
				expect.objectContaining({
					headers: expect.objectContaining({
						'X-Shared': 'init-value',
						'X-Init': 'from-init',
					}),
				})
			);
		});

		it('should handle ArrayBufferView (Uint8Array) body', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 200,
				headers: {},
				arrayBuffer: new ArrayBuffer(0),
			});

			const data = new Uint8Array([1, 2, 3, 4]);
			await proxyFetch('https://api.example.com/data', {
				method: 'POST',
				body: data,
			});

			const callArg = mockRequestUrl.mock.calls[0][0];
			expect(callArg.body).toBeInstanceOf(ArrayBuffer);
			expect(new Uint8Array(callArg.body)).toEqual(new Uint8Array([1, 2, 3, 4]));
		});

		it('should handle array-style headers', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 200,
				headers: {},
				arrayBuffer: new ArrayBuffer(0),
			});

			await proxyFetch('https://api.example.com/data', {
				headers: [
					['Content-Type', 'application/json'],
					['Authorization', 'Bearer token'],
				],
			});

			expect(mockRequestUrl).toHaveBeenCalledWith(
				expect.objectContaining({
					headers: {
						'Content-Type': 'application/json',
						Authorization: 'Bearer token',
					},
				})
			);
		});

		it('should handle URL object input', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 200,
				headers: {},
				arrayBuffer: new ArrayBuffer(0),
			});

			await proxyFetch(new URL('https://api.example.com/path'));

			expect(mockRequestUrl).toHaveBeenCalledWith(
				expect.objectContaining({
					url: 'https://api.example.com/path',
				})
			);
		});

		it('should handle Request with binary body (non-text content type)', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 200,
				headers: {},
				arrayBuffer: new ArrayBuffer(0),
			});

			const binaryData = new Uint8Array([0xff, 0xd8, 0xff]).buffer;
			const request = new Request('https://api.example.com/upload', {
				method: 'POST',
				headers: { 'Content-Type': 'application/octet-stream' },
				body: binaryData,
			});

			await proxyFetch(request);

			const callArg = mockRequestUrl.mock.calls[0][0];
			expect(callArg.body).toBeInstanceOf(ArrayBuffer);
		});
	});

	describe('response handling', () => {
		it('should return a Response object with correct status', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 201,
				headers: { 'content-type': 'application/json' },
				arrayBuffer: new ArrayBuffer(0),
			});

			const response = await proxyFetch('https://api.example.com/data');

			expect(response).toBeInstanceOf(Response);
			expect(response.status).toBe(201);
		});

		it('should include response headers', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 200,
				headers: {
					'content-type': 'application/json',
					'x-custom-header': 'custom-value',
				},
				arrayBuffer: new ArrayBuffer(0),
			});

			const response = await proxyFetch('https://api.example.com/data');

			expect(response.headers.get('content-type')).toBe('application/json');
			expect(response.headers.get('x-custom-header')).toBe('custom-value');
		});

		it('should include response body', async () => {
			const bodyContent = JSON.stringify({ result: 'success' });
			const encoder = new TextEncoder();
			const arrayBuffer = encoder.encode(bodyContent).buffer;

			mockRequestUrl.mockResolvedValue({
				status: 200,
				headers: { 'content-type': 'application/json' },
				arrayBuffer: arrayBuffer,
			});

			const response = await proxyFetch('https://api.example.com/data');
			const text = await response.text();

			expect(text).toBe(bodyContent);
		});
	});

	describe('error handling', () => {
		it('should throw TypeError on network error', async () => {
			// Use a non-retryable error message to avoid retry delays in tests
			mockRequestUrl.mockRejectedValue(new Error('Invalid URL format'));

			await expect(proxyFetch('https://api.example.com/data')).rejects.toThrow(TypeError);
			await expect(proxyFetch('https://api.example.com/data')).rejects.toThrow(
				'Network request failed: Invalid URL format'
			);
		});

		it('should rethrow non-Error exceptions', async () => {
			mockRequestUrl.mockRejectedValue('Unknown error');

			await expect(proxyFetch('https://api.example.com/data')).rejects.toBe('Unknown error');
		});

		it('should retry on transient network errors for GET requests', async () => {
			// First call fails with transient error, second succeeds
			mockRequestUrl.mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValueOnce({
				status: 200,
				headers: {},
				arrayBuffer: new ArrayBuffer(0),
			});

			const response = await proxyFetch('https://api.example.com/data');

			expect(response.status).toBe(200);
			expect(mockRequestUrl).toHaveBeenCalledTimes(2);
		});

		it('should not retry POST requests on transient errors', async () => {
			mockRequestUrl.mockRejectedValue(new Error('ECONNRESET'));

			await expect(proxyFetch('https://api.example.com/data', { method: 'POST' })).rejects.toThrow(TypeError);
			expect(mockRequestUrl).toHaveBeenCalledTimes(1);
		});

		it('should throw on retryable HTTP status codes (429) since isRetryable does not extract status', async () => {
			// requestUrlWithRetry throws on 429 internally, but the isRetryable callback
			// doesn't extract the status from the error object, so the error propagates
			// as a non-retryable error through proxyFetch.
			mockRequestUrl.mockResolvedValue({
				status: 429,
				headers: {},
				arrayBuffer: new ArrayBuffer(0),
			});

			await expect(proxyFetch('https://api.example.com/data')).rejects.toThrow(TypeError);
			await expect(proxyFetch('https://api.example.com/data')).rejects.toThrow('HTTP 429');
		});
	});

	describe('body edge cases', () => {
		it('should handle non-serializable body by falling back to String()', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 200,
				headers: {},
				arrayBuffer: new ArrayBuffer(0),
			});

			// Create a body value that is not string, ArrayBuffer, or ArrayBufferView.
			// And that also cannot be JSON.stringified (has circular ref).
			const circular: any = {};
			circular.self = circular;

			await proxyFetch('https://api.example.com/data', {
				method: 'POST',
				body: circular as any,
			});

			const callArg = mockRequestUrl.mock.calls[0][0];
			// Falls back to String(body)
			expect(typeof callArg.body).toBe('string');
			expect(callArg.body).toBe('[object Object]');
		});

		it('should handle Request with empty JSON body (empty string)', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 200,
				headers: {},
				arrayBuffer: new ArrayBuffer(0),
			});

			const request = new Request('https://api.example.com/data', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: '',
			});

			await proxyFetch(request);

			const callArg = mockRequestUrl.mock.calls[0][0];
			// Empty string body should not be set (falsy check returns undefined)
			expect(callArg.body).toBeUndefined();
		});

		it('should handle Request with binary body that has zero-length ArrayBuffer', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 200,
				headers: {},
				arrayBuffer: new ArrayBuffer(0),
			});

			const request = new Request('https://api.example.com/data', {
				method: 'POST',
				headers: { 'Content-Type': 'application/octet-stream' },
				body: new ArrayBuffer(0),
			});

			await proxyFetch(request);

			const callArg = mockRequestUrl.mock.calls[0][0];
			// Empty ArrayBuffer body should not be set
			expect(callArg.body).toBeUndefined();
		});

		it('should handle init.method overriding Request.method', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 200,
				headers: {},
				arrayBuffer: new ArrayBuffer(0),
			});

			const request = new Request('https://api.example.com/data', {
				method: 'GET',
			});

			await proxyFetch(request, { method: 'DELETE' });

			expect(mockRequestUrl).toHaveBeenCalledWith(
				expect.objectContaining({
					method: 'DELETE',
				})
			);
		});
	});
});
