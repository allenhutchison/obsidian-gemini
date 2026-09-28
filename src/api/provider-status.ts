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
import { DEFAULT_OPENAI_BASE_URL, isOpenAIHostedEndpoint } from './providers/openai/config';

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
		if (!isOpenAIHostedEndpoint(settings.openaiBaseUrl || DEFAULT_OPENAI_BASE_URL)) {
			// A custom (e.g. local) endpoint may not need a key; a missing key
			// there isn't evidence of a misconfigured provider.
			return apiKeySecretNameFor(settings, p) ? 'connected' : 'unknown';
		}
		return apiKeySecretNameFor(settings, p) ? 'connected' : 'needs-key';
	}
	// gemini, anthropic
	return apiKeySecretNameFor(plugin.settings, p) ? 'connected' : 'needs-key';
}

/**
 * Whether a provider's model-list request would go out without the key it
 * requires. Unlike `providerConnection`, which checks only that a secret
 * name is saved, this reads the resolved key — the same value the models
 * services send — so a saved name pointing at a missing or empty secret
 * still counts as missing. Ollama and custom OpenAI-compatible endpoints
 * need no key, so they never report a missing one.
 */
export function providerMissingKey(plugin: ObsidianGemini, p: ModelProvider): boolean {
	switch (p) {
		case 'gemini':
			return !plugin.apiKey;
		case 'openai':
			return !plugin.openaiApiKey && isOpenAIHostedEndpoint(plugin.settings.openaiBaseUrl || DEFAULT_OPENAI_BASE_URL);
		case 'anthropic':
			return !plugin.anthropicApiKey;
		case 'ollama':
			return false;
	}
}

/**
 * `route.provider === 'none'` -> `off`; a stored provider that can't serve
 * the feature -> `unsupported`; a provider that supports it but isn't
 * connected -> `unconfigured`; otherwise `ok`. Only `unsupported` and
 * `unconfigured` warrant a warning — `off` is a deliberate choice.
 *
 * Both credential checks run, and they are not redundant.
 * `providerConnection` asks whether a secret *name* is saved;
 * `providerMissingKey` asks whether that name resolves to a key on this
 * device. A settings file synced from another machine names a secret that
 * was never stored here, so the first says `connected` while the second
 * says the key is missing — and `ok` would then promise a feature whose
 * very first request cannot authenticate. Callers act on `ok` by building
 * services and registering agent tools (`LifecycleService`,
 * `ToolRegistrar`), so the weaker of the two answers is the wrong one to
 * hand them. This also stops the Features page reporting a feature as fine
 * while the provider's own card reports "needs key" from
 * `providerMissingKey`.
 */
export function featureStatus(plugin: ObsidianGemini, f: FeatureId): FeatureStatus {
	const route = featureRoute(plugin.settings, f);
	if (route.provider === 'none') return 'off';
	if (!providerSupports(route.provider, f)) return 'unsupported';
	if (providerConnection(plugin, route.provider) !== 'connected') return 'unconfigured';
	if (providerMissingKey(plugin, route.provider)) return 'unconfigured';
	return 'ok';
}
