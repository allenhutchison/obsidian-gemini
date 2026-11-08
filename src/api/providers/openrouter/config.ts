/** OpenRouter's OpenAI-compatible API root. */
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * OpenRouter's optional app-attribution headers. They only label the plugin's
 * traffic on openrouter.ai (rankings, the user's activity page); nothing about
 * the request depends on them. `X-Title` is the legacy spelling OpenRouter
 * still accepts alongside `X-OpenRouter-Title`.
 */
export const OPENROUTER_ATTRIBUTION_HEADERS: Readonly<Record<string, string>> = {
	'HTTP-Referer': 'https://github.com/allenhutchison/obsidian-gemini',
	'X-OpenRouter-Title': 'Gemini Scribe',
	'X-Title': 'Gemini Scribe',
};

export interface OpenRouterClientConfig {
	apiKey: string;
	model?: string;
}
