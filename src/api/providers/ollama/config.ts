/** Default endpoint for a local Ollama daemon. */
export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';

/** Ollama's hosted API, reached directly with an API key. */
export const OLLAMA_CLOUD_BASE_URL = 'https://ollama.com';

/**
 * Prefix on the stored model id of a model served directly by Ollama Cloud, as
 * opposed to one served by the user's own base URL. `::` never appears in a
 * valid Ollama model name (a name has at most one tag colon and no empty
 * parts), so the prefix cannot collide with a real local model.
 *
 * The prefix is what lets a model with the same name exist both locally and on
 * Ollama Cloud as two separate picker entries, and it makes request routing a
 * pure function of the stored id: no catalog lookup is needed to know which
 * endpoint serves a model.
 */
const OLLAMA_CLOUD_MODEL_PREFIX = 'cloud::';

/** The stored model id for a model served directly by Ollama Cloud. */
export function toOllamaCloudModelId(name: string): string {
	return `${OLLAMA_CLOUD_MODEL_PREFIX}${name}`;
}

/**
 * Where a stored Ollama model id is served, and the name to send there. Ids
 * carrying the cloud prefix go to Ollama Cloud — the configured base URL when
 * it already is ollama.com, otherwise {@link OLLAMA_CLOUD_BASE_URL}. Every
 * other id goes to the configured base URL unchanged.
 */
export function resolveOllamaModel(modelId: string, configuredBaseUrl: string): { baseUrl: string; model: string } {
	if (modelId.startsWith(OLLAMA_CLOUD_MODEL_PREFIX)) {
		return {
			baseUrl: isOllamaCloudEndpoint(configuredBaseUrl) ? configuredBaseUrl : OLLAMA_CLOUD_BASE_URL,
			model: modelId.slice(OLLAMA_CLOUD_MODEL_PREFIX.length),
		};
	}
	return { baseUrl: configuredBaseUrl, model: modelId };
}

/**
 * Whether the model list merges Ollama Cloud's catalog in alongside the
 * configured base URL's: an API key is set and the base URL is a daemon or
 * server of the user's own rather than ollama.com itself.
 */
export function mergesOllamaCloud(baseUrl: string, apiKey: string | undefined): boolean {
	return !!apiKey && !isOllamaCloudEndpoint(baseUrl);
}

/**
 * Whether `baseUrl` points at Ollama's hosted API (ollama.com) rather than a
 * daemon the user runs. The hosted API rejects keyless requests, so callers use
 * this to treat a missing key as "not set up" instead of probing anyway.
 */
export function isOllamaCloudEndpoint(baseUrl: string): boolean {
	try {
		const host = new URL(baseUrl).hostname;
		// Exact-host / dot-suffix match, never a substring: a host like
		// `ollama.com.evil.example` must not count as the hosted API.
		return host === 'ollama.com' || host.endsWith('.ollama.com');
	} catch {
		return false;
	}
}

/**
 * Whether a bearer token may be sent to `baseUrl`: only over HTTPS, or plain
 * HTTP to this machine's loopback. A key sent over plain HTTP to any other host
 * would cross the network in cleartext, so it is withheld there.
 */
export function canSendOllamaKey(baseUrl: string): boolean {
	try {
		const url = new URL(baseUrl);
		if (url.protocol === 'https:') return true;
		if (url.protocol !== 'http:') return false;
		return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
	} catch {
		return false;
	}
}

/**
 * Request headers for an Ollama endpoint: a bearer token when an API key is
 * configured and {@link canSendOllamaKey} allows it for `baseUrl` (ollama.com
 * requires one; an authenticating proxy may), nothing otherwise. The key is sent
 * to whatever endpoint is configured, local or hosted.
 */
export function ollamaAuthHeaders(apiKey: string | undefined, baseUrl: string): Record<string, string> {
	return apiKey && canSendOllamaKey(baseUrl) ? { Authorization: `Bearer ${apiKey}` } : {};
}

export interface OllamaClientConfig {
	baseUrl: string;
	/** Optional API key, sent as a bearer token (Ollama Cloud). */
	apiKey?: string;
	model?: string;
	maxOutputTokens?: number;
}
