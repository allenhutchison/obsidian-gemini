import { requestUrl } from 'obsidian';
import { MCP_FETCH_TIMEOUT_MS } from './mcp-constants';

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
 *
 * Applies MCP_FETCH_TIMEOUT_MS as a ceiling on each request. `requestUrl`
 * does not accept an AbortSignal, so when the timer fires we stop waiting
 * but the underlying socket continues until the OS times it out.
 */
export async function obsidianFetch(url: string | URL, init?: RequestInit): Promise<Response> {
	const urlString = url instanceof URL ? url.toString() : url;

	// Honour a pre-aborted caller signal before doing any work.
	if (init?.signal?.aborted) {
		throw new TypeError('Network request failed: aborted');
	}

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

	// Build the request promise (resolves to a Response or throws).
	const requestPromise = requestUrl({
		url: urlString,
		method: init?.method || 'GET',
		headers,
		body,
		throw: false, // Don't throw on 4xx/5xx — let the SDK handle errors
	}).then(
		(response) =>
			new Response(response.text, {
				status: response.status,
				headers: new Headers(response.headers),
			})
	);

	// Race against the fetch-level timeout. We throw the same TypeError shape
	// the existing catch block produced, so the MCP SDK's error handling is
	// unchanged.
	let timer: number | undefined;
	const timeoutPromise = new Promise<never>((_, reject) => {
		timer = window.setTimeout(() => {
			reject(new TypeError(`Network request failed: timed out after ${MCP_FETCH_TIMEOUT_MS}ms`));
		}, MCP_FETCH_TIMEOUT_MS);
	});

	// Also reject if the caller's signal aborts mid-flight. Re-check `aborted`
	// inside the executor in case it flipped between the pre-check at the top
	// of the function and now — this is the standard AbortController idiom.
	let abortHandler: (() => void) | undefined;
	const abortPromise: Promise<never> | undefined = init?.signal
		? new Promise<never>((_, reject) => {
				if (init.signal!.aborted) {
					reject(new TypeError('Network request failed: aborted'));
					return;
				}
				abortHandler = () => reject(new TypeError('Network request failed: aborted'));
				init.signal!.addEventListener('abort', abortHandler, { once: true });
			})
		: undefined;

	try {
		const racers: Array<Promise<Response>> = [requestPromise, timeoutPromise];
		if (abortPromise) racers.push(abortPromise);
		return await Promise.race(racers);
	} catch (error) {
		// Network/timeout/abort — keep the TypeError shape the SDK expects.
		if (error instanceof TypeError) {
			throw error;
		}
		throw new TypeError(`Network request failed: ${error instanceof Error ? error.message : String(error)}`);
	} finally {
		if (timer !== undefined) {
			window.clearTimeout(timer);
		}
		if (abortHandler && init?.signal) {
			init.signal.removeEventListener('abort', abortHandler);
		}
	}
}
