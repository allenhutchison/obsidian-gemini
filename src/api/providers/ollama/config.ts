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
 * Request headers for an Ollama endpoint: a bearer token when an API key is
 * configured (required by ollama.com, accepted and ignored by a local daemon
 * or forwarded by an authenticating proxy), nothing otherwise.
 */
export function ollamaAuthHeaders(apiKey: string | undefined): Record<string, string> {
	return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

export interface OllamaClientConfig {
	baseUrl: string;
	/** Optional API key, sent as a bearer token (Ollama Cloud). */
	apiKey?: string;
	model?: string;
	maxOutputTokens?: number;
}
