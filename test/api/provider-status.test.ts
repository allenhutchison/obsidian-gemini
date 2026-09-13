/**
 * Tests for `providerConnection` / `featureStatus` / `featureDisplayValue` —
 * the `off` / `unsupported` / `unconfigured` / `ok` truth table that drives
 * warning rows on the Features settings page.
 */
import { providerConnection, featureStatus } from '../../src/api/provider-status';
import { DEFAULT_OPENAI_BASE_URL } from '../../src/api/providers/openai/config';
import type { FeatureRoutes } from '../../src/types/features';
import type { ObsidianGemini } from '../../src/types/plugin';

function routes(overrides: Partial<FeatureRoutes>): FeatureRoutes {
	const base: FeatureRoutes = {
		chat: { provider: 'none', model: '' },
		summary: { provider: 'none', model: '' },
		completions: { provider: 'none', model: '' },
		rewrite: { provider: 'none', model: '' },
		webSearch: { provider: 'none', model: '' },
		deepResearch: { provider: 'none', model: '' },
		rag: { provider: 'none', model: '' },
		imageGen: { provider: 'none', model: '' },
	};
	return { ...base, ...overrides };
}

function makePlugin(opts: {
	apiKeySecretName?: string;
	openaiApiKeySecretName?: string;
	openaiBaseUrl?: string;
	features: FeatureRoutes;
}): ObsidianGemini {
	return {
		settings: {
			apiKeySecretName: opts.apiKeySecretName ?? '',
			openaiApiKeySecretName: opts.openaiApiKeySecretName ?? '',
			openaiBaseUrl: opts.openaiBaseUrl ?? DEFAULT_OPENAI_BASE_URL,
			features: opts.features,
		},
		apiKey: opts.apiKeySecretName ? 'secret-value' : '',
		openaiApiKey: opts.openaiApiKeySecretName ? 'secret-value' : '',
	} as unknown as ObsidianGemini;
}

describe('providerConnection', () => {
	it('gemini: needs-key when no secret is configured, connected once one is', () => {
		expect(providerConnection(makePlugin({ features: routes({}) }), 'gemini')).toBe('needs-key');
		expect(providerConnection(makePlugin({ apiKeySecretName: 'k', features: routes({}) }), 'gemini')).toBe('connected');
	});

	it('openai: needs-key when no secret and using the default base URL', () => {
		expect(providerConnection(makePlugin({ features: routes({}) }), 'openai')).toBe('needs-key');
		expect(providerConnection(makePlugin({ openaiApiKeySecretName: 'k', features: routes({}) }), 'openai')).toBe(
			'connected'
		);
	});

	// A custom (e.g. local) OpenAI-compatible endpoint may not need a key at
	// all — a missing key there isn't evidence of a misconfigured provider.
	it('openai: unknown (not needs-key) when a custom base URL has no key', () => {
		expect(
			providerConnection(makePlugin({ openaiBaseUrl: 'http://localhost:1234/v1', features: routes({}) }), 'openai')
		).toBe('unknown');
	});

	it('ollama: unknown (no probe signal published yet)', () => {
		expect(providerConnection(makePlugin({ features: routes({}) }), 'ollama')).toBe('unknown');
	});
});

describe('featureStatus', () => {
	it('is "off" for a feature routed to none, never a warning-worthy state', () => {
		const plugin = makePlugin({ features: routes({ chat: { provider: 'none', model: '' } }) });
		expect(featureStatus(plugin, 'chat')).toBe('off');
	});

	it('is "unsupported" for a stored provider that cannot serve the feature', () => {
		const plugin = makePlugin({
			apiKeySecretName: 'k',
			features: routes({ rag: { provider: 'ollama', model: '' } }),
		});
		expect(featureStatus(plugin, 'rag')).toBe('unsupported');
	});

	it('is "unconfigured" when the provider supports the feature but has no credentials', () => {
		const plugin = makePlugin({ features: routes({ chat: { provider: 'gemini', model: '' } }) });
		expect(featureStatus(plugin, 'chat')).toBe('unconfigured');
	});

	it('is "ok" when the provider supports the feature and is connected', () => {
		const plugin = makePlugin({
			apiKeySecretName: 'k',
			features: routes({ chat: { provider: 'gemini', model: '' } }),
		});
		expect(featureStatus(plugin, 'chat')).toBe('ok');
	});
});
