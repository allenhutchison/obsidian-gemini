/**
 * Tests for `providerConnection` / `featureStatus` — the `off` /
 * `unsupported` / `unconfigured` / `ok` truth table that drives warning rows
 * on the Features settings page.
 */
import { providerConnection, featureStatus, providerMissingKey } from '../../src/api/provider-status';
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
	anthropicApiKeySecretName?: string;
	openaiBaseUrl?: string;
	features: FeatureRoutes;
}): ObsidianGemini {
	return {
		settings: {
			apiKeySecretName: opts.apiKeySecretName ?? '',
			openaiApiKeySecretName: opts.openaiApiKeySecretName ?? '',
			anthropicApiKeySecretName: opts.anthropicApiKeySecretName ?? '',
			openaiBaseUrl: opts.openaiBaseUrl ?? DEFAULT_OPENAI_BASE_URL,
			features: opts.features,
		},
		apiKey: opts.apiKeySecretName ? 'secret-value' : '',
		openaiApiKey: opts.openaiApiKeySecretName ? 'secret-value' : '',
		anthropicApiKey: opts.anthropicApiKeySecretName ? 'secret-value' : '',
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

	it('anthropic: needs-key until its own secret is configured', () => {
		expect(providerConnection(makePlugin({ apiKeySecretName: 'k', features: routes({}) }), 'anthropic')).toBe(
			'needs-key'
		);
		expect(providerConnection(makePlugin({ anthropicApiKeySecretName: 'k', features: routes({}) }), 'anthropic')).toBe(
			'connected'
		);
	});

	it('ollama: unknown before any probe, then follows the models service probe result', () => {
		expect(providerConnection(makePlugin({ features: routes({}) }), 'ollama')).toBe('unknown');
		const withProbe = (lastProbe: 'reachable' | 'unreachable' | null) =>
			Object.assign(makePlugin({ features: routes({}) }), {
				modelManager: { getOllamaModelsService: () => ({ lastProbe }) },
			});
		expect(providerConnection(withProbe(null), 'ollama')).toBe('unknown');
		expect(providerConnection(withProbe('reachable'), 'ollama')).toBe('connected');
		expect(providerConnection(withProbe('unreachable'), 'ollama')).toBe('unreachable');
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

	// The two credential checks answer different questions: a settings file
	// synced from another machine names a secret that was never stored here, so
	// `providerConnection` says 'connected' while the key resolves to ''.
	// Callers act on 'ok' by building services and registering agent tools, so
	// this state must not read as 'ok'.
	it('is "unconfigured" when the secret name is saved but resolves to no key', () => {
		const plugin = makePlugin({
			apiKeySecretName: 'k',
			features: routes({ chat: { provider: 'gemini', model: '' } }),
		});
		(plugin as { apiKey: string }).apiKey = '';

		expect(providerConnection(plugin, 'gemini')).toBe('connected');
		expect(providerMissingKey(plugin, 'gemini')).toBe(true);
		expect(featureStatus(plugin, 'chat')).toBe('unconfigured');
	});

	it('applies the resolved-key check to every routed provider, not just gemini', () => {
		const plugin = makePlugin({
			openaiApiKeySecretName: 'k',
			anthropicApiKeySecretName: 'k',
			features: routes({
				imageGen: { provider: 'openai', model: '' },
				summary: { provider: 'anthropic', model: '' },
			}),
		});
		expect(featureStatus(plugin, 'imageGen')).toBe('ok');
		expect(featureStatus(plugin, 'summary')).toBe('ok');

		(plugin as { openaiApiKey: string }).openaiApiKey = '';
		(plugin as { anthropicApiKey: string }).anthropicApiKey = '';
		expect(featureStatus(plugin, 'imageGen')).toBe('unconfigured');
		expect(featureStatus(plugin, 'summary')).toBe('unconfigured');
	});

	// Ollama needs no key, so the resolved-key check must not turn a reachable
	// daemon into 'unconfigured'.
	it('does not apply the resolved-key check to a keyless provider', () => {
		const plugin = Object.assign(makePlugin({ features: routes({ chat: { provider: 'ollama', model: '' } }) }), {
			modelManager: { getOllamaModelsService: () => ({ lastProbe: 'reachable' }) },
		});
		expect(featureStatus(plugin, 'chat')).toBe('ok');
	});
});

describe('providerMissingKey', () => {
	it('reads the resolved key, not the saved secret name', () => {
		const plugin = makePlugin({ openaiApiKeySecretName: 'k', features: routes({}) });
		expect(providerMissingKey(plugin, 'openai')).toBe(false);
		(plugin as { openaiApiKey: string }).openaiApiKey = '';
		expect(providerMissingKey(plugin, 'openai')).toBe(true);
	});

	it('never reports a missing key for keyless endpoints', () => {
		const plugin = makePlugin({ openaiBaseUrl: 'http://localhost:1234/v1', features: routes({}) });
		expect(providerMissingKey(plugin, 'openai')).toBe(false);
		expect(providerMissingKey(plugin, 'ollama')).toBe(false);
	});

	it('reports gemini and anthropic by their resolved keys', () => {
		const bare = makePlugin({ features: routes({}) });
		expect(providerMissingKey(bare, 'gemini')).toBe(true);
		expect(providerMissingKey(bare, 'anthropic')).toBe(true);
		const keyed = makePlugin({ apiKeySecretName: 'g', anthropicApiKeySecretName: 'a', features: routes({}) });
		expect(providerMissingKey(keyed, 'gemini')).toBe(false);
		expect(providerMissingKey(keyed, 'anthropic')).toBe(false);
	});
});

describe('providerConnection hosted-endpoint check', () => {
	it('treats the OpenAI host with a trailing slash as hosted (needs a key)', () => {
		const plugin = makePlugin({ openaiBaseUrl: 'https://api.openai.com/v1/', features: routes({}) });
		expect(providerConnection(plugin, 'openai')).toBe('needs-key');
	});
});
