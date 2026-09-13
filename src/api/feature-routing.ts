/**
 * Feature routing — the dense `features: Record<FeatureId, FeatureRoute>` model
 * (settings redesign; successor to the `provider` + `providerOverrides`
 * per-use-case routing of #704, formerly in `provider-routing.ts`).
 *
 * **No silent fallback.** A feature is served by exactly the provider stored
 * in `features[f].provider`, or it is off. Nothing here — not `sanitizeFeatureRoutes`,
 * not any caller — ever substitutes a different provider for one that can't
 * serve a feature. The only legal repair value is `'none'`. Silently
 * substituting a cloud provider for a capability a local one lacks would send
 * vault data to a third party the user never opted into.
 *
 * **Leaf rule.** This module imports `registry.ts` and `types/features.ts`
 * and nothing else — in particular never `models.ts`. `models.ts` imports
 * *this* module (for `getActiveChatModel`, `resolveFeatureModel`,
 * `geminiGroundingModel`), so any import in the other direction is a cycle and
 * breaks the `lint:cycles` baseline of 0. Concretely: `featureModel` returns
 * the stored string verbatim and never calls `getDefaultModelForRole` —
 * default resolution lives in `models.ts`.
 */

import { PROVIDER_IDS, providerSupports, type ModelProvider } from './providers/registry';
import {
	FEATURE_IDS,
	type FeatureId,
	type FeatureRoute,
	type FeatureRoutes,
	type ProviderModelMemory,
	type RoutedProvider,
} from '../types/features';

export type { ModelProvider } from './providers/registry';
/** @public */
export type { FeatureId, FeatureRoute, FeatureRoutes, ProviderModelMemory, RoutedProvider } from '../types/features';

/** Provider assumed when settings are missing, partial, or unroutable. */
const DEFAULT_PROVIDER: ModelProvider = 'gemini';

/**
 * Structural slice, for the same leaf-module reason `ProviderRoutingSlice` was.
 * Defaults used when the slice is partial (tests, fixtures): `defaultProvider`
 * 'gemini', every missing feature entry treated as `{ provider: 'none', model: '' }`.
 */
export interface FeatureRoutingSlice {
	defaultProvider?: ModelProvider;
	features?: Partial<FeatureRoutes>;
	providerModelMemory?: ProviderModelMemory;
}

function defaultProviderOf(s: FeatureRoutingSlice | null | undefined): ModelProvider {
	return s?.defaultProvider ?? DEFAULT_PROVIDER;
}

/** The stored route for a feature, defaulting to `{ provider: 'none', model: '' }` when absent. */
export function featureRoute(s: FeatureRoutingSlice | null | undefined, f: FeatureId): FeatureRoute {
	return s?.features?.[f] ?? { provider: 'none', model: '' };
}

/**
 * The provider serving a feature, or `null` when the route is `'none'` or the
 * stored provider can't serve it — in which case the caller must keep the
 * feature disabled rather than substituting a different provider.
 */
export function featureProvider(s: FeatureRoutingSlice | null | undefined, f: FeatureId): ModelProvider | null {
	const route = featureRoute(s, f);
	if (route.provider === 'none') return null;
	return providerSupports(route.provider, f) ? route.provider : null;
}

/**
 * The stored model string for a feature, verbatim. `''` is a legal return
 * value and means "the provider's default model for this feature's role".
 * Never resolves a default — that is `resolveFeatureModel` in `models.ts`.
 */
export function featureModel(s: FeatureRoutingSlice | null | undefined, f: FeatureId): string {
	return featureRoute(s, f).model;
}

/**
 * Every provider referenced by the current configuration, in `PROVIDER_IDS`
 * display order: `{providers actually serving a feature} ∪ {defaultProvider}`.
 * `'none'` is never a member. Including `defaultProvider` unconditionally
 * reproduces the pre-redesign `primaryProvider` membership, which is what
 * drives the base-URL re-init guards in `main.ts`.
 */
export function activeProviders(s: FeatureRoutingSlice | null | undefined): ModelProvider[] {
	const used = new Set<ModelProvider>([defaultProviderOf(s)]);
	for (const f of FEATURE_IDS) {
		const resolved = featureProvider(s, f);
		if (resolved) used.add(resolved);
	}
	return PROVIDER_IDS.filter((id) => used.has(id));
}

