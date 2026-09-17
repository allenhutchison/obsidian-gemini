/**
 * Tests for the dense feature-routing model (settings redesign; successor to
 * per-use-case provider routing, #704).
 *
 * The load-bearing guarantee is "no silent fallback": a feature is served by
 * exactly the provider stored on its own route, or it is off. Nothing here
 * ever substitutes a different provider for one that can't serve a feature.
 */
import {
	activeProviders,
	featureModel,
	featureProvider,
	featuresUsing,
	isProviderActive,
	recallModel,
	rememberModel,
	routingKey,
	sanitizeFeatureRoutes,
	sanitizeProviderModelMemory,
	type FeatureRoutingSlice,
} from '../../src/api/feature-routing';
import { FEATURE_IDS, type FeatureRoutes } from '../../src/types/features';

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

describe('featureProvider', () => {
	it('resolves the stored provider when it can serve the feature', () => {
		const s: FeatureRoutingSlice = { features: routes({ chat: { provider: 'ollama', model: '' } }) };
		expect(featureProvider(s, 'chat')).toBe('ollama');
	});

	it('returns null for a feature routed to "none"', () => {
		const s: FeatureRoutingSlice = { features: routes({ chat: { provider: 'none', model: '' } }) };
		expect(featureProvider(s, 'chat')).toBeNull();
	});

	// The privacy-critical case: an unsupported pairing must resolve to null,
	// never fall back to a provider that does support the feature.
	it('returns null (never substitutes) for a provider that cannot serve the feature', () => {
		const s: FeatureRoutingSlice = { features: routes({ rag: { provider: 'ollama', model: '' } }) };
		expect(featureProvider(s, 'rag')).toBeNull();
	});

	it('defaults to "none" for a missing/partial slice', () => {
		expect(featureProvider(undefined, 'chat')).toBeNull();
		expect(featureProvider({}, 'chat')).toBeNull();
	});
});

describe('featureModel', () => {
	// B2 contract: the stored string is returned verbatim, '' is legal, and no
	// default is ever resolved here (that is resolveFeatureModel in models.ts).
	it('returns the stored model string verbatim, including empty string', () => {
		const s: FeatureRoutingSlice = { features: routes({ chat: { provider: 'gemini', model: 'gemini-3-pro' } }) };
		expect(featureModel(s, 'chat')).toBe('gemini-3-pro');
		expect(featureModel({ features: routes({}) }, 'chat')).toBe('');
	});

	it('returns "" for a feature routed to "none", not a resolved default', () => {
		expect(featureModel({ features: routes({}) }, 'webSearch')).toBe('');
	});
});

describe('activeProviders / isProviderActive', () => {
	it('includes defaultProvider even when no feature uses it', () => {
		const s: FeatureRoutingSlice = { defaultProvider: 'openai', features: routes({}) };
		expect(activeProviders(s)).toEqual(['openai']);
	});

	it('includes every provider actually serving a feature, in PROVIDER_IDS order', () => {
		const s: FeatureRoutingSlice = {
			defaultProvider: 'ollama',
			features: routes({ rag: { provider: 'gemini', model: '' }, chat: { provider: 'openai', model: '' } }),
		};
		expect(activeProviders(s)).toEqual(['gemini', 'ollama', 'openai']);
	});

	it('never includes "none"', () => {
		const s: FeatureRoutingSlice = { defaultProvider: 'gemini', features: routes({}) };
		expect(activeProviders(s)).toEqual(['gemini']);
	});

	it('isProviderActive reflects activeProviders membership', () => {
		const s: FeatureRoutingSlice = {
			defaultProvider: 'ollama',
			features: routes({ rag: { provider: 'gemini', model: '' } }),
		};
		expect(isProviderActive(s, 'gemini')).toBe(true);
		expect(isProviderActive(s, 'openai')).toBe(false);
	});
});

describe('featuresUsing', () => {
	it('lists every feature currently served by a provider', () => {
		const s: FeatureRoutingSlice = {
			features: routes({
				chat: { provider: 'gemini', model: '' },
				rag: { provider: 'gemini', model: '' },
				summary: { provider: 'ollama', model: '' },
			}),
		};
		expect(featuresUsing(s, 'gemini')).toEqual(['chat', 'rag']);
		expect(featuresUsing(s, 'ollama')).toEqual(['summary']);
	});
});

