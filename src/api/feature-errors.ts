/**
 * Errors shared between the model-client factory and settings/agent UI —
 * leaf module so both can import it without a cycle.
 */

import type { FeatureId } from '../types/features';

/**
 * Thrown when a feature is asked to produce a client/model but its route
 * resolves to nothing servable: routed to `'none'` (`reason: 'unsupported'`
 * is used for a stored provider that can't serve the feature; `'unconfigured'`
 * for a provider that supports it but lacks credentials/endpoint). Replaces
 * the old `resolveProviderOrDefault` silent-Gemini-fallback — the caller
 * surfaces this as a Notice rather than the request going to the wrong
 * provider.
 */
export class FeatureUnavailableError extends Error {
	constructor(
		readonly feature: FeatureId,
		readonly reason: 'unsupported' | 'unconfigured'
	) {
		super(`Feature '${feature}' is unavailable (${reason}).`);
		this.name = 'FeatureUnavailableError';
	}
}
