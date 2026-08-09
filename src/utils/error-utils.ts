/**
 * Utility functions for extracting error messages from API errors.
 *
 * Raw extraction (no translation): `getRawErrorMessage` — `Error` → `.message`, everything else → `String(error)`.
 * Raw extraction with an explicit fallback: `getRawErrorMessageOr` — `Error` → `.message`, everything else → the supplied fallback.
 * User-facing translation (maps provider quirks to friendly guidance): `getErrorMessage`.
 */

/**
 * Coerce an unknown value to a string-keyed record for safe property probing.
 *
 * Error values arriving from SDKs, `fetch`, and JSON payloads are structurally
 * dynamic, so we navigate them as `Record<string, unknown>` and narrow each
 * field at the point of use. Non-objects (including `null`) yield an empty
 * record so property access never throws.
 */
export function asRecord(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/**
 * Whether an error looks like it came from the `openai` SDK's `APIError`
 * hierarchy (`BadRequestError`, `AuthenticationError`, `NotFoundError`, ...):
 * a numeric `status` alongside a `type` or `code` string pulled from the
 * response body's `error.type`/`error.code` fields.
 *
 * Duck-typed on that shape rather than an `instanceof` check against the SDK's
 * error classes, so this stays a provider-agnostic leaf utility with no SDK
 * import — and so a minifier renaming the SDK's class names can't break
 * detection. Gemini's `ApiError` only ever carries `status`, so it can't
 * false-positive here.
 */
function isOpenAIApiError(error: Record<string, unknown>): boolean {
	return typeof error.status === 'number' && (typeof error.type === 'string' || typeof error.code === 'string');
}

/**
 * Extract the `details` array from various Google API error shapes.
 * Google errors may carry details at `error.details`, `error.error.details`,
 * `error.response.data.error.details`, or embedded as JSON in `error.message`.
 */
export function extractErrorDetails(error: unknown): unknown[] {
	if (!error || typeof error !== 'object') return [];
	const err = asRecord(error);

	// Direct details array
	if (Array.isArray(err.details)) return err.details;
	// Nested under .error
	const nestedError = asRecord(err.error);
	if (Array.isArray(nestedError.details)) return nestedError.details;
	// Nested under .response.data.error
	const responseError = asRecord(asRecord(asRecord(err.response).data).error);
	if (Array.isArray(responseError.details)) return responseError.details;

	// Try to parse details from the error message (Google SDK sometimes embeds JSON)
	if (typeof err.message === 'string') {
		try {
			const start = err.message.indexOf('{');
			const end = err.message.lastIndexOf('}');
			if (start !== -1 && end > start) {
				const parsed = asRecord(JSON.parse(err.message.slice(start, end + 1)));
				const details = parsed.details ?? asRecord(parsed.error).details;
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
		const d = asRecord(detail);
		const type = d['@type'];
		if (typeof type === 'string' && (type.includes('QuotaFailure') || type.includes('quotaFailure'))) {
			const violations = Array.isArray(d.violations) ? d.violations : [];
			for (const v of violations) {
				const limit = asRecord(v).limit;
				if (limit === 0 || limit === '0') return true;
			}
		}
	}

	// Fall back to message-based detection for SDK errors that flatten details
	if (error && typeof error === 'object') {
		// No String(error) fallback: base Object stringification ('[object Object]')
		// can never match the keyword checks below.
		const message: unknown = asRecord(error).message;
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
		const message: unknown = asRecord(error).message || '';
		// Numeric messages (e.g. `message: 429`) stringify to something matchable;
		// any other non-string shape could only ever yield '[object Object]'.
		const messageLower =
			typeof message === 'string' ? message.toLowerCase() : typeof message === 'number' ? String(message) : '';
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
 * Check if an error represents a "resource not found" failure (HTTP 404 /
 * NOT_FOUND). Matches on message substrings so it works across the varying
 * error shapes the Google File Search API and SDK return.
 */
export function isNotFoundError(error: unknown): boolean {
	const message = getRawErrorMessage(error);
	return message.includes('404') || message.includes('not found') || message.includes('NOT_FOUND');
}

/**
 * Extract the raw string from an `unknown` error value without any translation.
 *
 * Returns `error.message` for `Error` instances and `String(error)` for everything
 * else. Use this for logging, sidecar `lastError` fields, and tool error returns
 * where the underlying message should pass through untouched. For user-facing
 * surfaces that benefit from provider-specific guidance (Ollama 404 → "ollama pull X",
 * quota → Studio billing, etc.), use `getErrorMessage` instead.
 */
export function getRawErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

/**
 * Extract the raw message from an `unknown` error value, falling back to a caller-supplied
 * string when the value is not an `Error`.
 *
 * Returns `error.message` for `Error` instances and `fallback` for everything else. This is the
 * DRY replacement for the `error instanceof Error ? error.message : '<literal>'` ternary that was
 * duplicated across tool error returns and service throws. Use it when the non-`Error` case should
 * become a fixed label (e.g. `'Unknown error'`) rather than `String(error)`; when the raw value
 * itself is the desired fallback, use `getRawErrorMessage` instead.
 */
export function getRawErrorMessageOr(error: unknown, fallback: string): string {
	return error instanceof Error ? error.message : fallback;
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

		// OpenAI-shaped errors get provider-specific guidance for the two status
		// codes generic wording serves poorly: 401 should point at the OpenAI key
		// specifically, and 404 should mention the endpoint (since a custom base
		// URL — LM Studio, MLX, ... — may simply not have the model). Checked
		// before the generic message-substring checks below so this wins.
		if (isOpenAIApiError(asRecord(error))) {
			const statusCode = extractStatusCode(error);
			if (statusCode === 401) {
				return 'Invalid OpenAI API key. Please check the API key in Settings → Gemini Scribe.';
			}
			if (statusCode === 404) {
				return 'Model not available on this endpoint. Please check your model settings or the configured base URL.';
			}
		}

		// The openai SDK's fetch-layer failures (unreachable custom base URL —
		// LM Studio/MLX not running, wrong port, DNS failure, ...) surface as
		// `APIConnectionError`, whose own `.message` is the fixed, uninformative
		// string "Connection error." — the actionable detail (ECONNREFUSED, etc.)
		// lives on `.cause`, which callers don't reliably get to inspect. Matched
		// on that exact message plus an absent status (real HTTP failures always
		// carry one) rather than an SDK class import, for the same reason as
		// `isOpenAIApiError` above.
		if (message === 'Connection error.' && extractStatusCode(error) === null) {
			return 'Could not connect to the model server. If you configured a custom base URL (LM Studio, MLX, etc.), make sure the server is running and the base URL in settings is correct.';
		}

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

		// Network errors. Match the specific fetch-failure phrasings — "Failed to
		// fetch" (Chromium/Electron) and "fetch failed" (Node/undici) — rather than
		// a bare "fetch" substring, which would misclassify unrelated errors that
		// merely mention fetch (e.g. "proxyFetch injection failed") as connectivity
		// problems and send users to check their connection for the wrong reason.
		if (
			messageLower.includes('failed to fetch') ||
			messageLower.includes('fetch failed') ||
			messageLower.includes('network') ||
			messageLower.includes('econnrefused') ||
			messageLower.includes('etimedout')
		) {
			// Only attribute connection refusals to Ollama when the signal is
			// specific. A bare `ECONNREFUSED` or `localhost` substring could
			// come from any local proxy or test server, and a bare `11434`
			// could appear in unrelated stack traces or paths, so we require
			// either the Ollama keyword or a real `host:11434` endpoint shape.
			const looksLikeOllamaEndpoint =
				/(?:^|[\s(/])(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\]|[\w.-]+):11434\b/.test(messageLower);
			if (messageLower.includes('ollama') || looksLikeOllamaEndpoint) {
				return 'Could not connect to the Ollama daemon. Make sure `ollama serve` is running and the base URL in settings is correct.';
			}
			return 'Network error: Unable to reach the model API. Please check your connection.';
		}

		// Timeout errors
		if (messageLower.includes('timeout') || messageLower.includes('timed out')) {
			return 'Request timed out. The API took too long to respond. Please try again.';
		}

		// Service unavailable
		// Note: only match on "unavailable" — the bare substring "service" appears
		// in non-outage errors like SERVICE_DISABLED (a configuration/permission
		// problem) and would otherwise mislead users to chase a Google outage
		// that isn't happening. Genuine 503s are still covered by the HTTP
		// status-code path in getHttpErrorMessage.
		if (messageLower.includes('unavailable')) {
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
		const err = asRecord(error);

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
		const nestedError = asRecord(err.error);
		if (nestedError.message) {
			// Process nested error message
			if (typeof nestedError.message === 'string') {
				return `API error: ${nestedError.message}`;
			}
			return getErrorMessage(nestedError.message);
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
export function extractStatusCode(error: unknown): number | null {
	// Guard non-object inputs so callers passing `null`, `undefined`, or a
	// primitive (this is an exported helper accepting `unknown`) don't trigger a
	// secondary TypeError inside an already-failing error path.
	if (!error || (typeof error !== 'object' && typeof error !== 'function')) {
		return null;
	}
	const err = asRecord(error);

	// Check common status code properties
	if (typeof err.status === 'number') {
		return err.status;
	}
	if (typeof err.statusCode === 'number') {
		return err.statusCode;
	}
	// ollama-js throws ResponseError with `status_code`
	if (typeof err.status_code === 'number') {
		return err.status_code;
	}
	if (typeof err.code === 'number') {
		return err.code;
	}

	// Check in nested error object
	const nestedError = asRecord(err.error);
	if (typeof nestedError.status === 'number') {
		return nestedError.status;
	}
	if (typeof nestedError.code === 'number') {
		return nestedError.code;
	}

	// Check in response object (fetch API pattern)
	const response = asRecord(err.response);
	if (typeof response.status === 'number') {
		return response.status;
	}

	// Try to extract from error message
	if (typeof err.message === 'string') {
		const match = err.message.match(/(?:status|code)[\s:]+(\d{3})/i);
		if (match) {
			return parseInt(match[1], 10);
		}
	}

	return null;
}

/**
 * Get user-friendly message for HTTP status codes
 */
function getHttpErrorMessage(statusCode: number, error: unknown): string {
	const rawMessage = asRecord(error).message;
	const errorMessage = typeof rawMessage === 'string' ? rawMessage : '';

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
 * Condense an already-stringified error into the first meaningful line,
 * capped at 120 characters.
 *
 * Unlike {@link getErrorMessage}, this takes a raw string rather than an
 * error value — the automation surfaces (scheduled tasks, hooks, background
 * tasks) persist `lastError` as text, so by the time the UI renders it there is
 * no error object left to inspect. It peels off the two shapes those stored
 * strings arrive in: a Gemini JSON blob carrying the human-readable text in a
 * `"message"` field, and an SDK prefix such as `ApiError: [429 Too Many
 * Requests]`.
 */
export function truncateStoredError(raw: string): string {
	// Prefer the human-readable message out of a Gemini JSON error blob,
	// e.g. ApiError: {"error":{"code":429,"message":"You exceeded..."}}
	//
	// The capture keeps backslash escape pairs intact, so an embedded \" does not
	// end it early, and JSON.parse then turns \n and \" back into real characters
	// — without decoding, a multi-line API error renders as one line with a
	// literal "\n" in it. A blob that isn't valid JSON (e.g. a raw newline inside
	// the string) fails to parse; fall back to the captured text rather than
	// dropping the message.
	const jsonMatch = raw.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
	if (jsonMatch) {
		let decoded = jsonMatch[1];
		try {
			decoded = JSON.parse(`"${decoded}"`) as string;
		} catch {
			// Not a well-formed JSON string body — use the raw capture as-is.
		}
		const msg = decoded.split(/[\n]/)[0].trim();
		return msg.length > 120 ? msg.slice(0, 117) + '…' : msg;
	}
	// Otherwise strip the HTTP status prefix like "[429 Too Many Requests] "
	const stripped = raw.replace(/^(ApiError:\s*)?\[\d+ [^\]]+\]\s*/, '').replace(/^ApiError:\s*/, '');
	const firstLine = stripped.split(/[\n.]/)[0].trim();
	return firstLine.length > 120 ? firstLine.slice(0, 117) + '…' : firstLine;
}
