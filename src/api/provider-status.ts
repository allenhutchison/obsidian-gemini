/**
 * Provider/feature status for the settings UI (connection state, and the
 * `off` / `unsupported` / `unconfigured` / `ok` truth table that drives the
 * Features page's warning rows).
 *
 * Not a leaf module (it takes the plugin), so it is imported only by UI and
 * by the few runtime guards that need credential awareness.
 */

import type { ObsidianGemini } from '../types/plugin';
import {
	providerSupports,
	providersSupporting,
	type ModelProvider,
	type ProviderBoundFeatureId,
} from './providers/registry';
import { apiKeySecretNameFor } from './provider-credentials';
import { featureRoute } from './feature-routing';
import type { FeatureId } from '../types/features';
import { DEFAULT_OPENAI_BASE_URL, isOpenAIHostedEndpoint } from './providers/openai/config';
import { DEFAULT_OLLAMA_BASE_URL, missingOllamaCloudKey } from './providers/ollama/config';

export type ProviderConnection = 'connected' | 'needs-key' | 'unreachable' | 'unknown';
export type FeatureStatus = 'ok' | 'off' | 'unsupported' | 'unconfigured';

/**
 * Whether a provider is set up enough to serve a request right now.
 *
 * Ollama's state is the outcome of the models service's last /api/tags probe:
 * `unknown` until one has run (the settings UI kicks a probe when the card
 * renders), then `connected` or `unreachable`. A local daemon needs no key;
 * Ollama Cloud (ollama.com) does, so that endpoint without one is `needs-key`
 * and is never probed (#1764).
 *
 * A key-requiring provider is `connected` only when its saved secret name
 * also resolves to a key on this device. Checking the name alone let a card
 * say "Connected" while the secret was empty, for example a settings file
 * synced from a machine whose keychain holds the key, and while the Features
 * page said the same provider was not connected.
 */
export function providerConnection(plugin: ObsidianGemini, p: ModelProvider): ProviderConnection {
	if (p === 'ollama') {
		if (providerMissingKey(plugin, p)) return 'needs-key';
		const modelManager = plugin.modelManager as typeof plugin.modelManager | undefined;
		const probe = modelManager?.getOllamaModelsService().lastProbe ?? null;
		if (probe === 'reachable') return 'connected';
		if (probe === 'unreachable') return 'unreachable';
		return 'unknown';
	}
	const hasSecretName = !!apiKeySecretNameFor(plugin.settings, p);
	if (p === 'openai' && !isOpenAIHostedEndpoint(plugin.settings.openaiBaseUrl || DEFAULT_OPENAI_BASE_URL)) {
		// A custom (e.g. local) endpoint may not need a key; a missing key
		// there isn't evidence of a misconfigured provider.
		return hasSecretName ? 'connected' : 'unknown';
	}
	// gemini, anthropic, openrouter, hosted openai
	return hasSecretName && !providerMissingKey(plugin, p) ? 'connected' : 'needs-key';
}

/**
 * Whether a provider can be offered as a per-session choice (#1679). Wider than
 * `connected`: a custom OpenAI-compatible endpoint with no key, and an Ollama
 * daemon not probed yet, both read as `unknown` but may well serve requests,
 * so they qualify. A provider missing a key it requires does not, and nor does
 * an Ollama daemon the last probe could not reach.
 */
export function providerSelectable(plugin: ObsidianGemini, p: ModelProvider): boolean {
	const connection = providerConnection(plugin, p);
	return connection === 'connected' || connection === 'unknown';
}

/**
 * Whether a provider's model-list request would go out without the key it
 * requires. It reads the resolved key — the same value the models
 * services send — so a saved name pointing at a missing or empty secret
 * still counts as missing. `providerConnection` builds on it. A local Ollama
 * daemon and custom OpenAI-compatible endpoints need no key, so they never
 * report a missing one; Ollama Cloud (ollama.com) does.
 */
export function providerMissingKey(plugin: ObsidianGemini, p: ModelProvider): boolean {
	switch (p) {
		case 'gemini':
			return !plugin.apiKey;
		case 'openai':
			return !plugin.openaiApiKey && isOpenAIHostedEndpoint(plugin.settings.openaiBaseUrl || DEFAULT_OPENAI_BASE_URL);
		case 'anthropic':
			return !plugin.anthropicApiKey;
		case 'openrouter':
			return !plugin.openrouterApiKey;
		case 'ollama':
			return missingOllamaCloudKey(plugin.settings.ollamaBaseUrl || DEFAULT_OLLAMA_BASE_URL, plugin.ollamaApiKey);
	}
}

/**
 * Whether a provider-bound capability (one with no Features row, such as
 * Google Maps grounding) can be served here: true when any provider the
 * registry says has it resolves its credentials on this device (#1701).
 * Reads the capability flag, so flipping it in `registry.ts` moves the tool
 * gate too, and reuses `providerMissingKey`, so a provider's no-key paths are
 * honoured in one place.
 */
export function providerBoundAvailable(plugin: ObsidianGemini, capability: ProviderBoundFeatureId): boolean {
	return providersSupporting(capability).some((p) => !providerMissingKey(plugin, p));
}

/**
 * `route.provider === 'none'` -> `off`; a stored provider that can't serve
 * the feature -> `unsupported`; a provider that supports it but isn't
 * connected -> `unconfigured`; otherwise `ok`. Only `unsupported` and
 * `unconfigured` warrant a warning — `off` is a deliberate choice.
 *
 * `providerConnection` already requires the saved secret name to resolve to
 * a key on this device, so a settings file synced from another machine,
 * which names a secret never stored here, reads as `unconfigured` rather
 * than promising a feature whose first request cannot authenticate. Callers
 * act on `ok` by building services and registering agent tools
 * (`LifecycleService`, `ToolRegistrar`).
 */
export function featureStatus(plugin: ObsidianGemini, f: FeatureId): FeatureStatus {
	const route = featureRoute(plugin.settings, f);
	if (route.provider === 'none') return 'off';
	if (!providerSupports(route.provider, f)) return 'unsupported';
	if (providerConnection(plugin, route.provider) !== 'connected') return 'unconfigured';
	return 'ok';
}