/** Whether a provider is used anywhere in the current configuration. */
export function isProviderActive(s: FeatureRoutingSlice | null | undefined, provider: ModelProvider): boolean {
	return activeProviders(s).includes(provider);
}

/** Every feature currently served by a provider, in `FEATURE_IDS` order. */
export function featuresUsing(s: FeatureRoutingSlice | null | undefined, provider: ModelProvider): FeatureId[] {
	return FEATURE_IDS.filter((f) => featureProvider(s, f) === provider);
}

/**
 * Stable serialization of the routing configuration, for change detection in
 * `saveSettings` — a re-init is needed when *any* feature changes provider,
 * not just when the default does. Provider-only: model changes deliberately
 * do not appear here (see `main.ts`'s use of this for why).
 */
export function routingKey(s: FeatureRoutingSlice | null | undefined): string {
	const parts = FEATURE_IDS.map((f) => `${f}=${featureProvider(s, f) ?? 'none'}`);
	return `default=${defaultProviderOf(s)};${parts.join(';')}`;
}

/**
 * Coerce persisted data into a valid, total `FeatureRoutes`: drops unknown
 * provider ids and unsupported pairings to `'none'`, never to a substitute
 * provider. Always returns a fresh object — `Object.assign` is shallow, so
 * without a clone an install with no persisted `features` would alias
 * `DEFAULT_SETTINGS.features` and leak every later edit into the module-level
 * default.
 */
export function sanitizeFeatureRoutes(raw: unknown, defaultProvider: ModelProvider): FeatureRoutes {
	const rawObj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
	const result = {} as FeatureRoutes;
	for (const f of FEATURE_IDS) {
		const entry = rawObj[f];
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
			// Rule 1: missing / not an object — the only rule that may pick a
			// provider, and only because there is nothing stored to respect.
			const seeded: RoutedProvider = providerSupports(defaultProvider, f) ? defaultProvider : 'none';
			result[f] = { provider: seeded, model: '' };
			continue;
		}
		const e = entry as { provider?: unknown; model?: unknown };
		let provider: RoutedProvider;
		if (e.provider === 'none') {
			// Rule 2: explicit off is a valid, respected choice.
			provider = 'none';
		} else if (typeof e.provider === 'string' && (PROVIDER_IDS as readonly string[]).includes(e.provider)) {
			const candidate = e.provider as ModelProvider;
			// Rule 4: unsupported pairing -> 'none', never a substitute provider.
			provider = providerSupports(candidate, f) ? candidate : 'none';
		} else {
			// Rule 3: unknown provider id (typo, or written by a newer version) -> 'none'.
			provider = 'none';
		}
		// Rule 5: model is not validated against a model list here (the remote/
		// Ollama/OpenAI lists aren't loaded yet at loadSettings() time).
		const model = typeof e.model === 'string' ? e.model : '';
		result[f] = { provider, model };
	}
	return result;
}

/** Drops unknown provider ids, unknown feature ids, and non-string values. Always returns a fresh object. */
export function sanitizeProviderModelMemory(raw: unknown): ProviderModelMemory {
	const result: ProviderModelMemory = {};
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
	const rawObj = raw as Record<string, unknown>;
	for (const providerId of PROVIDER_IDS) {
		const entry = rawObj[providerId];
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
		const entryObj = entry as Record<string, unknown>;
		const cleaned: Partial<Record<FeatureId, string>> = {};
		for (const f of FEATURE_IDS) {
			const value = entryObj[f];
			if (typeof value === 'string' && value !== '') {
				cleaned[f] = value;
			}
		}
		if (Object.keys(cleaned).length > 0) {
			result[providerId] = cleaned;
		}
	}
	return result;
}

/** Record the model last picked for a (provider, feature) pair. Mutates `s.providerModelMemory` in place. */
export function rememberModel(s: FeatureRoutingSlice, f: FeatureId, provider: ModelProvider, model: string): void {
	if (!model) return;
	if (!s.providerModelMemory) s.providerModelMemory = {};
	if (!s.providerModelMemory[provider]) s.providerModelMemory[provider] = {};
	s.providerModelMemory[provider][f] = model;
}

/** Read the model last picked for a (provider, feature) pair, or `''` when none is remembered. */
export function recallModel(s: FeatureRoutingSlice, f: FeatureId, provider: ModelProvider): string {
	return s.providerModelMemory?.[provider]?.[f] ?? '';
}
