/**
 * Utility functions for extracting user-friendly error messages from API errors
 */

/**
 * Extract the `details` array from various Google API error shapes.
 * Google errors may carry details at `error.details`, `error.error.details`,
 * `error.response.data.error.details`, or embedded as JSON in `error.message`.
 */
export function extractErrorDetails(error: unknown): any[] {
	if (!error || typeof error !== 'object') return [];
	const err = error as any;

	// Direct details array
	if (Array.isArray(err.details)) return err.details;
	// Nested under .error
	if (Array.isArray(err.error?.details)) return err.error.details;
	// Nested under .response.data.error
	if (Array.isArray(err.response?.data?.error?.details)) return err.response.data.error.details;

	// Try to parse details from the error message (Google SDK sometimes embeds JSON)
	if (err.message && typeof err.message === 'string') {
		try {
			const start = err.message.indexOf('{');
			const end = err.message.lastIndexOf('}');
			if (start !== -1 && end > start) {
				const parsed = JSON.parse(err.message.slice(start, end + 1));
				const details = parsed.details ?? parsed.error?.details;
				if (Array.isArray(details)) return details;
			}
		} catch {
			// Not parseable, that's fine
		}
	}

	return [];
}

/**
 * Check if a rate-limit error represents permanent quota exhaustion
 * (as opposed to a transient rate limit that will resolve with backoff).
 *
 * Google returns QuotaFailure details with `limit: 0` when the model
 * has no free-tier quota at all — retrying is futile in this case.
 */
export function isQuotaExhausted(error: unknown): boolean {
	// Check structured details for QuotaFailure with limit: 0
	const details = extractErrorDetails(error);
	for (const detail of details) {
		if (detail['@type']?.includes('QuotaFailure') || detail['@type']?.includes('quotaFailure')) {
			const violations = detail.violations || [];
			for (const v of violations) {
				if (v.limit === 0 || v.limit === '0') return true;
			}
		}
	}

	// Fall back to message-based detection for SDK errors that flatten details
	if (error && typeof error === 'object') {
		const message = (error as any).message || String(error);
		const messageLower = typeof message === 'string' ? message.toLowerCase() : '';
		if (
			messageLower.includes('resource_exhausted') &&
			(messageLower.includes('freetier') ||
				messageLower.includes('free-tier') ||
				messageLower.includes('free tier') ||
				messageLower.includes('limit: 0'))
		) {
			return true;
		}
	}

	return false;
}

/**
 * Check if an error is a rate-limit or quota error (429 / RESOURCE_EXHAUSTED).
 * This includes both transient rate limits and permanent quota exhaustion.
 */
