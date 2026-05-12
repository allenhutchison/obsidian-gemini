/**
 * Configuration for GeminiClient
 */
export interface GeminiClientConfig {
	apiKey: string;
	model?: string;
	temperature?: number;
	topP?: number;
	maxOutputTokens?: number;
	streamingEnabled?: boolean;
}
