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
	PROVIDER_USE_CASES,
	PROVIDERS,
	providerSupports,
	providersSupporting,
	type ProviderUseCase,
} from '../../src/api/providers/registry';

describe('capability matrix', () => {
	it('matches the documented Gemini capabilities', () => {
		const caps = PROVIDERS.gemini.capabilities;
		expect(caps.chat).toBe(true);
		expect(caps.summary).toBe(true);
		expect(caps.completions).toBe(true);
		expect(caps.rewrite).toBe(true);
		expect(caps.webSearch).toBe(true);
		expect(caps.rag).toBe(true);
		expect(caps.imageGen).toBe(true);
		expect(caps.requiresApiKey).toBe(true);
		expect(caps.nativeTokenCount).toBe(true);
		expect(caps.interactionsApi).toBe(true);
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
		expect(caps.rag).toBe(false);
		expect(caps.imageGen).toBe(false);
		expect(caps.requiresApiKey).toBe(false);
		expect(caps.nativeTokenCount).toBe(false);
		expect(caps.vision).toBe('auto-detect');
		// One resident model at a time (#1077).
		expect(caps.perUseCaseModels).toBe(false);
	});

	it('gives every provider a smaller default context limit than Gemini where local', () => {
		expect(PROVIDERS.gemini.capabilities.defaultInputTokenLimit).toBe(1_000_000);
		expect(PROVIDERS.ollama.capabilities.defaultInputTokenLimit).toBe(32_000);
	});

	it('declares every routable use case for every provider', () => {
		for (const id of PROVIDER_IDS) {
			for (const useCase of PROVIDER_USE_CASES) {
				expect(typeof PROVIDERS[id].capabilities[useCase]).toBe('boolean');
			}
		}
	});

	// Chat is the floor: a provider that can't chat can't be a primary, and
	// `resolveProviderOrDefault` would have nothing to fall back to.
	it('has every provider support chat', () => {
		for (const id of PROVIDER_IDS) {
			expect(providerSupports(id, 'chat')).toBe(true);
		}
	});
});

describe('lookup helpers', () => {
	it('providersSupporting lists candidates in display order', () => {
		expect(providersSupporting('chat')).toEqual(['gemini', 'ollama']);
		expect(providersSupporting('rag')).toEqual(['gemini']);
		expect(providersSupporting('imageGen')).toEqual(['gemini']);
	});

	it('providerSupports rejects unknown providers rather than throwing', () => {
		expect(providerSupports('openai' as never, 'chat')).toBe(false);
		expect(providerSupports(null, 'chat')).toBe(false);
		expect(providerSupports(undefined, 'chat')).toBe(false);
	});

	// A settings file written by a newer version and then downgraded shouldn't
	// crash the plugin on load.
	it('getCapabilities falls back to Gemini for an unknown provider', () => {
		expect(getCapabilities('openai' as never)).toBe(PROVIDERS.gemini.capabilities);
		expect(getCapabilities(undefined)).toBe(PROVIDERS.gemini.capabilities);
	});

	it('covers every use case in the exported list', () => {
		const declared = new Set<ProviderUseCase>(PROVIDER_USE_CASES);
		expect(declared).toEqual(
			new Set<ProviderUseCase>(['chat', 'summary', 'completions', 'rewrite', 'webSearch', 'rag', 'imageGen'])
		);
	});
});
