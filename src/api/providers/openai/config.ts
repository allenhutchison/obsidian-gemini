/** Default Chat Completions endpoint for api.openai.com. */
export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

export interface OpenAIClientConfig {
	apiKey: string;
	baseUrl: string;
	model?: string;
	temperature?: number;
	topP?: number;
	streamingEnabled?: boolean;
}
