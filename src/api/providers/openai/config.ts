export interface OpenAiClientConfig {
	baseUrl: string;
	apiKey: string;
	model?: string;
	temperature?: number;
	topP?: number;
	maxOutputTokens?: number;
	streamingEnabled?: boolean;
	allowInsecure?: boolean;
}
