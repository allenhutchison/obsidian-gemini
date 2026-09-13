/**
 * Deprecated: Pre-settings-redesign per-use-case provider routing (#704).
 * Superseded by `src/api/feature-routing.ts`'s dense `features` model.
 *
 * Kept as a thin backward-compatibility shim, delegating to
 * `feature-routing.ts`, so work packages that haven't yet migrated their call
 * sites (or their tests' settings fixtures) off this module (see the
 * settings-redesign design doc §3.4/§10.2) keep compiling *and passing* while
 * the redesign lands in parallel work packages. Every new call site should
 * import from `./feature-routing` instead. This file is deleted once nothing
 * imports it any more (design doc §10.2 WP6).
 *
 * **Dual-shape resolution.** A caller may pass either the new
 * `FeatureRoutingSlice` shape (`defaultProvider` + `features`) or the old
 * `provider` + `providerOverrides` shape a not-yet-migrated test fixture still
 * builds. `isLegacyShape` tells them apart (a `features` object is diagnostic
 * of the new shape; its absence alongside a `provider` string means the old
 * one) and each function branches accordingly. Production settings are always
 * the new shape once `migrateToFeatureRouting` has run, so this only matters
 * for callers holding a hand-built settings object — i.e. tests.
 */

import {
	activeProviders as newActiveProviders,
	featureProvider,
	isProviderActive as newIsProviderActive,
	type FeatureRoutingSlice,
} from './feature-routing';
import { PROVIDER_IDS, providerSupports, type ModelProvider, type ProviderFeatureId } from './providers/registry';

export type { ModelProvider } from './providers/registry';
/** Deprecated: Use `FeatureId` from `../types/features` (via `feature-routing.ts`) instead. */
export type ProviderUseCase = ProviderFeatureId;

/** Every use case the old shim resolved, in the order the old settings UI presented them. */
const LEGACY_USE_CASES: readonly ProviderUseCase[] = [
	'chat',
	'summary',
	'completions',
	'rewrite',
	'webSearch',
	'rag',
	'imageGen',
];

interface LegacyProviderRoutingSlice {
	provider?: ModelProvider;
	providerOverrides?: Partial<Record<ProviderUseCase, ModelProvider>>;
}

type DualShapeSlice = (FeatureRoutingSlice & LegacyProviderRoutingSlice) | null | undefined;

/**
 * True when `settings` has no `features` object — the diagnostic signal for
 * the pre-redesign shape (a `provider` string, possibly absent entirely on a
 * bare fixture, defaulting to gemini) rather than the new
 * `FeatureRoutingSlice`. Lets this shim keep serving not-yet-migrated callers
 * and test fixtures; a real (migrated) settings object always has `features`.
 */
function isLegacyShape(settings: DualShapeSlice): boolean {
	return settings?.features === undefined;
}

function legacyPrimaryProvider(settings: LegacyProviderRoutingSlice): ModelProvider {
	return settings.provider ?? 'gemini';
}

function legacyResolveProvider(settings: LegacyProviderRoutingSlice, useCase: ProviderUseCase): ModelProvider | null {
	const chosen = settings.providerOverrides?.[useCase] ?? legacyPrimaryProvider(settings);
	return providerSupports(chosen, useCase) ? chosen : null;
}

/** Deprecated: Use `featureProvider` from `./feature-routing` instead. */
export function resolveProvider(settings: DualShapeSlice, useCase: ProviderUseCase): ModelProvider | null {
	if (isLegacyShape(settings)) return legacyResolveProvider(settings ?? {}, useCase);
	return featureProvider(settings, useCase);
}

/** Deprecated: Use `featureProvider(...) ?? settings.defaultProvider ?? 'gemini'` instead. */
export function resolveProviderOrDefault(settings: DualShapeSlice, useCase: ProviderUseCase): ModelProvider {
	if (isLegacyShape(settings)) return resolveProvider(settings, useCase) ?? legacyPrimaryProvider(settings ?? {});
	return resolveProvider(settings, useCase) ?? settings?.defaultProvider ?? 'gemini';
}

/** Deprecated: Use `activeProviders` from `./feature-routing` instead. */
export function activeProviders(settings: DualShapeSlice): ModelProvider[] {
	if (isLegacyShape(settings)) {
		const legacy = settings ?? {};
		const used = new Set<ModelProvider>([legacyPrimaryProvider(legacy)]);
		for (const useCase of LEGACY_USE_CASES) {
			const resolved = legacyResolveProvider(legacy, useCase);
			if (resolved) used.add(resolved);
		}
		return PROVIDER_IDS.filter((id) => used.has(id));
	}
	return newActiveProviders(settings);
}

/** Deprecated: Use `isProviderActive` from `./feature-routing` instead. */
export function isProviderActive(settings: DualShapeSlice, provider: ModelProvider): boolean {
	if (isLegacyShape(settings)) return activeProviders(settings).includes(provider);
	return newIsProviderActive(settings, provider);
}
