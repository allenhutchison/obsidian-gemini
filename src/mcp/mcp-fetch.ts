import { requestUrl } from 'obsidian';

/**
 * A fetch-compatible wrapper around Obsidian's `requestUrl`.
 *
 * Obsidian's `requestUrl` bypasses CORS restrictions that the browser's
 * native `fetch` enforces. This is necessary because the MCP SDK uses
 * `fetch` for OAuth metadata discovery, client registration, and token
 * exchange — all of which fail with CORS errors in Electron's renderer.
 *
 * Conforms to the MCP SDK's `FetchLike` type:
 *   `(url: string | URL, init?: RequestInit) => Promise<Response>`
 */
export async function obsidianFetch(url: string | URL, init?: RequestInit): Promise<Response> {
	const urlString = url instanceof URL ? url.toString() : url;

	const headers: Record<string, string> = {};
	if (init?.headers) {
		if (init.headers instanceof Headers) {
			init.headers.forEach((value, key) => {
				headers[key] = value;
			});
		} else if (Array.isArray(init.headers)) {
			for (const [key, value] of init.headers) {
				headers[key] = value;
			}
		} else {
			Object.assign(headers, init.headers);
		}
	}

	let body: string | ArrayBuffer | undefined;
	if (init?.body) {
		if (typeof init.body === 'string') {
			body = init.body;
		} else if (init.body instanceof URLSearchParams) {
			body = init.body.toString();
			if (!headers['Content-Type'] && !headers['content-type']) {
				headers['Content-Type'] = 'application/x-www-form-urlencoded';
			}
		} else if (init.body instanceof ArrayBuffer) {
			body = init.body;
		} else if (ArrayBuffer.isView(init.body)) {
			body = init.body.buffer.slice(init.body.byteOffset, init.body.byteOffset + init.body.byteLength);
		} else {
			throw new TypeError(`Unsupported request body type: ${Object.prototype.toString.call(init.body)}`);
		}
	}

	try {
		const response = await requestUrl({
			url: urlString,
			method: init?.method || 'GET',
			headers,
			body,
			throw: false, // Don't throw on 4xx/5xx — let the SDK handle errors
		});

		// Convert Obsidian's response to a Web API Response object
		// Use response.text as the raw body (requestUrl always provides this)
		return new Response(response.text, {
			status: response.status,
			headers: new Headers(response.headers),
		});
	} catch (error) {
		// For network-level errors, create a Response-like TypeError
		// to match what fetch() would throw
		throw new TypeError(`Network request failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}
