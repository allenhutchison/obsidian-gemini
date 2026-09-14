/**
 * Cache of per-provider model counts shown on the Providers page's Models
 * group (settings-redesign design doc §6.2/§8), and its invalidation.
 *
 * Leaf module: both `provider-cards.ts` (owns/reads the cache while rendering
 * a card) and `paths.ts` (invalidates a provider's entry when its credential
 * or base URL changes) need this. `provider-cards.ts` already imports
 * `readSettingPath` from `paths.ts`, so `paths.ts` importing back from
 * `provider-cards.ts` would be a cycle (`lint:cycles`) — putting the cache
 * here instead of in either file avoids it.
 */

import type { ModelProvider } from '../../api/providers/registry';

/** Every card the Providers page renders, including the routable `ModelProvider`s and the Anthropic placeholder. */
export type CardProviderId = ModelProvider | 'anthropic';

/** Best-effort cached model count per card, refreshed in the background. */
export const modelCountCache = new Map<CardProviderId, { total: number; cloud: number }>();

/**
 * Per-card generation token. A probe in flight compares its captured
 * generation against the current one before applying its result, so a stale
 * probe started before a credential/base-URL change can't overwrite a fresher
 * one (or the cleared state from `invalidateModelCount`).
 */
export const modelCountGeneration = new Map<CardProviderId, number>();

/** Bump a card's generation, invalidating any probe already in flight for it. */
export function bumpGeneration(id: CardProviderId): number {
	const next = (modelCountGeneration.get(id) ?? 0) + 1;
	modelCountGeneration.set(id, next);
	return next;
}

/**
 * Clear a provider's cached model count and bump its generation. Call this
 * whenever a provider's credential or base URL changes — the cached count (or
 * a probe already in flight) was measured against the old value and no longer
 * reflects reality; the next render re-probes from scratch.
 */
export function invalidateModelCount(id: CardProviderId): void {
	modelCountCache.delete(id);
	bumpGeneration(id);
}
