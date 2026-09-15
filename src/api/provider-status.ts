/**
 * Provider/feature status for the settings UI (connection state, and the
 * `off` / `unsupported` / `unconfigured` / `ok` truth table that drives the
 * Features page's warning rows).
 *
 * Not a leaf module (it takes the plugin), so it is imported only by UI and
 * by the few runtime guards that need credential awareness.
 */

import type { ObsidianGemini } from '../types/plugin';
import { providerSupports, type ModelProvider } from './providers/registry';
import { apiKeySecretNameFor } from './provider-credentials';
import { featureRoute } from './feature-routing';
import type { FeatureId } from '../types/features';
import { DEFAULT_OPENAI_BASE_URL } from './providers/openai/config';

export type ProviderConnection = 'connected' | 'needs-key' | 'unreachable' | 'unknown';
export type FeatureStatus = 'ok' | 'off' | 'unsupported' | 'unconfigured';

/**
 * Whether a provider is set up enough to serve a request right now.
 *
 * Ollama needs no key, so its state is the outcome of the models service's
 * last /api/tags probe: `unknown` until one has run (the settings UI kicks a
 * probe when the card renders), then `connected` or `unreachable`.
 */
export function providerConnection(plugin: ObsidianGemini, p: ModelProvider): ProviderConnection {
	if (p === 'ollama') {
		const modelManager = plugin.modelManager as typeof plugin.modelManager | undefined;
		const probe = modelManager?.getOllamaModelsService().lastProbe ?? null;
		if (probe === 'reachable') return 'connected';
		if (probe === 'unreachable') return 'unreachable';
		return 'unknown';
	}
	if (p === 'openai') {
		const settings = plugin.settings;
		if (settings.openaiBaseUrl && settings.openaiBaseUrl !== DEFAULT_OPENAI_BASE_URL) {
			// A custom (e.g. local) endpoint may not need a key; a missing key
			// there isn't evidence of a misconfigured provider.
			return apiKeySecretNameFor(settings, p) ? 'connected' : 'unknown';
		}
		return apiKeySecretNameFor(settings, p) ? 'connected' : 'needs-key';
	}
	// gemini
	return apiKeySecretNameFor(plugin.settings, p) ? 'connected' : 'needs-key';
}

/**
 * `route.provider === 'none'` -> `off`; a stored provider that can't serve
 * the feature -> `unsupported`; a provider that supports it but isn't
 * connected -> `unconfigured`; otherwise `ok`. Only `unsupported` and
 * `unconfigured` warrant a warning — `off` is a deliberate choice.
 */
export function featureStatus(plugin: ObsidianGemini, f: FeatureId): FeatureStatus {
	const route = featureRoute(plugin.settings, f);
	if (route.provider === 'none') return 'off';
	if (!providerSupports(route.provider, f)) return 'unsupported';
	if (providerConnection(plugin, route.provider) !== 'connected') return 'unconfigured';
	return 'ok';
}
