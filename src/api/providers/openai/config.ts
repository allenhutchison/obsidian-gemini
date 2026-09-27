/** Default Chat Completions endpoint for api.openai.com. */
export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

/** Whether `baseUrl` points at the real OpenAI API rather than a compatible server. */
export function isOpenAIHostedEndpoint(baseUrl: string): boolean {
	try {
		return new URL(baseUrl).hostname === 'api.openai.com';
	} catch {
		// Unparseable base URL — treat as a compatible server rather than
		// substring-matching (a host like `api.openai.com.evil.example` must
		// never be classified as the official endpoint).
		return false;
	}
}

export interface OpenAIClientConfig {
	apiKey: string;
	baseUrl: string;
	model?: string;
}
