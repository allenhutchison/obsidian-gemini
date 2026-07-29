/**
 * Per-use-case provider routing (#704).
 *
 * The plugin has one *primary* provider (`settings.provider`) plus a sparse map
 * of per-use-case overrides. A use case with no override is served by the
 * primary, so an install that predates this feature — primary set, overrides
 * empty — resolves exactly as it did before and needs no migration.
 *
 * **Never falls back to another provider.** When the resolved provider can't
 * serve a use case, `resolveProvider` returns `null` and the feature stays off,
 * matching today's behaviour on Ollama. Silently substituting a cloud provider
 * for a capability the local one lacks would send vault data to a third party
 * that the user never opted into. Turning a cloud feature on under a local
 * primary is always an explicit, per-feature choice.
 *
 * Leaf module by design (registry + the `ModelProvider` type only) so every
 * consumer can import it without tripping `npm run lint:cycles`. The settings
 * slice is structural rather than `ObsidianGeminiSettings` for the same reason
 * `ModelSettingsSlice` is (see `models.ts`).
 */

import {
	PROVIDER_IDS,
	PROVIDER_USE_CASES,
	providerSupports,
	type ModelProvider,
	type ProviderUseCase,
} from './providers/registry';

export type { ModelProvider, ProviderUseCase } from './providers/registry';

/** Provider assumed when settings are missing, partial, or unroutable. */
const DEFAULT_PROVIDER: ModelProvider = 'gemini';

/** The slice of settings that provider routing reads. */
export interface ProviderRoutingSlice {
	provider?: ModelProvider;
	providerOverrides?: Partial<Record<ProviderUseCase, ModelProvider>>;
}

/** The primary provider, defaulting to Gemini for legacy/partial settings. */
export function primaryProvider(settings: ProviderRoutingSlice | null | undefined): ModelProvider {
	return settings?.provider ?? DEFAULT_PROVIDER;
}

/**
 * The provider serving a use case, or `null` when none of the configured
 * providers can — in which case the caller must keep the feature disabled
 * rather than substituting a different provider.
 */
export function resolveProvider(
	settings: ProviderRoutingSlice | null | undefined,
	useCase: ProviderUseCase
): ModelProvider | null {
	const chosen = settings?.providerOverrides?.[useCase] ?? primaryProvider(settings);
	return providerSupports(chosen, useCase) ? chosen : null;
}

/**
 * Like `resolveProvider`, but for callers that must produce a client no matter
 * what. Only safe for the use cases every provider supports (chat, summary,
 * completions, rewrite) — capability-gated features must use `resolveProvider`
 * and honour the `null`.
 */
export function resolveProviderOrDefault(
	settings: ProviderRoutingSlice | null | undefined,
	useCase: ProviderUseCase
): ModelProvider {
	return resolveProvider(settings, useCase) ?? DEFAULT_PROVIDER;
}

/**
 * Every provider referenced by the current configuration, in display order.
 * Drives which provider-specific settings rows are rendered, which model lists
 * are fetched, and which credentials are required — a provider used by a single
 * override still needs its API key field and its models.
 */
export function activeProviders(settings: ProviderRoutingSlice | null | undefined): ModelProvider[] {
	const used = new Set<ModelProvider>([primaryProvider(settings)]);
	for (const useCase of PROVIDER_USE_CASES) {
		const resolved = resolveProvider(settings, useCase);
		if (resolved) used.add(resolved);
	}
	return PROVIDER_IDS.filter((id) => used.has(id));
}

/** Whether a provider is used anywhere in the current configuration. */
export function isProviderActive(settings: ProviderRoutingSlice | null | undefined, provider: ModelProvider): boolean {
	return activeProviders(settings).includes(provider);
}

/**
 * Use cases routed to a provider other than the primary. Used by the settings
 * UI to warn when a local-only primary has cloud features enabled.
 */
export function overriddenUseCases(settings: ProviderRoutingSlice | null | undefined): ProviderUseCase[] {
	const primary = primaryProvider(settings);
	return PROVIDER_USE_CASES.filter((useCase) => {
		const resolved = resolveProvider(settings, useCase);
		return resolved !== null && resolved !== primary;
	});
}

/**
 * Coerce persisted data into a valid override map: drops unknown use cases,
 * unknown provider ids, and providers that can't serve the use case they're
 * mapped to. Always returns a fresh object.
 *
 * Called on load because `Object.assign({}, DEFAULT_SETTINGS, data)` is shallow
 * — without a clone, an install with no persisted overrides would alias the
 * module-level default and leak every later edit into it.
 *
 * The capability check matters beyond tidiness: `resolveProvider` already
 * treats an unsupported pairing as `null`, so keeping it would persist a
 * setting that does nothing while the settings dropdown — which only offers
 * `providersSupporting(useCase)` — has no matching option to select, leaving
 * the row looking blank. Dropping it keeps stored state and UI in agreement.
 */
export function sanitizeProviderOverrides(value: unknown): Partial<Record<ProviderUseCase, ModelProvider>> {
	const result: Partial<Record<ProviderUseCase, ModelProvider>> = {};
	if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
	const raw = value as Record<string, unknown>;
	for (const useCase of PROVIDER_USE_CASES) {
		const provider = raw[useCase];
		if (
			typeof provider === 'string' &&
			(PROVIDER_IDS as readonly string[]).includes(provider) &&
			providerSupports(provider as ModelProvider, useCase)
		) {
			result[useCase] = provider as ModelProvider;
		}
	}
	return result;
}

/**
 * Stable serialization of the routing configuration, for change detection in
 * `saveSettings` — a re-init is needed when *any* use case changes provider,
 * not just when the primary does.
 */
export function routingKey(settings: ProviderRoutingSlice | null | undefined): string {
	const parts = PROVIDER_USE_CASES.map((useCase) => `${useCase}=${resolveProvider(settings, useCase) ?? 'none'}`);
	return `primary=${primaryProvider(settings)};${parts.join(';')}`;
}
