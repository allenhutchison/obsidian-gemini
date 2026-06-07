/**
 * Configuration for a specific model
 */
export interface ModelConfig {
	apiKey: string;
	model: string;
	temperature: number;
	topP: number;
	maxOutputTokens?: number;
	topK?: number;
}

/**
 * Feature flags for API behavior
 */
export interface ApiFeatures {
	searchGrounding: boolean;
	streamingEnabled: boolean;
}
