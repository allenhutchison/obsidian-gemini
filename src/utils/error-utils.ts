/**
 * Utility functions for extracting user-friendly error messages from API errors
 */

/**
 * Extract a user-friendly error message from various error types
 *
 * Handles errors from Google Gemini API, network errors, and generic errors.
 * Returns a human-readable message that can be displayed to users.
 *
 * @param error - The error object to parse
 * @returns A user-friendly error message
 */
export function getErrorMessage(error: unknown): string {
	// Handle null/undefined
	if (!error) {
		return 'An unknown error occurred';
	}

	// Convert to Error object if it's a string
	if (typeof error === 'string') {
		return error;
	}

	// Handle Error objects
	if (error instanceof Error) {
		// Check for HTTP status codes in the error
		const statusCode = extractStatusCode(error);
		if (statusCode) {
			return getHttpErrorMessage(statusCode, error);
		}

		// Check for specific error patterns in the message
		const message = error.message;
		const messageLower = message.toLowerCase();

		// API key errors
		if (messageLower.includes('api key') || messageLower.includes('api_key') || messageLower.includes('invalid_api_key')) {
			return 'Invalid API key. Please check your Google Gemini API key in settings.';
		}

		// Authentication/permission errors
		if (messageLower.includes('permission') || messageLower.includes('forbidden') || messageLower.includes('unauthorized')) {
			return 'Authentication failed. Please verify your API key has access to the Gemini API.';
		}

		// Rate limiting
		if (messageLower.includes('rate limit') || messageLower.includes('quota') || messageLower.includes('resource_exhausted')) {
			return 'API rate limit exceeded. Please wait a moment and try again.';
		}

		// Model not found
		if (messageLower.includes('model') && (messageLower.includes('not found') || messageLower.includes('does not exist'))) {
			return 'The selected model is not available. Please check your model settings.';
		}

		// Network errors
		if (messageLower.includes('fetch') || messageLower.includes('network') || messageLower.includes('econnrefused') || messageLower.includes('etimedout')) {
			return 'Network error: Unable to connect to Google Gemini API. Please check your internet connection.';
		}

		// Timeout errors
		if (messageLower.includes('timeout') || messageLower.includes('timed out')) {
			return 'Request timed out. The API took too long to respond. Please try again.';
		}

		// Service unavailable
		if (messageLower.includes('unavailable') || messageLower.includes('service')) {
			return 'Google Gemini API is temporarily unavailable. Please try again later.';
		}

		// Content filtering/safety
		if (messageLower.includes('safety') || messageLower.includes('blocked')) {
			return 'Content was blocked by safety filters. Please rephrase your request.';
		}

		// Token limit errors
		if (messageLower.includes('token limit') || messageLower.includes('too long') || messageLower.includes('max tokens')) {
			return 'Request exceeds token limit. Please reduce the length of your message or conversation history.';
		}

		// If we have a message, return it
		if (message) {
			return `API error: ${message}`;
		}

		// Fallback for Error objects without useful message
		return 'An error occurred while communicating with the Gemini API';
	}

	// Handle objects with error information
	if (typeof error === 'object') {
		const err = error as any;

		// Check for status code using the extraction function
		const statusCode = extractStatusCode(err);
		if (statusCode !== null) {
			return getHttpErrorMessage(statusCode, err);
		}

		// Check for error message - only recurse if it's an Error object
		if (err.message) {
			// If the message is a string, process it as an error message with prefix
			if (typeof err.message === 'string') {
				return `API error: ${err.message}`;
			}
			// Otherwise recurse (could be nested error object)
			return getErrorMessage(err.message);
		}

		// Check for error description
		if (err.error?.message) {
			// Process nested error message
			if (typeof err.error.message === 'string') {
				return `API error: ${err.error.message}`;
			}
			return getErrorMessage(err.error.message);
		}

		// Try to stringify the error
		try {
			const errorStr = JSON.stringify(err);
			if (errorStr !== '{}') {
				return `API error: ${errorStr}`;
			}
		} catch {
			// JSON.stringify failed, continue to fallback
		}
	}

	// Final fallback
	return 'An unknown error occurred while communicating with the Gemini API';
}

/**
 * Extract HTTP status code from error object
 */
function extractStatusCode(error: any): number | null {
	// Check common status code properties
	if (typeof error.status === 'number') {
		return error.status;
	}
	if (typeof error.statusCode === 'number') {
		return error.statusCode;
	}
	if (typeof error.code === 'number') {
		return error.code;
	}

	// Check in nested error object
	if (error.error) {
		if (typeof error.error.status === 'number') {
			return error.error.status;
		}
		if (typeof error.error.code === 'number') {
			return error.error.code;
		}
	}

	// Check in response object (fetch API pattern)
	if (error.response) {
		if (typeof error.response.status === 'number') {
			return error.response.status;
		}
	}

	// Try to extract from error message
	const match = error.message?.match(/(?:status|code)[\s:]+(\d{3})/i);
	if (match) {
		return parseInt(match[1], 10);
	}

	return null;
}

/**
 * Get user-friendly message for HTTP status codes
 */
function getHttpErrorMessage(statusCode: number, error: any): string {
	const errorMessage = error.message || '';

	switch (statusCode) {
		case 400:
			return 'Bad request: The API request was invalid. Please check your message and try again.';
		case 401:
			return 'Authentication failed: Invalid API key. Please check your Google Gemini API key in settings.';
		case 403:
			return 'Access forbidden: Your API key does not have permission to use this model or feature.';
		case 404:
			return 'Model not found: The selected model is not available. Please check your model settings.';
		case 429:
			return 'Rate limit exceeded: Too many requests. Please wait a moment and try again.';
		case 500:
			return 'Server error: Google Gemini API encountered an internal error. Please try again later.';
		case 503:
			return 'Service unavailable: Google Gemini API is temporarily down. Please try again later.';
		case 504:
			return 'Gateway timeout: The API request took too long. Please try again.';
		default:
			if (statusCode >= 500) {
				return `Server error (${statusCode}): Google Gemini API is experiencing issues. Please try again later.`;
			}
			if (statusCode >= 400) {
				return `Client error (${statusCode}): ${errorMessage || 'Please check your request and try again.'}`;
			}
			return `HTTP error ${statusCode}: ${errorMessage || 'An unexpected error occurred.'}`;
	}
}

/**
 * Get a shortened error message suitable for inline display
 * (e.g., in status bars or small UI elements)
 */
export function getShortErrorMessage(error: unknown): string {
	const fullMessage = getErrorMessage(error);

	// Extract just the first sentence or clause
	const firstSentence = fullMessage.split(/[:.]/)[0];

	// If it's still too long, truncate it
	if (firstSentence.length > 80) {
		return firstSentence.substring(0, 77) + '...';
	}

	return firstSentence;
}
