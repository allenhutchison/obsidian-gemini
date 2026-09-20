/**
 * Provider capability registry — the capabilities matrix as data.
 *
 * Every provider-aware site used to ask "is the global provider Ollama?".
 * Since the settings redesign's feature-routing model that question has no
 * single answer, so sites ask "does the provider serving feature X support
 * feature Y?" instead. This module is the single source of truth for the
 * answer, and mirrors the table in `docs/reference/provider-capabilities.md`.
 *
 * Deliberately a leaf module: it imports nothing (not even `types/features.ts`)
 * so anything can depend on it without tripping `npm run lint:cycles`. It
 * declares its own `ProviderFeatureId` union rather than importing `FeatureId`
 * from `types/features.ts`, because `types/features.ts` imports `ModelProvider`
 * from *this* file — importing back would be a two-file cycle. The two unions
 * are kept identical by hand; `test/api/provider-registry.test.ts` and
 * `test/api/feature-routing.test.ts` both exercise the shared literal set.
 */

/**
 * A model provider the plugin can talk to.
 *
 * Declared here rather than in `models.ts` so this module stays a true leaf:
 * `models.ts` re-exports it for backward compatibility, and `types/features.ts`
 * imports it directly for the same reason.
 */
export type ModelProvider = 'gemini' | 'ollama' | 'openai' | 'anthropic';

/**
 * Capability keys a provider is asked about — kept in lockstep with `FeatureId`
 * in `src/types/features.ts` (see the module doc comment for why this is a
 * separate declaration rather than an import) plus `maps`, which is
 * provider-bound rather than a routable feature (§2.7 of the design).
 */
export type ProviderFeatureId =
	'chat' | 'summary' | 'completions' | 'rewrite' | 'webSearch' | 'deepResearch' | 'rag' | 'imageGen';

export interface ProviderCapabilities {
	// --- Routable features. `false` means the provider cannot serve it at all. ---
	chat: boolean;
	summary: boolean;
	completions: boolean;
	rewrite: boolean;
	/** Google Search and URL context (web fetch) only — maps and deep research are separate capabilities below. */
	webSearch: boolean;
	/** Deep Research managed agent. */
	deepResearch: boolean;
	/** Vault semantic search backed by a cloud file-search store. */
	rag: boolean;
	imageGen: boolean;

	// --- Provider-bound capabilities (not routable features) ---
	/** Google Maps grounding. Provider-bound: gated on the provider being configured, not on any Features row. */
	maps: boolean;

	// --- Behavioural traits with live readers ---
	/** Exposes a real token-counting endpoint (otherwise we estimate chars-per-token). */
	nativeTokenCount: boolean;
	/** Honours the `customBaseUrl` setting. */
	customBaseUrl: boolean;
	/**
	 * `false` for Ollama, which keeps a single model resident — diverging
	 * models thrash RAM/VRAM on every switch (#1077). Drives the Features
	 * page's "same as chat" model option for non-chat features on such a
	 * provider.
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
	/** Setup-guide doc link shown on the provider's card. */
	docsUrl?: string;
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
			deepResearch: true,
			rag: true,
			imageGen: true,
			maps: true,
			nativeTokenCount: true,
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
		docsUrl: 'https://allenhutchison.github.io/obsidian-gemini/guide/ollama-setup.html',
		capabilities: {
			chat: true,
			summary: true,
			completions: true,
			rewrite: true,
			webSearch: false,
			deepResearch: false,
			rag: false,
			imageGen: false,
			maps: false,
			nativeTokenCount: false,
			customBaseUrl: false,
			perUseCaseModels: false,
			requiresApiKey: false,
			/**
			 * Last-resort fallback only. The real window is resolved per model at
			 * runtime from the daemon (`/api/ps`, falling back to `/api/show`) —
			 * see `ContextManager.getOllamaInputTokenLimit`. This value applies
			 * when the daemon is unreachable, where a conservative middle is
			 * safer than assuming a large window.
			 */
			defaultInputTokenLimit: 32_000,
		},
	},
	openai: {
		id: 'openai',
		labelKey: 'settings.general.providerOptionOpenai',
		docsUrl: 'https://allenhutchison.github.io/obsidian-gemini/guide/openai-setup.html',
		capabilities: {
			chat: true,
			summary: true,
			completions: true,
			rewrite: true,
			webSearch: false,
			deepResearch: false,
			rag: false,
			imageGen: true,
			maps: false,
			nativeTokenCount: false,
			customBaseUrl: true,
			perUseCaseModels: true,
			requiresApiKey: true,
			/** Conservative floor for an unrecognized model; known models report their own via the models list. */
			defaultInputTokenLimit: 128_000,
		},
	},
	anthropic: {
		id: 'anthropic',
		labelKey: 'settings.general.providerOptionAnthropic',
		docsUrl: 'https://allenhutchison.github.io/obsidian-gemini/guide/anthropic-setup.html',
		capabilities: {
			chat: true,
			summary: true,
			completions: true,
			rewrite: true,
			webSearch: false,
			deepResearch: false,
			rag: false,
			imageGen: false,
			maps: false,
			nativeTokenCount: false,
			customBaseUrl: false,
			perUseCaseModels: true,
			requiresApiKey: true,
			/** Haiku 4.5's window; every other offered model reports its own (1M) via the model list. */
			defaultInputTokenLimit: 200_000,
		},
	},
};

/** Every known provider id, in display order. */
export const PROVIDER_IDS: readonly ModelProvider[] = ['gemini', 'ollama', 'openai', 'anthropic'] as const;

/**
 * Capabilities for a provider, defaulting to Gemini for an unrecognized id
 * (e.g. a settings value written by a newer version and then downgraded).
 */
export function getCapabilities(provider: ModelProvider | null | undefined): ProviderCapabilities {
	return (provider && PROVIDERS[provider]?.capabilities) || PROVIDERS.gemini.capabilities;
}

/** Whether a provider can serve a routable feature at all. */
export function providerSupports(provider: ModelProvider | null | undefined, feature: ProviderFeatureId): boolean {
	if (!provider || !PROVIDERS[provider]) return false;
	return PROVIDERS[provider].capabilities[feature];
}

/** Every provider that can serve a routable feature, in display order. */
export function providersSupporting(feature: ProviderFeatureId): ModelProvider[] {
	return PROVIDER_IDS.filter((id) => providerSupports(id, feature));
}
