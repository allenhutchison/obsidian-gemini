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
	/**
	 * Route requests through the GA Interactions API (`interactions.create`)
	 * instead of the legacy `generateContent`. Stateless (`store: false`) — the
	 * plugin still owns and replays conversation history. Opt-in; see epic #1013.
	 */
	useInteractionsApi?: boolean;
}
