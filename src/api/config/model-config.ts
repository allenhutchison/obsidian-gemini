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
 * Retry configuration for API calls
 *
 * @deprecated No longer used with js-genai SDK
 */
export interface RetryConfig {
	maxRetries: number;
	initialBackoffDelay: number;
}

/**
 * Feature flags for API behavior
 */
export interface ApiFeatures {
	searchGrounding: boolean;
	streamingEnabled: boolean;
}

/**
 * Complete API configuration
 *
 * @deprecated Use GeminiClientConfig instead
 */
export interface ApiConfig {
	modelConfig: ModelConfig;
	retryConfig?: RetryConfig;
	features?: ApiFeatures;
}

/**
 * Session-specific model configuration overrides
 */
export interface SessionModelConfig {
	model?: string;
	temperature?: number;
	topP?: number;
}
