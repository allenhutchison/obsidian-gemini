/**
 * Tests for per-use-case provider routing (#704).
 *
 * The load-bearing guarantees here are (a) an install that predates the feature
 * behaves identically, and (b) the resolver never silently sends a use case to
 * a cloud provider the user didn't pick for it.
 */
import {
	activeProviders,
	isProviderActive,
	overriddenUseCases,
	primaryProvider,
	resolveProvider,
	resolveProviderOrDefault,
	routingKey,
	sanitizeProviderOverrides,
} from '../../src/api/provider-routing';
import { PROVIDER_USE_CASES } from '../../src/api/providers/registry';

describe('resolveProvider', () => {
	it('falls back to the primary for a use case with no override', () => {
		expect(resolveProvider({ provider: 'ollama' }, 'chat')).toBe('ollama');
		expect(resolveProvider({ provider: 'gemini' }, 'chat')).toBe('gemini');
	});

	it('defaults the primary to gemini when settings are missing or partial', () => {
		expect(resolveProvider(undefined, 'chat')).toBe('gemini');
		expect(resolveProvider({}, 'chat')).toBe('gemini');
		expect(primaryProvider(null)).toBe('gemini');
	});

	it('prefers an override over the primary', () => {
		expect(resolveProvider({ provider: 'gemini', providerOverrides: { summary: 'ollama' } }, 'summary')).toBe('ollama');
	});

	it('leaves other use cases on the primary when one is overridden', () => {
		const settings = { provider: 'gemini' as const, providerOverrides: { summary: 'ollama' as const } };
		expect(resolveProvider(settings, 'chat')).toBe('gemini');
		expect(resolveProvider(settings, 'completions')).toBe('gemini');
	});

	// The privacy-critical case: a local primary must not have cloud features
	// switched on for it. Unsupported means off, never "use the other provider".
	it('returns null instead of substituting a provider that supports the use case', () => {
		expect(resolveProvider({ provider: 'ollama' }, 'rag')).toBeNull();
		expect(resolveProvider({ provider: 'ollama' }, 'imageGen')).toBeNull();
		expect(resolveProvider({ provider: 'ollama' }, 'webSearch')).toBeNull();
	});

	it('enables a capability-gated use case only when explicitly overridden', () => {
		const settings = { provider: 'ollama' as const, providerOverrides: { rag: 'gemini' as const } };
		expect(resolveProvider(settings, 'rag')).toBe('gemini');
		// Still off — each cloud feature is opted into on its own.
		expect(resolveProvider(settings, 'imageGen')).toBeNull();
		expect(resolveProvider(settings, 'webSearch')).toBeNull();
	});

	it('returns null for an override pointing at a provider that cannot serve the use case', () => {
		expect(resolveProvider({ provider: 'gemini', providerOverrides: { rag: 'ollama' } }, 'rag')).toBeNull();
	});

	it('resolveProviderOrDefault substitutes gemini where a client is mandatory', () => {
		expect(resolveProviderOrDefault({ provider: 'ollama' }, 'chat')).toBe('ollama');
		expect(resolveProviderOrDefault({ provider: 'ollama' }, 'rag')).toBe('gemini');
	});
});

describe('OpenAI routing', () => {
	it('resolves every routable use case OpenAI supports, and null for the rest', () => {
		const enabled = PROVIDER_USE_CASES.filter((u) => resolveProvider({ provider: 'openai' }, u) !== null);
		expect(enabled).toEqual(['chat', 'summary', 'completions', 'rewrite']);
	});

	it('participates in activeProviders and routingKey like any other provider', () => {
		expect(activeProviders({ provider: 'openai' })).toEqual(['openai']);
		expect(isProviderActive({ provider: 'ollama', providerOverrides: { chat: 'openai' } }, 'openai')).toBe(true);
		expect(routingKey({ provider: 'openai' })).not.toBe(routingKey({ provider: 'gemini' }));
	});

	it('resolveProviderOrDefault keeps OpenAI for a mandatory-client use case', () => {
		expect(resolveProviderOrDefault({ provider: 'openai' }, 'chat')).toBe('openai');
	});
});

describe('backward compatibility', () => {
	// An install from before #704 has a primary and no overrides. Every use case
	// must resolve exactly as the old single-provider check did.
	it('resolves a pre-#704 gemini install identically for every use case', () => {
		for (const useCase of PROVIDER_USE_CASES) {
			expect(resolveProvider({ provider: 'gemini' }, useCase)).toBe('gemini');
		}
	});

	it('resolves a pre-#704 ollama install to ollama exactly where ollama was supported', () => {
		const enabled = PROVIDER_USE_CASES.filter((u) => resolveProvider({ provider: 'ollama' }, u) !== null);
		expect(enabled).toEqual(['chat', 'summary', 'completions', 'rewrite']);
	});
});

