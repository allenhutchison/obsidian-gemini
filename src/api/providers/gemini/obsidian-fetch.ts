/**
 * Route the `@google/genai` Interactions (Next-Gen) client through Obsidian's
 * `requestUrl` so its requests bypass renderer CORS.
 *
 * Why this exists: the Next-Gen client issues requests with the renderer's
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
 * https://github.com/googleapis/js-genai/issues/1723. There is also no public
 * hook to supply a custom `fetch`/`fetcher` to the Next-Gen client (feature
 * requests https://github.com/googleapis/js-genai/issues/999 and /1215), which
 * is why this module reaches into SDK internals.
 *
 * How it works (as of `@google/genai` 2.10.0): the plugin calls
 * `ai.interactions.create()`. `ai.interactions` lazily builds a
 * `GeminiNextGenInteractions` (bound to the top-level `apiClient`) and caches it.
 * Each `create()` dispatches via `interactions.getClient(api_version)`, which
 * builds a Next-Gen sub-client (`GoogleGenAI` extends `ClientSDK`) whose
 * `ClientSDK._httpClient.request(req)` calls `this.fetcher(req)` — a
 * `(req: Request) => Promise<Response>` defaulting to the global `fetch`. We wrap
 * `getClient` so every sub-client it returns gets its `_httpClient.fetcher`
 * swapped for {@link obsidianFetcher}.
 *
 * ⚠️ History: a previous version patched `ai.getNextGenClient().fetch`. That was
 * wrong on two counts after the 2.9.0→2.10.0 restructure — it targeted a
 * different service object than `ai.interactions`, and a `.fetch` property the
 * transport no longer consults — so it silently no-op'd and every Interactions
 * request fell through to the global `fetch` and CORS. See issue #1044.
 *
 * ⚠️ Streaming caveat: `requestUrl` buffers the whole response, so a streamed
 * interaction resolves all at once on completion rather than incrementally.
 * Functional, but not token-by-token. Revisit alongside the upstream CORS fix
 * (#1023) — once the Next-Gen client works with the global `fetch`, this shim
 * (and the buffering it imposes) can be removed.
 */
import { requestUrl, type RequestUrlParam } from 'obsidian';

/** Marker so wrapping a given interactions service is idempotent. */
const WRAP_FLAG = '__obsidianFetcherWrapped';

/** Convert a `Headers` object into the plain record `requestUrl` expects. */
function headersToRecord(headers: Headers): Record<string, string> {
	const out: Record<string, string> = {};
	headers.forEach((value, key) => {
		out[key] = value;
	});
	return out;
}

/**
 * A `fetcher`-shaped adapter — `(req: Request) => Promise<Response>` — backed by
 * Obsidian's `requestUrl`. The Next-Gen `HTTPClient` invokes its fetcher with a
 * single WHATWG `Request`, so we read the URL, method, headers, and body off it
 * (the Interactions client only sends JSON-string bodies) and return a real
 * `Response` so the SDK's response handling (`.json()`, `.status`, `.headers`,
 * SSE body reads) works unchanged.
 */
export async function obsidianFetcher(req: Request): Promise<Response> {
	const param: RequestUrlParam = {
		url: req.url,
		method: req.method,
		headers: headersToRecord(req.headers),
		// Return the response regardless of status so the SDK maps HTTP errors
		// itself instead of requestUrl throwing on non-2xx.
		throw: false,
	};

	if (req.method !== 'GET' && req.method !== 'HEAD') {
		const buffer = await req.arrayBuffer();
		if (buffer.byteLength > 0) param.body = buffer;
	}

	const response = await requestUrl(param);
	return new Response(response.arrayBuffer, {
		status: response.status,
		headers: response.headers,
	});
}

/** Swap a Next-Gen sub-client's transport fetcher for {@link obsidianFetcher}. */
function applyFetcher(subClient: unknown): void {
	try {
		const httpClient = (subClient as { _httpClient?: { fetcher?: unknown } } | null)?._httpClient;
		if (httpClient && httpClient.fetcher !== obsidianFetcher) {
			httpClient.fetcher = obsidianFetcher;
		}
	} catch {
		/* Defensive: if SDK internals shift, leave the default fetcher in place. */
	}
}

/**
 * Route a `GoogleGenAI` instance's Interactions requests through Obsidian's
 * `requestUrl`. Wraps `ai.interactions.getClient` so each sub-client it builds
 * gets {@link obsidianFetcher} installed on its transport. Idempotent and
 * defensive: if the SDK internals change shape it silently no-ops and the caller
 * falls back to the SDK's global-`fetch` behaviour. Returns true if the wrap was
 * applied (or was already in place).
 */
export function installObsidianFetch(ai: unknown): boolean {
	let service: { getClient?: unknown; [WRAP_FLAG]?: boolean } | undefined;
	try {
		// Accessing `.interactions` triggers the lazy getter that builds and
		// caches the service the plugin's `ai.interactions.create()` calls use.
		service = (ai as { interactions?: { getClient?: unknown } } | null)?.interactions;
	} catch {
		return false;
	}

	if (!service || typeof service.getClient !== 'function') return false;
	if (service[WRAP_FLAG]) return true;

	const originalGetClient = (service.getClient as (...args: unknown[]) => unknown).bind(service);
	service.getClient = (...args: unknown[]) => {
		const subClient = originalGetClient(...args);
		applyFetcher(subClient);
		return subClient;
	};
	service[WRAP_FLAG] = true;
	return true;
}