describe('routingKey', () => {
	it('is stable across a model-only change', () => {
		const a: FeatureRoutingSlice = { features: routes({ chat: { provider: 'gemini', model: 'a' } }) };
		const b: FeatureRoutingSlice = { features: routes({ chat: { provider: 'gemini', model: 'b' } }) };
		expect(routingKey(a)).toBe(routingKey(b));
	});

	it('changes when a feature is re-routed to a different provider', () => {
		const before = routingKey({ features: routes({ chat: { provider: 'gemini', model: '' } }) });
		const after = routingKey({ features: routes({ chat: { provider: 'ollama', model: '' } }) });
		expect(after).not.toBe(before);
	});

	it('changes when defaultProvider changes', () => {
		expect(routingKey({ defaultProvider: 'ollama', features: routes({}) })).not.toBe(
			routingKey({ defaultProvider: 'gemini', features: routes({}) })
		);
	});
});

describe('sanitizeFeatureRoutes', () => {
	it('is total over FEATURE_IDS and returns a fresh object', () => {
		const result = sanitizeFeatureRoutes({}, 'gemini');
		for (const f of FEATURE_IDS) {
			expect(result[f]).toBeDefined();
		}
		const mutated = { ...result, chat: { provider: 'ollama' as const, model: 'x' } };
		expect(mutated).not.toBe(result);
		expect(result.chat.provider).toBe('gemini');
	});

	it('seeds a genuinely missing entry from defaultProvider when it can serve the feature', () => {
		const result = sanitizeFeatureRoutes({}, 'gemini');
		expect(result.chat).toEqual({ provider: 'gemini', model: '' });
	});

	it('seeds a genuinely missing entry to "none" when defaultProvider cannot serve it', () => {
		const result = sanitizeFeatureRoutes({}, 'ollama');
		expect(result.rag.provider).toBe('none');
	});

	it('maps an unknown provider id to "none"', () => {
		const result = sanitizeFeatureRoutes({ chat: { provider: 'mistral', model: '' } }, 'gemini');
		expect(result.chat.provider).toBe('none');
	});

	it('maps an unsupported pairing to "none", never to a substitute provider', () => {
		const result = sanitizeFeatureRoutes({ rag: { provider: 'ollama', model: '' } }, 'gemini');
		expect(result.rag.provider).toBe('none');
	});

	it('preserves an explicit "none" as-is', () => {
		const result = sanitizeFeatureRoutes({ chat: { provider: 'none', model: '' } }, 'gemini');
		expect(result.chat.provider).toBe('none');
	});

	it('coerces a non-string model to ""', () => {
		const result = sanitizeFeatureRoutes({ chat: { provider: 'gemini', model: 42 } }, 'gemini');
		expect(result.chat.model).toBe('');
	});

	it('coerces non-object input to a total default map', () => {
		const result = sanitizeFeatureRoutes(undefined, 'gemini');
		expect(Object.keys(result).sort()).toEqual([...FEATURE_IDS].sort());
	});
});

describe('sanitizeProviderModelMemory', () => {
	it('drops unknown providers, unknown features, and non-string values', () => {
		const result = sanitizeProviderModelMemory({
			gemini: { chat: 'gemini-3-pro', bogusFeature: 'x' },
			mistral: { chat: 'mistral-large' },
			ollama: { summary: 42 },
		});
		expect(result).toEqual({ gemini: { chat: 'gemini-3-pro' } });
	});

	it('returns a fresh empty object for non-object input', () => {
		expect(sanitizeProviderModelMemory(undefined)).toEqual({});
		expect(sanitizeProviderModelMemory(null)).toEqual({});
	});
});

describe('rememberModel / recallModel', () => {
	it('round-trips a model choice per (provider, feature)', () => {
		const s: FeatureRoutingSlice = { providerModelMemory: {} };
		rememberModel(s, 'chat', 'gemini', 'gemini-3-pro');
		expect(recallModel(s, 'chat', 'gemini')).toBe('gemini-3-pro');
		expect(recallModel(s, 'chat', 'ollama')).toBe('');
	});

	it('ignores an empty model (nothing to remember)', () => {
		const s: FeatureRoutingSlice = {};
		rememberModel(s, 'chat', 'gemini', '');
		expect(recallModel(s, 'chat', 'gemini')).toBe('');
	});
});