describe('activeProviders', () => {
	it('is just the primary when nothing is overridden', () => {
		expect(activeProviders({ provider: 'ollama' })).toEqual(['ollama']);
		expect(activeProviders({ provider: 'gemini' })).toEqual(['gemini']);
	});

	it('includes a provider reached only through an override', () => {
		expect(activeProviders({ provider: 'ollama', providerOverrides: { rag: 'gemini' } })).toEqual(['gemini', 'ollama']);
	});

	it('ignores an override that resolves to null', () => {
		expect(activeProviders({ provider: 'gemini', providerOverrides: { rag: 'ollama' } })).toEqual(['gemini']);
	});

	it('isProviderActive reflects override-only usage', () => {
		const settings = { provider: 'ollama' as const, providerOverrides: { webSearch: 'gemini' as const } };
		expect(isProviderActive(settings, 'gemini')).toBe(true);
		expect(isProviderActive({ provider: 'ollama' }, 'gemini')).toBe(false);
	});
});

describe('overriddenUseCases', () => {
	it('is empty for a uniform configuration', () => {
		expect(overriddenUseCases({ provider: 'gemini' })).toEqual([]);
		expect(overriddenUseCases({ provider: 'ollama' })).toEqual([]);
	});

	it('lists only use cases actually served by a non-primary provider', () => {
		const settings = {
			provider: 'ollama' as const,
			// rag resolves to gemini (counts); chat is overridden to the primary
			// itself (doesn't count).
			providerOverrides: { rag: 'gemini' as const, chat: 'ollama' as const },
		};
		expect(overriddenUseCases(settings)).toEqual(['rag']);
	});
});

describe('routingKey', () => {
	it('is stable for equivalent configurations', () => {
		expect(routingKey({ provider: 'gemini' })).toBe(routingKey({ provider: 'gemini', providerOverrides: {} }));
	});

	it('changes when a single use case is re-routed', () => {
		const before = routingKey({ provider: 'gemini' });
		const after = routingKey({ provider: 'gemini', providerOverrides: { summary: 'ollama' } });
		expect(after).not.toBe(before);
	});

	it('changes when the primary changes', () => {
		expect(routingKey({ provider: 'ollama' })).not.toBe(routingKey({ provider: 'gemini' }));
	});

	// An override that resolves to the primary is a no-op, so it must not force
	// a spurious re-initialization.
	it('is unchanged by an override that matches the primary', () => {
		expect(routingKey({ provider: 'gemini', providerOverrides: { chat: 'gemini' } })).toBe(
			routingKey({ provider: 'gemini' })
		);
	});
});

describe('sanitizeProviderOverrides', () => {
	it('returns a fresh object so the settings default is never aliased', () => {
		const source = { chat: 'ollama' };
		const result = sanitizeProviderOverrides(source);
		expect(result).toEqual({ chat: 'ollama' });
		expect(result).not.toBe(source);
	});

	it('drops unknown use cases and unknown providers', () => {
		expect(sanitizeProviderOverrides({ chat: 'anthropic', bogus: 'gemini', rag: 'gemini' })).toEqual({
			rag: 'gemini',
		});
	});

	// A pairing resolveProvider would treat as null must not survive in storage:
	// the settings dropdown only offers providersSupporting(useCase), so a stored
	// value with no matching option renders the row blank.
	it('drops a provider that cannot serve the use case it is mapped to', () => {
		expect(sanitizeProviderOverrides({ rag: 'ollama', imageGen: 'ollama', webSearch: 'ollama' })).toEqual({});
	});

	it('keeps supported pairings alongside dropped ones', () => {
		expect(sanitizeProviderOverrides({ rag: 'ollama', summary: 'ollama', imageGen: 'gemini' })).toEqual({
			summary: 'ollama',
			imageGen: 'gemini',
		});
	});

	it('coerces non-object input to an empty map', () => {
		expect(sanitizeProviderOverrides(undefined)).toEqual({});
		expect(sanitizeProviderOverrides(null)).toEqual({});
		expect(sanitizeProviderOverrides('gemini')).toEqual({});
		expect(sanitizeProviderOverrides(['gemini'])).toEqual({});
	});
});
