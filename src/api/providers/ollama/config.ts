/** Default endpoint for a local Ollama daemon. */
export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';

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
