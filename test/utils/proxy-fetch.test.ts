/**
 * @jest-environment node
 */

import { proxyFetch } from '../../src/utils/proxy-fetch';

// Mock Obsidian's requestUrl
const mockRequestUrl = jest.fn();

jest.mock('obsidian', () => ({
	requestUrl: (params: any) => mockRequestUrl(params),
}));

describe('proxyFetch', () => {
	beforeEach(() => {
		jest.clearAllMocks();
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
	});
});
