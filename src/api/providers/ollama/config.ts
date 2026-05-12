export interface OllamaClientConfig {
	baseUrl: string;
	model?: string;
	temperature?: number;
	topP?: number;
	maxOutputTokens?: number;
	streamingEnabled?: boolean;
}
