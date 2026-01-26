import { requestUrl, RequestUrlParam } from 'obsidian';

/**
 * A fetch implementation that uses Obsidian's requestUrl to bypass CORS restrictions.
 * This is designed to be passed to the GoogleGenAI client.
 */
export async function proxyFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const url = input.toString();

	const reqParam: RequestUrlParam = {
		url: url,
		method: init?.method || 'GET',
		throw: false, // We want to handle status codes manually to match fetch behavior
	};

	// Handle headers
	if (init?.headers) {
		const headers: Record<string, string> = {};
		if (init.headers instanceof Headers) {
			init.headers.forEach((value, key) => {
				headers[key] = value;
			});
		} else if (Array.isArray(init.headers)) {
			init.headers.forEach(([key, value]) => {
				headers[key] = value;
			});
		} else {
			Object.assign(headers, init.headers);
		}
		reqParam.headers = headers;
	}

	// Handle body
	if (init?.body) {
		if (typeof init.body === 'string') {
			reqParam.body = init.body;
		} else if (init.body instanceof ArrayBuffer || ArrayBuffer.isView(init.body)) {
			reqParam.body = init.body as ArrayBuffer;
		} else {
			// Try to stringify if it's an object (though usually fetch expects string/buffer)
			try {
				reqParam.body = JSON.stringify(init.body);
			} catch {
				reqParam.body = String(init.body);
			}
		}
	}

	try {
		const response = await requestUrl(reqParam);

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
