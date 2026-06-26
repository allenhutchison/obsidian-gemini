/**
 * A WHATWG-`fetch`-compatible adapter backed by Obsidian's `requestUrl`.
 *
 * Why this exists: the `@google/genai` Interactions client (the "Next-Gen" API
 * client behind `client.interactions.*`) issues requests with the renderer's
 * global `fetch`. In Obsidian's Electron renderer that is subject to CORS, and
 * the Interactions endpoint's preflight fails ("Failed to fetch"). Obsidian's
 * `requestUrl` runs in the main process and is not CORS-constrained, so routing
 * the SDK through it makes the calls succeed — the same reason other network
 * tools in this plugin use `requestUrl`.
 *
 * Upstream root cause: the Next-Gen client sends an `Api-Revision` request
 * header that `generativelanguage.googleapis.com` does not list in its
 * `Access-Control-Allow-Headers`, so the browser preflight returns 403 with no
 * `Access-Control-Allow-Origin`. (`models.generateContent` works in the browser
 * because it never sets that header.) Tracked upstream at
 * https://github.com/googleapis/js-genai/issues/1723, where a Google maintainer
 * proposed removing the header from the SDK. There is also no public hook to
 * supply a custom `fetch` to the Next-Gen client (feature requests
 * https://github.com/googleapis/js-genai/issues/999 and /1215), which is why
 * `installObsidianFetch` patches `fetch` onto the lazily constructed client
 * instance (see `GeminiClient.generateViaInteractions`).
 *
 * Revisit when the upstream fix ships — tracked in #1023 (includes a recipe for
 * checking whether Google has fixed it). Even once fixed, routing through
 * `requestUrl` remains harmless and consistent with the plugin's other network
 * calls.
 */
import { requestUrl, type RequestUrlParam } from 'obsidian';

/** Normalize `HeadersInit` (Headers | [k,v][] | record) into a plain record. */
function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
	const out: Record<string, string> = {};
	if (!headers) return out;
	if (headers instanceof Headers) {
		headers.forEach((value, key) => {
			out[key] = value;
		});
	} else if (Array.isArray(headers)) {
		for (const [key, value] of headers) out[key] = value;
	} else {
		Object.assign(out, headers);
	}
	return out;
}

/** Coerce a `fetch` body (string | ArrayBuffer | undefined) into what `requestUrl` accepts. */
function normalizeBody(body: BodyInit | null | undefined): string | ArrayBuffer | undefined {
	if (body == null) return undefined;
	if (typeof body === 'string') return body;
	if (body instanceof ArrayBuffer) return body;
	// The Interactions client only sends JSON string bodies in the non-streaming
	// path; anything else is unexpected, so stringify defensively.
	return String(body);
}

/**
 * `fetch`-shaped function that proxies through Obsidian's `requestUrl` and
 * returns a real `Response`, so the SDK's response handling (`.json()`,
 * `.status`, `.headers`) works unchanged.
 */
export async function obsidianFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

	const param: RequestUrlParam = {
		url,
		method: (init?.method ?? 'GET').toUpperCase(),
		headers: normalizeHeaders(init?.headers),
		// Return the response regardless of status so the SDK maps HTTP errors
		// itself instead of requestUrl throwing on non-2xx.
		throw: false,
	};
	const body = normalizeBody(init?.body);
	if (body !== undefined) param.body = body;

	const response = await requestUrl(param);
	return new Response(response.arrayBuffer, {
		status: response.status,
		headers: response.headers,
	});
}

/**
 * Patch `obsidianFetch` onto a `GoogleGenAI` instance's Next-Gen (Interactions)
 * client so its requests bypass renderer CORS. Idempotent and defensive: if the
 * SDK internals change shape, it silently no-ops and the caller falls back to the
 * SDK's global-`fetch` behaviour. Returns true if the patch was applied (or was
 * already in place).
 */
export function installObsidianFetch(ai: unknown): boolean {
	const getNextGenClient = (ai as { getNextGenClient?: () => { fetch?: unknown; __obsidianFetch?: boolean } })
		?.getNextGenClient;
	if (typeof getNextGenClient !== 'function') return false;

	try {
		const client = getNextGenClient.call(ai);
		if (!client) return false;
		if (client.__obsidianFetch) return true;
		client.fetch = obsidianFetch;
		client.__obsidianFetch = true;
		return true;
	} catch {
		return false;
	}
}
