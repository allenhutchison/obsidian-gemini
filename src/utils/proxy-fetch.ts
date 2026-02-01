import { requestUrl, RequestUrlParam, RequestUrlResponse } from 'obsidian';
import {
	executeWithRetry,
	RetryConfig,
	DEFAULT_RETRY_CONFIG,
	isRetryableHttpStatus,
	isTransientNetworkError,
} from './retry';

/**
 * HTTP methods that are safe to retry (idempotent)
 */
const IDEMPOTENT_METHODS = ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'];

/**
 * Check if an HTTP request error or response is retryable
 */
function isRetryableHttpError(error: unknown, status?: number): boolean {
	if (status !== undefined) {
		return isRetryableHttpStatus(status);
	}
	return isTransientNetworkError(error);
}

/**
 * Execute requestUrl with exponential backoff retry for idempotent methods.
 * Exported for use by other tools that need retry logic (e.g., web-fetch-tool).
 */
export async function requestUrlWithRetry(
	reqParam: RequestUrlParam,
	config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<RequestUrlResponse> {
	const method = (reqParam.method || 'GET').toUpperCase();
	const isIdempotent = IDEMPOTENT_METHODS.includes(method);

	// For non-idempotent methods, just make the request without retry
	if (!isIdempotent) {
		return requestUrl(reqParam);
	}

	// For idempotent methods, use retry with custom logic for HTTP status codes
	return executeWithRetry(
		async () => {
			const response = await requestUrl(reqParam);

			// Throw on retryable status codes so the retry logic can handle them
			if (isRetryableHttpStatus(response.status)) {
				const error = new Error(`HTTP ${response.status}`);
				(error as any).status = response.status;
				(error as any).response = response;
				throw error;
			}

			return response;
		},
		config,
		{
			operationName: `HTTP ${method} ${reqParam.url}`,
			isRetryable: (error) => isRetryableHttpError(error),
		}
	);
}

/**
 * Helper function to convert Headers-like objects to a plain object
 */
function headersToObject(headers: HeadersInit): Record<string, string> {
	const result: Record<string, string> = {};
	if (headers instanceof Headers) {
		headers.forEach((value, key) => {
			result[key] = value;
		});
	} else if (Array.isArray(headers)) {
		headers.forEach(([key, value]) => {
			result[key] = value;
		});
	} else {
		Object.assign(result, headers);
	}
	return result;
}

/**
 * Helper function to extract body from a Request object without consuming it
 */
async function extractRequestBody(request: Request): Promise<string | ArrayBuffer | undefined> {
	// Clone the request to avoid consuming the original body
	const cloned = request.clone();

	// Check content-type to determine how to read the body
	const contentType = cloned.headers.get('content-type') || '';

	if (contentType.includes('application/json') || contentType.includes('text/')) {
		const text = await cloned.text();
		return text || undefined;
	} else {
		// For binary data, read as ArrayBuffer
		const buffer = await cloned.arrayBuffer();
		return buffer.byteLength > 0 ? buffer : undefined;
	}
}

/**
 * A fetch implementation that uses Obsidian's requestUrl to bypass CORS restrictions.
 * This is designed to be passed to the GoogleGenAI client.
 */
export async function proxyFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	let url: string;
	let mergedHeaders: Record<string, string> = {};
	let method: string = 'GET';
	let body: string | ArrayBuffer | undefined;

	// Handle Request objects properly
	if (input instanceof Request) {
		// Extract the actual URL from the Request object
		url = input.url;

		// Start with Request's method, headers can override
		method = input.method;

		// Merge headers: Request headers first, then init headers override
		mergedHeaders = headersToObject(input.headers);

		// Extract body from Request if init.body is not provided
		if (init?.body === undefined) {
			body = await extractRequestBody(input);
		}
	} else {
		// URL or string input
		url = input.toString();
	}

	// Apply init overrides
	if (init?.method) {
		method = init.method;
	}

	if (init?.headers) {
		const initHeaders = headersToObject(init.headers);
		// init headers override Request headers
		mergedHeaders = { ...mergedHeaders, ...initHeaders };
	}

	if (init?.body !== undefined) {
		if (typeof init.body === 'string') {
			body = init.body;
		} else if (init.body instanceof ArrayBuffer) {
			body = init.body;
		} else if (ArrayBuffer.isView(init.body)) {
			// Extract the exact byte range from the ArrayBufferView (TypedArray or DataView)
			const view = init.body;
			body = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
		} else {
			// Try to stringify if it's an object (though usually fetch expects string/buffer)
			try {
				body = JSON.stringify(init.body);
			} catch {
				body = String(init.body);
			}
		}
	}

	const reqParam: RequestUrlParam = {
		url: url,
		method: method,
		throw: false, // We want to handle status codes manually to match fetch behavior
	};

	// Only set headers if we have any
	if (Object.keys(mergedHeaders).length > 0) {
		reqParam.headers = mergedHeaders;
	}

	// Only set body if present
	if (body !== undefined) {
		reqParam.body = body;
	}

	try {
		// Use retry wrapper for automatic exponential backoff on idempotent methods
		const response = await requestUrlWithRetry(reqParam);

		// Convert headers to Headers object
		const respHeaders = new Headers(response.headers);

		// Create a standard Response object
		return new Response(response.arrayBuffer, {
			status: response.status,
			statusText: response.status.toString(), // requestUrl doesn't provide statusText
			headers: respHeaders,
		});
	} catch (error) {
		// Network errors from requestUrl should be converted to TypeError to match fetch spec.
		// requestUrl throws on network/formatting errors, etc.
		if (error instanceof Error) {
			throw new TypeError(`Network request failed: ${error.message}`);
		}
		throw error;
	}
}