export function isRateLimitError(error: unknown): boolean {
	if (!error) return false;

	const statusCode = extractStatusCode(error);
	if (statusCode === 429) return true;

	if (typeof error === 'object') {
		const message = (error as any).message || '';
		const messageLower = typeof message === 'string' ? message.toLowerCase() : String(error).toLowerCase();
		return (
			messageLower.includes('429') ||
			messageLower.includes('resource_exhausted') ||
			messageLower.includes('rate limit') ||
			messageLower.includes('quota exceeded') ||
			messageLower.includes('too many requests')
		);
	}

	return false;
}

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
		// Check for specific error patterns in the message FIRST so provider-specific
		// guidance (e.g. Ollama 404 "try pulling it first") wins over the generic
		// HTTP status-code mapping below.
		const message = error.message;
		const messageLower = message.toLowerCase();

		// API key errors
		if (
			messageLower.includes('api key') ||
			messageLower.includes('api_key') ||
			messageLower.includes('invalid_api_key')
		) {
			return 'Invalid API key. Please check your model provider credentials in settings.';
		}

		// Authentication/permission errors
		if (
			messageLower.includes('permission') ||
			messageLower.includes('forbidden') ||
			messageLower.includes('unauthorized')
		) {
			return 'Authentication failed. Please verify your model provider credentials and that your account has access to this model.';
		}

		// Rate limiting — distinguish transient from permanent quota exhaustion
		if (
			messageLower.includes('rate limit') ||
			messageLower.includes('quota') ||
			messageLower.includes('resource_exhausted')
		) {
			if (isQuotaExhausted(error)) {
				return 'Free-tier quota exhausted for this model. Try switching to a different model (e.g., Gemini Flash) or enable billing in Google AI Studio.';
			}
			return 'API rate limit exceeded. Please wait a moment and try again.';
		}

		// Model not found
		if (
			messageLower.includes('model') &&
			(messageLower.includes('not found') || messageLower.includes('does not exist'))
		) {
			// Ollama-specific guidance — its server returns "try pulling it first"
			if (messageLower.includes('try pulling')) {
				// Ollama wraps model names in either single- or double-quotes
				// (e.g. `model 'llama3.2' not found, try pulling it first`).
				const match = error.message.match(/model\s+["']?([\w./:-]+)["']?/i);
				const modelName = match ? match[1] : 'this model';
				return `Ollama model not pulled. Run: ollama pull ${modelName}`;
			}
			return 'The selected model is not available. Please check your model settings.';
		}

		// Network errors
		if (
			messageLower.includes('fetch') ||
			messageLower.includes('network') ||
			messageLower.includes('econnrefused') ||
			messageLower.includes('etimedout')
		) {
			// Only attribute connection refusals to Ollama when the signal is
			// specific (the message mentions Ollama or the default port). A bare
			// `ECONNREFUSED` or `localhost` substring could come from any local
			// proxy or test server, so we don't claim it's the daemon.
			if (messageLower.includes('ollama') || messageLower.includes(':11434') || messageLower.includes('11434')) {
				return 'Could not connect to the Ollama daemon. Make sure `ollama serve` is running and the base URL in settings is correct.';
			}
			return 'Network error: Unable to reach the model API. Please check your connection.';
		}

		// Timeout errors
		if (messageLower.includes('timeout') || messageLower.includes('timed out')) {
			return 'Request timed out. The API took too long to respond. Please try again.';
		}

		// Service unavailable
		if (messageLower.includes('unavailable') || messageLower.includes('service')) {
			return 'The model API is temporarily unavailable. Please try again later.';
		}

		// Content filtering/safety
		if (messageLower.includes('safety') || messageLower.includes('blocked')) {
			return 'Content was blocked by safety filters. Please rephrase your request.';
		}

		// HTTP status code mapping runs after the message-based checks above so
		// the provider-specific guidance (e.g. Ollama 404 "try pulling it first")
		// wins over the generic 404 message.
		const statusCode = extractStatusCode(error);
		if (statusCode) {
			return getHttpErrorMessage(statusCode, error);
		}

		// Token limit errors
		if (
			messageLower.includes('token limit') ||
			messageLower.includes('too long') ||
			messageLower.includes('max tokens')
		) {
			return 'Request exceeds token limit. Please reduce the length of your message or conversation history.';
		}

		// If we have a message, return it
		if (message) {
			return `API error: ${message}`;
		}

		// Fallback for Error objects without useful message
		return 'An error occurred while communicating with the model API';
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
	return 'An unknown error occurred while communicating with the model API';
}

/**
 * Extract HTTP status code from error object
 */
export function extractStatusCode(error: any): number | null {
	// Guard non-object inputs so callers passing `null`, `undefined`, or a
	// primitive (this is an exported helper typed as `any`) don't trigger a
	// secondary TypeError inside an already-failing error path.
	if (!error || (typeof error !== 'object' && typeof error !== 'function')) {
		return null;
	}

	// Check common status code properties
	if (typeof error.status === 'number') {
		return error.status;
	}
	if (typeof error.statusCode === 'number') {
		return error.statusCode;
	}
	// ollama-js throws ResponseError with `status_code`
	if (typeof error.status_code === 'number') {
		return error.status_code;
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
			return 'Authentication failed: Invalid API key. Please check your model provider credentials in settings.';
		case 403:
			return 'Access forbidden: The model provider denied access to this model or feature.';
		case 404:
			return 'Model not found: The selected model is not available. Please check your model settings.';
		case 429:
			if (isQuotaExhausted(error)) {
				return 'Free-tier quota exhausted for this model. Try switching to a different model (e.g., Gemini Flash) or enable billing in Google AI Studio.';
			}
			return 'Rate limit exceeded: Too many requests. Please wait a moment and try again.';
		case 500:
			return 'Server error: The model API encountered an internal error. Please try again later.';
		case 503:
			return 'Service unavailable: The model API is temporarily down. Please try again later.';
		case 504:
			return 'Gateway timeout: The API request took too long. Please try again.';
		default:
			if (statusCode >= 500) {
				return `Server error (${statusCode}): The model API is experiencing issues. Please try again later.`;
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
