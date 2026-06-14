import type { ModelUseCase } from '../../model-use-case';

/**
 * Configuration for GeminiClient
 */
export interface GeminiClientConfig {
	apiKey: string;
	model?: string;
	/**
	 * The use case this client was created for. Drives per-use-case request
	 * tuning (e.g. `thinkingLevel`). Optional — `createCustom` callers leave it
	 * unset and fall back to the CHAT defaults.
	 */
	useCase?: ModelUseCase;
	temperature?: number;
	topP?: number;
	maxOutputTokens?: number;
	streamingEnabled?: boolean;
}
