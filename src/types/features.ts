/**
 * Feature routing types — the dense `features: Record<FeatureId, FeatureRoute>`
 * model that replaces the old `provider` + `providerOverrides` + per-provider
 * model-name fields (#704 successor; see the settings-redesign design doc).
 *
 * Leaf module: imports only `ModelProvider` from `src/api/providers/registry.ts`,
 * so both `src/types/settings.ts` and `src/api/feature-routing.ts` can import it
 * without tripping `npm run lint:cycles`. `src/api/providers/registry.ts`
 * deliberately does NOT import back from here (it declares its own identical
 * capability-key union) — importing `FeatureId` there would cycle straight back
 * through this file's `ModelProvider` import.
 */

import type { ModelProvider } from '../api/providers/registry';

/**
 * The model role a feature reads its default model from.
 *
 * Declared here (not in `models.ts`) so this module stays a leaf; `models.ts`
 * re-exports it for backward compatibility, mirroring the pattern
 * `ModelProvider` already uses the other way round.
 */
export type ModelRole = 'chat' | 'summary' | 'completions' | 'rewrite' | 'image';

/** A capability that is independently routed to a provider. */
export type FeatureId =
	| 'chat' // chat + agent
	| 'summary'
	| 'completions'
	| 'rewrite'
	| 'webSearch' // google_search + web_fetch (URL context)
	| 'deepResearch' // Deep Research managed agent
	| 'rag' // vault search index (Google File Search)
	| 'imageGen';

/** Every feature, in the order the Features page presents them. */
export const FEATURE_IDS: readonly FeatureId[] = [
	'chat',
	'summary',
	'completions',
	'rewrite',
	'webSearch',
	'deepResearch',
	'rag',
	'imageGen',
] as const;

/**
 * Features grouped for the Features page.
 * @public
 */
export const FEATURE_GROUPS: { key: 'text' | 'web' | 'media'; features: FeatureId[] }[] = [
	{ key: 'text', features: ['chat', 'summary', 'completions', 'rewrite'] },
	{ key: 'web', features: ['webSearch', 'deepResearch', 'rag'] },
	{ key: 'media', features: ['imageGen'] },
];

/**
 * A feature's provider, or `'none'` — "not routed, feature is off".
 *
 * `'none'` is what makes "no silent fallback" representable. Today a feature the
 * routed provider can't serve resolves to `null` at read time and the feature is
 * off; with a dense table there has to be a stored value that means the same
 * thing, or every repair has to invent a substitute provider — which is
 * precisely the silent fallback the settings redesign forbids.
 */
export type RoutedProvider = ModelProvider | 'none';

export interface FeatureRoute {
	provider: RoutedProvider;
	/** '' = "use the provider's default model for this feature's role". Never resolved here. */
	model: string;
}

export type FeatureRoutes = Record<FeatureId, FeatureRoute>;

/**
 * Last model the user picked for each (provider, feature) pair. Never read when
 * building a request — it exists only so that re-routing a feature away from a
 * provider and back restores the previous choice (preserves #1077 / #1298).
 */
export type ProviderModelMemory = Partial<Record<ModelProvider, Partial<Record<FeatureId, string>>>>;

/** The model role a feature reads its default model from. `null` = feature has no model. */
export const FEATURE_MODEL_ROLE: Record<FeatureId, ModelRole | null> = {
	chat: 'chat',
	summary: 'summary',
	completions: 'completions',
	rewrite: 'rewrite',
	webSearch: 'chat',
	deepResearch: null, // managed agent (gemini-utils ResearchManager), no model parameter
	rag: null, // Google File Search managed embeddings
	imageGen: 'image',
};
