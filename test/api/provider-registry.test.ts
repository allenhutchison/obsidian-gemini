/**
 * Guards the capability registry against drift.
 *
 * The matrix is the single source of truth every provider-aware site now reads,
 * and it is mirrored in `docs/reference/provider-capabilities.md` — a change
 * here without a change there is a documentation bug.
 */
import {
	getCapabilities,
	PROVIDER_IDS,
	PROVIDERS,
	providerSupports,
	providersSupporting,
	type ProviderFeatureId,
} from '../../src/api/providers/registry';

const ROUTABLE_FEATURES: ProviderFeatureId[] = [
	'chat',
	'summary',
	'completions',
	'rewrite',
	'webSearch',
	'deepResearch',
	'rag',
	'imageGen',
];

describe('capability matrix', () => {
	it('matches the documented Gemini capabilities', () => {
		const caps = PROVIDERS.gemini.capabilities;
		expect(caps.chat).toBe(true);
		expect(caps.summary).toBe(true);
		expect(caps.completions).toBe(true);
		expect(caps.rewrite).toBe(true);
		expect(caps.webSearch).toBe(true);
		expect(caps.deepResearch).toBe(true);
		expect(caps.rag).toBe(true);
		expect(caps.imageGen).toBe(true);
		expect(caps.maps).toBe(true);
		expect(caps.requiresApiKey).toBe(true);
		expect(caps.nativeTokenCount).toBe(true);
		expect(caps.customBaseUrl).toBe(true);
	});

	it('matches the documented Ollama capabilities', () => {
		const caps = PROVIDERS.ollama.capabilities;
		expect(caps.chat).toBe(true);
		expect(caps.summary).toBe(true);
		expect(caps.completions).toBe(true);
		expect(caps.rewrite).toBe(true);
		// Cloud-only features. Flipping any of these to true without shipping a
		// local implementation would silently enable a broken code path.
		expect(caps.webSearch).toBe(false);
		expect(caps.deepResearch).toBe(false);
		expect(caps.rag).toBe(false);
		expect(caps.imageGen).toBe(false);
		expect(caps.maps).toBe(false);
		expect(caps.requiresApiKey).toBe(false);
		expect(caps.nativeTokenCount).toBe(false);
		// One resident model at a time (#1077).
		expect(caps.perUseCaseModels).toBe(false);
	});

	it('matches the documented OpenAI capabilities', () => {
		const caps = PROVIDERS.openai.capabilities;
		expect(caps.chat).toBe(true);
		expect(caps.summary).toBe(true);
		expect(caps.completions).toBe(true);
		expect(caps.rewrite).toBe(true);
		// Cloud-only features this phase doesn't implement for OpenAI.
		expect(caps.webSearch).toBe(false);
		expect(caps.deepResearch).toBe(false);
		expect(caps.rag).toBe(false);
		expect(caps.imageGen).toBe(false);
		expect(caps.maps).toBe(false);
		expect(caps.requiresApiKey).toBe(true);
		expect(caps.nativeTokenCount).toBe(false);
		expect(caps.customBaseUrl).toBe(true);
		// Each feature keeps its own model — no single-resident-model constraint.
		expect(caps.perUseCaseModels).toBe(true);
	});

	it('gives every provider a smaller default context limit than Gemini where local', () => {
		expect(PROVIDERS.gemini.capabilities.defaultInputTokenLimit).toBe(1_000_000);
		expect(PROVIDERS.ollama.capabilities.defaultInputTokenLimit).toBe(32_000);
		expect(PROVIDERS.openai.capabilities.defaultInputTokenLimit).toBe(128_000);
	});

	it('declares every routable feature for every provider', () => {
		for (const id of PROVIDER_IDS) {
			for (const feature of ROUTABLE_FEATURES) {
				expect(typeof PROVIDERS[id].capabilities[feature]).toBe('boolean');
			}
		}
	});

	// Chat is the floor: a provider that can't chat can't be a default provider.
	it('has every provider support chat', () => {
		for (const id of PROVIDER_IDS) {
			expect(providerSupports(id, 'chat')).toBe(true);
		}
	});
});

describe('lookup helpers', () => {
	it('providersSupporting lists candidates in display order', () => {
		expect(providersSupporting('chat')).toEqual(['gemini', 'ollama', 'openai', 'anthropic']);
		expect(providersSupporting('rag')).toEqual(['gemini']);
		expect(providersSupporting('imageGen')).toEqual(['gemini']);
		expect(providersSupporting('deepResearch')).toEqual(['gemini']);
	});

	it('providerSupports rejects unknown providers rather than throwing', () => {
		expect(providerSupports('mistral' as never, 'chat')).toBe(false);
		expect(providerSupports(null, 'chat')).toBe(false);
		expect(providerSupports(undefined, 'chat')).toBe(false);
	});

	// A settings file written by a newer version and then downgraded shouldn't
	// crash the plugin on load.
	it('getCapabilities falls back to Gemini for an unknown provider', () => {
		expect(getCapabilities('mistral' as never)).toBe(PROVIDERS.gemini.capabilities);
		expect(getCapabilities(undefined)).toBe(PROVIDERS.gemini.capabilities);
	});

	it('covers every routable feature for every declared provider', () => {
		for (const id of PROVIDER_IDS) {
			for (const feature of ROUTABLE_FEATURES) {
				expect(typeof PROVIDERS[id].capabilities[feature]).toBe('boolean');
			}
		}
	});

	it('carries a setup-guide docsUrl for the local/self-hosted providers', () => {
		expect(PROVIDERS.ollama.docsUrl).toBeTruthy();
		expect(PROVIDERS.openai.docsUrl).toBeTruthy();
	});
});
