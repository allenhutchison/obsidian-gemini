/**
 * Provider capability registry — the capabilities matrix as data.
 *
 * Every provider-aware site used to ask "is the global provider Ollama?".
 * With per-use-case provider selection (#704) that question has no single
 * answer, so sites ask "does the provider serving use case X support feature
 * Y?" instead. This module is the single source of truth for the answer, and
 * mirrors the table in `docs/reference/provider-capabilities.md`.
 *
 * Deliberately a leaf module: it imports only the `ModelProvider` type (from
 * `models.ts`, itself import-free apart from bundled JSON) so anything can
 * depend on it without tripping `npm run lint:cycles`. It is the first
 * sub-task of the provider-abstraction epic (#703); when the full `Provider`
 * interface lands it should absorb this file rather than sit alongside it.
 */

/**
 * A model provider the plugin can talk to.
 *
 * Declared here rather than in `models.ts` so this module stays a true leaf:
 * `models.ts` re-exports it for backward compatibility and imports the router,
 * which would be a cycle if the type lived the other way round.
 */
export type ModelProvider = 'gemini' | 'ollama';

/**
 * A use case that can be routed to a provider independently.
 *
 * The first five mirror `ModelUseCase` (they select a model client); `rag` and
 * `imageGen` are feature gates with no `ModelUseCase` counterpart — they call
 * provider APIs directly rather than going through the client factory.
 */
export type ProviderUseCase = 'chat' | 'summary' | 'completions' | 'rewrite' | 'webSearch' | 'rag' | 'imageGen';

/** Every routable use case, in the order the settings UI presents them. */
export const PROVIDER_USE_CASES: readonly ProviderUseCase[] = [
	'chat',
	'summary',
	'completions',
	'rewrite',
	'webSearch',
	'rag',
	'imageGen',
] as const;

export interface ProviderCapabilities {
	// --- Routable use cases. `false` means the provider cannot serve it at all. ---
	chat: boolean;
	summary: boolean;
	completions: boolean;
	rewrite: boolean;
	/** Google Search / Maps grounding, URL context (web fetch), and deep research. */
	webSearch: boolean;
	/** Vault semantic search backed by a cloud file-search store. */
	rag: boolean;
	imageGen: boolean;

	// --- Behavioural traits ---
	/**
	 * `'always'` — every model accepts image input.
	 * `'auto-detect'` — varies per model, probed at runtime.
	 * `'never'` — text only.
	 */
	vision: 'always' | 'auto-detect' | 'never';
	/** Exposes a real token-counting endpoint (otherwise we estimate chars-per-token). */
	nativeTokenCount: boolean;
	/** Reports cached-prompt token counts in usage metadata. */
	promptCache: boolean;
	/** Requests have a per-token cost worth reporting. */
	costMetrics: boolean;
	/** Supports the Interactions API transport. */
	interactionsApi: boolean;
	/** Honours the `customBaseUrl` setting. */
	customBaseUrl: boolean;
	/**
	 * Different models can be configured per use case without a runtime penalty.
	 * False for Ollama, which keeps a single model resident — diverging models
	 * thrashes RAM/VRAM on every switch (#1077), so its per-use-case model
	 * fields default to inheriting the chat model.
	 */
	perUseCaseModels: boolean;
	/** Requests need an API key before the provider can be initialized. */
	requiresApiKey: boolean;
	/** Input token limit assumed when a model doesn't declare its own. */
	defaultInputTokenLimit: number;
}

export interface ProviderDefinition {
	id: ModelProvider;
	/** i18n key for the provider's display name. */
	labelKey: string;
	capabilities: ProviderCapabilities;
}

export const PROVIDERS: Record<ModelProvider, ProviderDefinition> = {
	gemini: {
		id: 'gemini',
		labelKey: 'settings.general.providerOptionGemini',
		capabilities: {
			chat: true,
			summary: true,
			completions: true,
			rewrite: true,
			webSearch: true,
			rag: true,
			imageGen: true,
			vision: 'always',
			nativeTokenCount: true,
			promptCache: true,
			costMetrics: true,
			interactionsApi: true,
			customBaseUrl: true,
			perUseCaseModels: true,
			requiresApiKey: true,
			/** 1M for all current Gemini models. */
			defaultInputTokenLimit: 1_000_000,
		},
	},
	ollama: {
		id: 'ollama',
		labelKey: 'settings.general.providerOptionOllama',
		capabilities: {
			chat: true,
			summary: true,
			completions: true,
			rewrite: true,
			webSearch: false,
			rag: false,
			imageGen: false,
			vision: 'auto-detect',
			nativeTokenCount: false,
			promptCache: false,
			costMetrics: false,
			interactionsApi: false,
			customBaseUrl: false,
			perUseCaseModels: false,
			requiresApiKey: false,
			/**
			 * Local models vary widely (4k–128k); a conservative middle so
			 * compaction triggers before smaller models truncate.
			 */
			defaultInputTokenLimit: 32_000,
		},
	},
};

/** Every known provider id, in display order. */
export const PROVIDER_IDS: readonly ModelProvider[] = ['gemini', 'ollama'] as const;

/**
 * Capabilities for a provider, defaulting to Gemini for an unrecognized id
 * (e.g. a settings value written by a newer version and then downgraded).
 */
export function getCapabilities(provider: ModelProvider | null | undefined): ProviderCapabilities {
	return (provider && PROVIDERS[provider]?.capabilities) || PROVIDERS.gemini.capabilities;
}

/** Whether a provider can serve a use case at all. */
export function providerSupports(provider: ModelProvider | null | undefined, useCase: ProviderUseCase): boolean {
	if (!provider || !PROVIDERS[provider]) return false;
	return PROVIDERS[provider].capabilities[useCase];
}

/** Every provider that can serve a use case, in display order. */
export function providersSupporting(useCase: ProviderUseCase): ModelProvider[] {
	return PROVIDER_IDS.filter((id) => providerSupports(id, useCase));
}
