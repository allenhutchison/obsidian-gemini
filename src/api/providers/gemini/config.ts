import type { ModelUseCase } from '../../model-use-case';

/**
 * Configuration for GeminiClient
 */
export interface GeminiClientConfig {
	apiKey: string;
	model?: string;
	/**
	 * The use case this client was created for. Drives per-use-case request
	 * tuning (e.g. `thinkingLevel`). Optional — direct construction without
	 * the factory (e.g. `ImageGeneration`) leaves it unset and falls back to
	 * the CHAT defaults.
	 */
	useCase?: ModelUseCase;
	maxOutputTokens?: number;
}
