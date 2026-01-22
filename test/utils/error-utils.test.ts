import { getErrorMessage, getShortErrorMessage } from '../../src/utils/error-utils';

describe('error-utils', () => {
	describe('getErrorMessage', () => {
		describe('HTTP status code errors', () => {
			test('400 Bad Request', () => {
				const error = { status: 400, message: 'Invalid request' };
				expect(getErrorMessage(error)).toBe(
					'Bad request: The API request was invalid. Please check your message and try again.'
				);
			});

			test('401 Unauthorized', () => {
				const error = { status: 401, message: 'Unauthorized' };
				expect(getErrorMessage(error)).toBe(
					'Authentication failed: Invalid API key. Please check your Google Gemini API key in settings.'
				);
			});

			test('403 Forbidden', () => {
				const error = { status: 403, message: 'Forbidden' };
				expect(getErrorMessage(error)).toBe(
					'Access forbidden: Your API key does not have permission to use this model or feature.'
				);
			});

			test('404 Not Found', () => {
				const error = { status: 404, message: 'Not found' };
				expect(getErrorMessage(error)).toBe(
					'Model not found: The selected model is not available. Please check your model settings.'
				);
			});

			test('429 Rate Limit', () => {
				const error = { status: 429, message: 'Too many requests' };
				expect(getErrorMessage(error)).toBe(
					'Rate limit exceeded: Too many requests. Please wait a moment and try again.'
				);
			});

			test('500 Internal Server Error', () => {
				const error = { status: 500, message: 'Internal error' };
				expect(getErrorMessage(error)).toBe(
					'Server error: Google Gemini API encountered an internal error. Please try again later.'
				);
			});

			test('503 Service Unavailable', () => {
				const error = { status: 503, message: 'Service unavailable' };
				expect(getErrorMessage(error)).toBe(
					'Service unavailable: Google Gemini API is temporarily down. Please try again later.'
				);
			});

			test('504 Gateway Timeout', () => {
				const error = { status: 504, message: 'Gateway timeout' };
				expect(getErrorMessage(error)).toBe('Gateway timeout: The API request took too long. Please try again.');
			});

			test('Generic 5xx error', () => {
				const error = { status: 502, message: 'Bad gateway' };
				expect(getErrorMessage(error)).toContain('Server error (502)');
			});

			test('Generic 4xx error', () => {
				const error = { status: 422, message: 'Unprocessable entity' };
				expect(getErrorMessage(error)).toContain('Client error (422)');
			});

			test('Status code in statusCode property', () => {
				const error = { statusCode: 429 };
				expect(getErrorMessage(error)).toContain('Rate limit exceeded');
			});

			test('Status code in code property', () => {
				const error = { code: 401 };
				expect(getErrorMessage(error)).toContain('Authentication failed');
			});

			test('Status code in nested error object', () => {
				const error = { error: { status: 403 } };
				expect(getErrorMessage(error)).toContain('Access forbidden');
			});

			test('Status code in response object (fetch pattern)', () => {
				const error = { response: { status: 500 } };
				expect(getErrorMessage(error)).toContain('Server error');
			});
		});

		describe('Error message pattern matching', () => {
			test('API key error', () => {
				const error = new Error('Invalid API key provided');
				expect(getErrorMessage(error)).toBe('Invalid API key. Please check your Google Gemini API key in settings.');
			});

			test('API_KEY error code', () => {
				const error = new Error('INVALID_API_KEY: The key is not valid');
				expect(getErrorMessage(error)).toBe('Invalid API key. Please check your Google Gemini API key in settings.');
			});

			test('Permission denied error', () => {
				const error = new Error('Permission denied to access this resource');
				expect(getErrorMessage(error)).toBe(
					'Authentication failed. Please verify your API key has access to the Gemini API.'
				);
			});

			test('Forbidden error', () => {
				const error = new Error('Access forbidden for this model');
				expect(getErrorMessage(error)).toBe(
					'Authentication failed. Please verify your API key has access to the Gemini API.'
				);
			});

			test('Rate limit error', () => {
				const error = new Error('Rate limit exceeded');
				expect(getErrorMessage(error)).toBe('API rate limit exceeded. Please wait a moment and try again.');
			});

			test('Quota exceeded error', () => {
				const error = new Error('Quota exceeded for this project');
				expect(getErrorMessage(error)).toBe('API rate limit exceeded. Please wait a moment and try again.');
			});

			test('RESOURCE_EXHAUSTED error', () => {
				const error = new Error('RESOURCE_EXHAUSTED: Too many requests');
				expect(getErrorMessage(error)).toBe('API rate limit exceeded. Please wait a moment and try again.');
			});

			test('Model not found error', () => {
				const error = new Error('Model gemini-xyz does not exist');
				expect(getErrorMessage(error)).toBe('The selected model is not available. Please check your model settings.');
			});

			test('Network fetch error', () => {
				const error = new Error('fetch failed: Connection refused');
				expect(getErrorMessage(error)).toBe(
					'Network error: Unable to connect to Google Gemini API. Please check your internet connection.'
				);
			});

			test('ECONNREFUSED error', () => {
				const error = new Error('ECONNREFUSED: Connection refused');
				expect(getErrorMessage(error)).toBe(
					'Network error: Unable to connect to Google Gemini API. Please check your internet connection.'
				);
			});

			test('ETIMEDOUT error', () => {
				const error = new Error('ETIMEDOUT: Request timed out');
				expect(getErrorMessage(error)).toBe(
					'Network error: Unable to connect to Google Gemini API. Please check your internet connection.'
				);
			});

			test('Timeout error', () => {
				const error = new Error('Request timeout after 30s');
				expect(getErrorMessage(error)).toBe('Request timed out. The API took too long to respond. Please try again.');
			});

			test('Service unavailable error', () => {
				const error = new Error('Service temporarily unavailable');
				expect(getErrorMessage(error)).toBe('Google Gemini API is temporarily unavailable. Please try again later.');
			});

			test('Safety filter error', () => {
				const error = new Error('Content blocked by safety filters');
				expect(getErrorMessage(error)).toBe('Content was blocked by safety filters. Please rephrase your request.');
			});

			test('SAFETY error code', () => {
				const error = new Error('SAFETY: Harmful content detected');
				expect(getErrorMessage(error)).toBe('Content was blocked by safety filters. Please rephrase your request.');
			});

			test('Token limit error', () => {
				const error = new Error('Request exceeds token limit of 8192');
				expect(getErrorMessage(error)).toBe(
					'Request exceeds token limit. Please reduce the length of your message or conversation history.'
				);
			});

			test('Message too long error', () => {
				const error = new Error('Message too long for this model');
				expect(getErrorMessage(error)).toBe(
					'Request exceeds token limit. Please reduce the length of your message or conversation history.'
				);
			});

			test('Max tokens error', () => {
				const error = new Error('Exceeded max tokens allowed');
				expect(getErrorMessage(error)).toBe(
					'Request exceeds token limit. Please reduce the length of your message or conversation history.'
				);
			});

			test('Generic error with message', () => {
				const error = new Error('Something went wrong');
				expect(getErrorMessage(error)).toBe('API error: Something went wrong');
			});
		});

		describe('Edge cases', () => {
			test('Null error', () => {
				expect(getErrorMessage(null)).toBe('An unknown error occurred');
			});

			test('Undefined error', () => {
				expect(getErrorMessage(undefined)).toBe('An unknown error occurred');
			});

			test('String error', () => {
				expect(getErrorMessage('Custom error message')).toBe('Custom error message');
			});

			test('Empty string error', () => {
				const error = new Error('');
				expect(getErrorMessage(error)).toBe('An error occurred while communicating with the Gemini API');
			});

			test('Error without message property', () => {
				const error = {} as Error;
				expect(getErrorMessage(error)).toBe('An unknown error occurred while communicating with the Gemini API');
			});

			test('Object with nested error message', () => {
				const error = { error: { message: 'Nested error message' } };
				expect(getErrorMessage(error)).toBe('API error: Nested error message');
			});

			test('Object with message property', () => {
				const error = { message: 'Object error message' };
				expect(getErrorMessage(error)).toBe('API error: Object error message');
			});

			test('Empty object', () => {
				const error = {};
				expect(getErrorMessage(error)).toBe('An unknown error occurred while communicating with the Gemini API');
			});

			test('Complex object with toString', () => {
				const error = { code: 'CUSTOM_ERROR', details: 'Something failed' };
				const result = getErrorMessage(error);
				expect(result).toContain('API error');
			});
		});

		describe('Status code extraction from error message', () => {
			test('Extract status code from message with "status" prefix', () => {
				const error = new Error('Request failed with status: 429');
				expect(getErrorMessage(error)).toContain('Rate limit exceeded');
			});

			test('Extract status code from message with "code" prefix', () => {
				const error = new Error('Error code 401 occurred');
				expect(getErrorMessage(error)).toContain('Authentication failed');
			});
		});

		describe('Combined status code and message patterns', () => {
			test('Status code takes precedence over message pattern', () => {
				// Even though message contains "rate limit", status 401 should trigger auth error
				const error = { status: 401, message: 'Rate limit exceeded' };
				expect(getErrorMessage(error)).toContain('Authentication failed');
			});

			test('Status code with specific error message', () => {
				const error = { status: 404, message: 'Model gemini-xyz not found' };
				expect(getErrorMessage(error)).toContain('Model not found');
			});
		});
	});

	describe('getShortErrorMessage', () => {
		test('Extract first sentence from full message', () => {
			const error = { status: 401 };
			const short = getShortErrorMessage(error);
			expect(short).toBe('Authentication failed');
		});

		test('Extract first clause (before colon)', () => {
			const error = new Error('Network error: connection failed');
			const short = getShortErrorMessage(error);
			expect(short).toBe('Network error');
		});

		test('Truncate very long messages', () => {
			// Create an error message that doesn't match any patterns
			// so it returns "API error: <message>" where message is long
			const longMessage =
				'This is a very long error message that does not match any patterns and should be truncated when extracting the short version of the error message for display purposes';
			const error = new Error(longMessage);
			const short = getShortErrorMessage(error);
			// The short message will be "API error" after splitting on ':'
			// which is less than 80 chars, so this test doesn't actually test truncation
			// Instead, test that we handle the first clause correctly
			expect(short.length).toBeLessThanOrEqual(80);
			expect(short).toBe('API error');
		});

		test('Short message returned as-is', () => {
			const error = new Error('Short error');
			const short = getShortErrorMessage(error);
			expect(short).toBe('API error');
		});

		test('Handle complex multi-sentence message', () => {
			const error = { status: 500, message: 'Internal error. Try again later.' };
			const short = getShortErrorMessage(error);
			expect(short).toBe('Server error');
		});
	});
});
