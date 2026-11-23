import {
	DEFAULT_GEMINI_MODELS,
	GEMINI_MODELS,
	findModelProvider,
	geminiGroundingModel,
	getActiveChatModel,
	getDefaultModelForRole,
	getUpdatedFeatureRoutes,
	GeminiModel,
	isInteractionsOnlyModel,
	contextWindowForModel,
	resolveFeatureModel,
	resolveFeatureModelFor,
	resolveGenerateContentModel,
	sessionChatModel,
	pinSessionChatModel,
	RETIRED_MODEL_SUCCESSORS,
	setGeminiModels,
} from '../src/models';
import type { FeatureRoutes, ProviderModelMemory } from '../src/types/features';
import type { FeatureRoutingSlice } from '../src/api/feature-routing';
import type { SessionModelConfig } from '../src/types/agent';

// Helper to temporarily modify GEMINI_MODELS for specific tests
const setTestModels = (models: GeminiModel[]) => {
	setGeminiModels(models);
};

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

describe('getDefaultModelForRole', () => {
	let originalModels: GeminiModel[];

	beforeEach(() => {
		// Save and restore original models for each test to ensure isolation
		originalModels = [...GEMINI_MODELS];
	});

	afterEach(() => {
		setTestModels(originalModels);
	});

	it('should return the model specified as default for a role', () => {
		setTestModels([
			{ value: 'model-a', label: 'Model A' },
			{ value: 'model-b-chat', label: 'Model B Chat', defaultForRoles: ['chat'] },
			{ value: 'model-c', label: 'Model C' },
		]);
		expect(getDefaultModelForRole('chat')).toBe('model-b-chat');
	});

	it('should fall back to the first model if no specific default is set for a role', () => {
		setTestModels([
			{ value: 'model-first', label: 'First Model' },
			{ value: 'model-second', label: 'Second Model' },
		]);
		// 'summary' role has no explicit default here
		expect(getDefaultModelForRole('summary')).toBe('model-first');
	});

	it('should not log a warning when falling back to the first model (warning removed)', () => {
		setTestModels([
			{ value: 'fallback-model', label: 'Fallback Model' },
			{ value: 'another-model', label: 'Another Model' },
		]);
		const consoleWarnSpy = vi.spyOn(console, 'warn');
		const result = getDefaultModelForRole('completions'); // No explicit default for completions

		// Should still fall back to first model, but no warning logged
		expect(result).toBe('fallback-model');
		expect(consoleWarnSpy).not.toHaveBeenCalled();
		consoleWarnSpy.mockRestore();
	});

	it('should throw an error if GEMINI_MODELS is empty', () => {
		setTestModels([]); // Make GEMINI_MODELS empty
		expect(() => getDefaultModelForRole('chat')).toThrow(
			'CRITICAL: no Gemini models are loaded. Please configure available models.'
		);
	});

	// Ollama and OpenAI models both load lazily (daemon /api/tags, /v1/models),
	// so an empty candidate list is a real, non-error state for either — unlike
	// the built-in Gemini fallback, which should never be empty.
	it('should return an empty string for ollama/openai when no models are registered yet', () => {
		setTestModels([]);
		expect(getDefaultModelForRole('chat', 'ollama')).toBe('');
		expect(getDefaultModelForRole('chat', 'openai')).toBe('');
	});

	// This test checks the actual imported GEMINI_MODELS state
	it('should ensure the global GEMINI_MODELS array is never actually empty', async () => {
		// This test relies on the original state of GEMINI_MODELS before any test modifications
		// If originalModels was captured from an already empty state, this test would be misleading.
		// This is more of an assertion about your actual data.
		const actualImportedModels = (await vi.importActual<typeof import('../src/models')>('../src/models')).GEMINI_MODELS;
		expect(actualImportedModels.length).toBeGreaterThan(0);
	});

	it('should return the completions model when completions role is specified', () => {
		setTestModels([
			{ value: 'gemini-2.5-pro-preview-05-06', label: 'Gemini 2.5 Pro', defaultForRoles: ['chat'] },
			{ value: 'gemini-2.5-flash-preview-04-17', label: 'Gemini 2.5 Flash', defaultForRoles: ['summary'] },
			{ value: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite', defaultForRoles: ['completions'] },
		]);
		expect(getDefaultModelForRole('completions')).toBe('gemini-2.0-flash-lite');
	});

	it('should return the summary model when summary role is specified', () => {
		setTestModels([
			{ value: 'gemini-2.5-pro-preview-05-06', label: 'Gemini 2.5 Pro', defaultForRoles: ['chat'] },
			{ value: 'gemini-2.5-flash-preview-04-17', label: 'Gemini 2.5 Flash', defaultForRoles: ['summary'] },
			{ value: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite', defaultForRoles: ['completions'] },
		]);
		expect(getDefaultModelForRole('summary')).toBe('gemini-2.5-flash-preview-04-17');
	});

	it('never falls back across the text/image model boundary', () => {
		setTestModels([
			{ value: 'openai-chat', label: 'OpenAI Chat', provider: 'openai' },
			{
				value: 'openai-image',
				label: 'OpenAI Image',
				provider: 'openai',
				supportsImageGeneration: true,
			},
		]);

		expect(getDefaultModelForRole('chat', 'openai')).toBe('openai-chat');
		expect(getDefaultModelForRole('image', 'openai')).toBe('openai-image');
	});

	it('skips explicit-only models for role defaults while honoring a saved selection', () => {
		setTestModels([
			{
				value: 'cloud::qwen2.5:1.5b',
				label: 'Qwen Cloud',
				provider: 'ollama',
				explicitOnly: true,
				defaultForRoles: ['completions'],
			},
			{ value: 'llama3.2', label: 'Llama Local', provider: 'ollama' },
		]);

		expect(getDefaultModelForRole('completions', 'ollama')).toBe('llama3.2');
		expect(getDefaultModelForRole('chat', 'ollama')).toBe('llama3.2');
		expect(
			resolveFeatureModel(
				{ features: routes({ completions: { provider: 'ollama', model: 'cloud::qwen2.5:1.5b' } }) },
				'completions'
			)
		).toBe('cloud::qwen2.5:1.5b');
	});

	it('returns no image default when a provider only advertises text models', () => {
		setTestModels([{ value: 'openai-chat', label: 'OpenAI Chat', provider: 'openai' }]);

		expect(getDefaultModelForRole('image', 'openai')).toBe('');
	});

	it('allows a compatible-endpoint model with unknown capabilities for text and image roles', () => {
		setTestModels([
			{
				value: 'custom-compatible-model',
				label: 'Custom Compatible Model',
				provider: 'openai',
				capabilitiesUnknown: true,
			},
		]);

		expect(getDefaultModelForRole('chat', 'openai')).toBe('custom-compatible-model');
		expect(getDefaultModelForRole('image', 'openai')).toBe('custom-compatible-model');
	});
});

describe('getDefaultModelForRole without a Gemini image model', () => {
	let originalModels: GeminiModel[];

	beforeEach(() => {
		originalModels = [...GEMINI_MODELS];
	});

	afterEach(() => {
		setGeminiModels(originalModels);
	});

	it('leaves the image role unset instead of throwing', () => {
		setGeminiModels([{ value: 'gemini-flash-latest', label: 'Flash', defaultForRoles: ['chat'] }]);
		expect(getDefaultModelForRole('image', 'gemini')).toBe('');
		expect(getDefaultModelForRole('chat', 'gemini')).toBe('gemini-flash-latest');
	});

	it('leaves text roles unset instead of throwing for an image-only list', () => {
		setGeminiModels([
			{
				value: 'gemini-2.5-flash-image',
				label: 'Nano Banana',
				supportsImageGeneration: true,
				defaultForRoles: ['image'],
			},
		]);
		for (const role of ['chat', 'summary', 'rewrite', 'completions'] as const) {
			expect(getDefaultModelForRole(role, 'gemini')).toBe('');
		}
		expect(getDefaultModelForRole('image', 'gemini')).toBe('gemini-2.5-flash-image');
	});
});

describe('built-in Gemini fallback list', () => {
	it('never ships a retired model', () => {
		const builtInIds = new Set(DEFAULT_GEMINI_MODELS.map((m) => m.value));
		for (const retired of Object.keys(RETIRED_MODEL_SUCCESSORS)) {
			expect(builtInIds.has(retired)).toBe(false);
		}
	});

	it('has a default for every model role', () => {
		for (const role of ['chat', 'summary', 'rewrite', 'completions', 'image'] as const) {
			expect(DEFAULT_GEMINI_MODELS.some((m) => m.defaultForRoles?.includes(role))).toBe(true);
		}
	});
});

describe('resolveFeatureModel', () => {
	let originalModels: GeminiModel[];

	beforeEach(() => {
		originalModels = [...GEMINI_MODELS];
		setTestModels([
			{ value: 'gemini-chat-default', label: 'Chat Default', defaultForRoles: ['chat'] },
			{ value: 'gemini-flash-lite', label: 'Flash Lite' },
			{ value: 'llama3.2', label: 'Llama 3.2', provider: 'ollama' as const, defaultForRoles: ['chat'] },
		]);
	});

	afterEach(() => {
		setTestModels(originalModels);
	});

	it('returns the stored model for a routed feature', () => {
		const s: FeatureRoutingSlice = { features: routes({ chat: { provider: 'gemini', model: 'gemini-flash-lite' } }) };
		expect(resolveFeatureModel(s, 'chat')).toBe('gemini-flash-lite');
	});

	it('returns a stored compatible-endpoint model for image generation', () => {
		const s: FeatureRoutingSlice = {
			features: routes({ imageGen: { provider: 'openai', model: 'custom-image-model' } }),
		};
		expect(resolveFeatureModel(s, 'imageGen')).toBe('custom-image-model');
	});

	it('falls back to getDefaultModelForRole when the stored model is ""', () => {
		const s: FeatureRoutingSlice = { features: routes({ chat: { provider: 'ollama', model: '' } }) };
		expect(resolveFeatureModel(s, 'chat')).toBe('llama3.2');
	});

	// Even for a feature routed to 'none', resolveFeatureModel must not throw —
	// it falls back to the Gemini default, since there's no provider to ask.
	it('falls back to the Gemini default for a "none" route', () => {
		const s: FeatureRoutingSlice = { features: routes({ chat: { provider: 'none', model: '' } }) };
		expect(resolveFeatureModel(s, 'chat')).toBe('gemini-chat-default');
	});

	it('returns "" for a model-less feature (deepResearch, rag)', () => {
		const s: FeatureRoutingSlice = { features: routes({ rag: { provider: 'gemini', model: '' } }) };
		expect(resolveFeatureModel(s, 'rag')).toBe('');
	});
});

describe('per-session provider model resolution (#1679)', () => {
	let originalModels: GeminiModel[];

	beforeEach(() => {
		originalModels = [...GEMINI_MODELS];
		setTestModels([
			{ value: 'gemini-chat-default', label: 'Chat Default', defaultForRoles: ['chat'] },
			{ value: 'llama3.2', label: 'Llama 3.2', provider: 'ollama' as const, defaultForRoles: ['chat'] },
		]);
	});

	afterEach(() => {
		setTestModels(originalModels);
	});

	const geminiChat = (): FeatureRoutingSlice => ({
		features: routes({ chat: { provider: 'gemini', model: 'gemini-flash-lite' } }),
	});

	it('uses the routed model when the session provider is the routed one', () => {
		expect(resolveFeatureModelFor(geminiChat(), 'chat', 'gemini')).toBe('gemini-flash-lite');
	});

	it("uses the remembered model for another provider, never the routed provider's model", () => {
		const s: FeatureRoutingSlice = {
			...geminiChat(),
			providerModelMemory: { ollama: { chat: 'qwen3' } },
		};
		expect(resolveFeatureModelFor(s, 'chat', 'ollama')).toBe('qwen3');
	});

	it("falls back to the other provider's role default when nothing is remembered", () => {
		expect(resolveFeatureModelFor(geminiChat(), 'chat', 'ollama')).toBe('llama3.2');
	});

	it('sessionChatModel prefers the session model, then the session provider, then the global chat model', () => {
		const s = geminiChat();
		expect(sessionChatModel(s, { model: 'pinned', provider: 'ollama' })).toBe('pinned');
		expect(sessionChatModel(s, { provider: 'ollama' })).toBe('llama3.2');
		expect(sessionChatModel(s, {})).toBe('gemini-flash-lite');
		expect(sessionChatModel(s, undefined)).toBe('gemini-flash-lite');
	});

	it('pinSessionChatModel pins the resolved model and provider so a turn needs no re-resolve', () => {
		const s = geminiChat();
		expect(pinSessionChatModel(s, undefined)).toEqual({ model: 'gemini-flash-lite', provider: 'gemini' });
		expect(pinSessionChatModel(s, { provider: 'ollama', promptTemplate: 'p.md' })).toEqual({
			model: 'llama3.2',
			provider: 'ollama',
			promptTemplate: 'p.md',
		});
		expect(pinSessionChatModel(s, { model: 'pinned' })).toEqual({ model: 'pinned', provider: 'gemini' });

		// The pinned value no longer depends on live settings.
		const pinned = pinSessionChatModel(s, {});
		const later: FeatureRoutingSlice = {
			features: routes({ chat: { provider: 'gemini', model: 'changed-later' } }),
		};
		expect(sessionChatModel(later, pinned)).toBe('gemini-flash-lite');
	});

	it('pinSessionChatModel leaves the provider unset when chat is off', () => {
		const off: FeatureRoutingSlice = { features: routes({ chat: { provider: 'none', model: '' } }) };
		const empty: SessionModelConfig = {};
		expect(pinSessionChatModel(off, empty).provider).toBeUndefined();
	});
});

describe('geminiGroundingModel', () => {
	let originalModels: GeminiModel[];

	beforeEach(() => {
		originalModels = [...GEMINI_MODELS];
	});

	afterEach(() => {
		setGeminiModels(originalModels);
	});

	it('follows the webSearch model when webSearch is on Gemini', () => {
		const s: FeatureRoutingSlice = {
			features: routes({ webSearch: { provider: 'gemini', model: 'gemini-2.5-flash' } }),
		};
		expect(geminiGroundingModel(s)).toBe('gemini-2.5-flash');
	});

	it('falls back to the bundled Gemini chat default when webSearch is on another provider', () => {
		const s: FeatureRoutingSlice = { features: routes({ webSearch: { provider: 'ollama', model: 'llama3.2' } }) };
		expect(geminiGroundingModel(s)).toBe('gemini-flash-latest');
	});

	it('falls back to the bundled Gemini chat default when webSearch is off', () => {
		const s: FeatureRoutingSlice = { features: routes({ webSearch: { provider: 'none', model: '' } }) };
		expect(geminiGroundingModel(s)).toBe('gemini-flash-latest');
	});
});

describe('getUpdatedFeatureRoutes', () => {
	let originalModels: GeminiModel[];

	beforeEach(() => {
		originalModels = [...GEMINI_MODELS];
		setTestModels([
			{ value: 'gemini-chat-default', label: 'Chat Default', defaultForRoles: ['chat'] },
			{ value: 'gemini-summary-default', label: 'Summary Default', defaultForRoles: ['summary'] },
			{ value: 'gemini-completions-default', label: 'Completions Default', defaultForRoles: ['completions'] },
			{
				value: 'gemini-image-default',
				label: 'Image Default',
				defaultForRoles: ['image'],
				supportsImageGeneration: true,
			},
			{ value: 'gemini-another-model', label: 'Another Model' },
		]);
	});

	afterEach(() => {
		setTestModels(originalModels);
	});

	it('does not change anything when every route names a valid model', () => {
		const features = routes({
			chat: { provider: 'gemini', model: 'gemini-chat-default' },
			summary: { provider: 'gemini', model: 'gemini-summary-default' },
		});
		const result = getUpdatedFeatureRoutes(features, {});
		expect(result.changed).toBe(false);
		expect(result.info).toEqual([]);
		expect(result.features).toEqual(features);
	});

	it('resets an invalid model to the role default and records it', () => {
		const features = routes({ chat: { provider: 'gemini', model: 'invalid-chat-model' } });
		const result = getUpdatedFeatureRoutes(features, {});
		expect(result.changed).toBe(true);
		expect(result.features.chat.model).toBe('gemini-chat-default');
		expect(result.info).toEqual(["chat model: 'invalid-chat-model' -> 'gemini-chat-default' (legacy model update)"]);
	});

	it('leaves a "none" route and a model-less feature alone', () => {
		const features = routes({
			webSearch: { provider: 'none', model: 'anything' },
			rag: { provider: 'gemini', model: 'anything' },
		});
		const result = getUpdatedFeatureRoutes(features, {});
		expect(result.changed).toBe(false);
		expect(result.features.webSearch.model).toBe('anything');
		expect(result.features.rag.model).toBe('anything');
	});

	it('migrates a retired model to its successor instead of the role default', () => {
		setTestModels([
			{ value: 'gemini-chat-default', label: 'Chat Default', defaultForRoles: ['chat'] },
			{ value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview' },
		]);
		const features = routes({ chat: { provider: 'gemini', model: 'gemini-3-pro-preview' } });
		const result = getUpdatedFeatureRoutes(features, {});
		expect(result.changed).toBe(true);
		expect(result.features.chat.model).toBe('gemini-3.1-pro-preview');
		expect(result.info).toEqual([
			"chat model: 'gemini-3-pro-preview' -> 'gemini-3.1-pro-preview' (retired model migrated to successor)",
		]);
	});

	it('reconciles each route against its own provider list only', () => {
		setTestModels([
			{ value: 'gemini-chat-default', label: 'Chat Default', defaultForRoles: ['chat'] },
			{ value: 'llama3.2', label: 'Llama 3.2', provider: 'ollama' as const, defaultForRoles: ['chat'] },
		]);
		const features = routes({
			chat: { provider: 'ollama', model: 'gemini-chat-default' }, // a Gemini id under Ollama is invalid
		});
		const result = getUpdatedFeatureRoutes(features, {});
		expect(result.changed).toBe(true);
		expect(result.features.chat.model).toBe('llama3.2');
	});

	it('tolerates a stale model while the provider list has not loaded yet (empty list)', () => {
		// Only Gemini models are registered — Ollama's list loads later.
		const features = routes({ chat: { provider: 'ollama', model: 'llama3.2' } });
		const result = getUpdatedFeatureRoutes(features, {});
		expect(result.changed).toBe(false);
		expect(result.features.chat.model).toBe('llama3.2');
	});

	it('clears an image model when the loaded provider catalog contains only text models', () => {
		setTestModels([{ value: 'openai-chat', label: 'OpenAI Chat', provider: 'openai' }]);
		const features = routes({ imageGen: { provider: 'openai', model: 'openai-chat' } });

		const result = getUpdatedFeatureRoutes(features, {});

		expect(result.changed).toBe(true);
		expect(result.features.imageGen.model).toBe('');
	});

	it('preserves a compatible-endpoint model with unknown capabilities for image generation', () => {
		setTestModels([
			{
				value: 'custom-image-model',
				label: 'Custom Image Model',
				provider: 'openai',
				capabilitiesUnknown: true,
			},
		]);
		const features = routes({ imageGen: { provider: 'openai', model: 'custom-image-model' } });

		const result = getUpdatedFeatureRoutes(features, {});

		expect(result.changed).toBe(false);
		expect(result.features.imageGen.model).toBe('custom-image-model');
	});

	it('reconciles providerModelMemory the same way, per provider', () => {
		const memory: ProviderModelMemory = { gemini: { chat: 'invalid-chat-model', summary: 'gemini-summary-default' } };
		const result = getUpdatedFeatureRoutes(routes({}), memory);
		expect(result.changed).toBe(true);
		expect(result.memory.gemini?.chat).toBe('gemini-chat-default');
		expect(result.memory.gemini?.summary).toBe('gemini-summary-default');
	});

	it('returns fresh objects, never mutating the inputs', () => {
		const features = routes({ chat: { provider: 'gemini', model: 'invalid-chat-model' } });
		const memory: ProviderModelMemory = {};
		const result = getUpdatedFeatureRoutes(features, memory);
		expect(result.features).not.toBe(features);
		expect(result.memory).not.toBe(memory);
		expect(features.chat.model).toBe('invalid-chat-model');
	});
});

describe('isInteractionsOnlyModel', () => {
	let originalModels: GeminiModel[];

	beforeEach(() => {
		originalModels = [...GEMINI_MODELS];
	});

	afterEach(() => {
		setGeminiModels(originalModels);
	});

	it('returns false for regular bundled models', () => {
		expect(isInteractionsOnlyModel('gemini-flash-latest')).toBe(false);
		expect(isInteractionsOnlyModel('gemini-2.5-flash')).toBe(false);
	});

	it('returns false for unknown models and empty values', () => {
		expect(isInteractionsOnlyModel('some-unknown-model')).toBe(false);
		expect(isInteractionsOnlyModel('')).toBe(false);
		expect(isInteractionsOnlyModel(undefined)).toBe(false);
		expect(isInteractionsOnlyModel(null)).toBe(false);
	});

	it('reads the flag from the live model list (remote updates)', () => {
		setGeminiModels([{ value: 'future-interactions-model', label: 'Future', interactionsOnly: true }]);
		expect(isInteractionsOnlyModel('future-interactions-model')).toBe(true);
	});

	it('honors an explicit false in the live list', () => {
		setGeminiModels([{ value: 'gemini-omni-flash-preview', label: 'Omni', interactionsOnly: false }]);
		expect(isInteractionsOnlyModel('gemini-omni-flash-preview')).toBe(false);
	});
});

describe('contextWindowForModel', () => {
	let originalModels: GeminiModel[];

	beforeEach(() => {
		originalModels = [...GEMINI_MODELS];
	});

	afterEach(() => {
		setGeminiModels(originalModels);
	});

	it('returns the window a discovered model carries', () => {
		setGeminiModels([{ value: 'gpt-5.6-luna', label: 'gpt-5.6-luna', provider: 'openai', contextWindow: 922_000 }]);
		expect(contextWindowForModel('gpt-5.6-luna')).toBe(922_000);
	});

	it('returns null for a model with no declared window, so callers use the provider default', () => {
		setGeminiModels([{ value: 'some-local-model', label: 'Local', provider: 'openai' }]);
		expect(contextWindowForModel('some-local-model')).toBeNull();
	});

	it('returns null for unknown models and empty values', () => {
		expect(contextWindowForModel('not-a-real-model')).toBeNull();
		expect(contextWindowForModel('')).toBeNull();
		expect(contextWindowForModel(undefined)).toBeNull();
		expect(contextWindowForModel(null)).toBeNull();
	});
});

const INTERACTIONS_ONLY_MODEL: GeminiModel = {
	value: 'test-interactions-only-model',
	label: 'Interactions Only',
	interactionsOnly: true,
};

describe('resolveGenerateContentModel', () => {
	let originalModels: GeminiModel[];

	beforeEach(() => {
		originalModels = [...GEMINI_MODELS];
	});

	afterEach(() => {
		setGeminiModels(originalModels);
	});

	it('returns the preferred model when it can use generateContent', () => {
		expect(resolveGenerateContentModel('gemini-2.5-flash')).toBe('gemini-2.5-flash');
	});

	it('substitutes the chat default for an interactions-only model', () => {
		setGeminiModels([...DEFAULT_GEMINI_MODELS, INTERACTIONS_ONLY_MODEL]);
		expect(resolveGenerateContentModel(INTERACTIONS_ONLY_MODEL.value)).toBe('gemini-flash-latest');
	});

	it('substitutes the bundled default for empty values', () => {
		expect(resolveGenerateContentModel('')).toBe('gemini-flash-latest');
		expect(resolveGenerateContentModel(undefined)).toBe('gemini-flash-latest');
	});

	it('resolves against the requested role', () => {
		setGeminiModels([...DEFAULT_GEMINI_MODELS, INTERACTIONS_ONLY_MODEL]);
		expect(resolveGenerateContentModel(INTERACTIONS_ONLY_MODEL.value, 'completions')).toBe('gemini-flash-lite-latest');
	});
});

describe('findModelProvider', () => {
	let originalModels: GeminiModel[];

	beforeEach(() => {
		originalModels = [...GEMINI_MODELS];
		setTestModels([
			{ value: 'gemini-chat-default', label: 'Chat Default', defaultForRoles: ['chat'] },
			{ value: 'llama3.2', label: 'Llama 3.2', provider: 'ollama' as const },
			{ value: 'gpt-5.6', label: 'gpt-5.6', provider: 'openai' as const },
		]);
	});

	afterEach(() => {
		setTestModels(originalModels);
	});

	it('identifies each provider from the union model list', () => {
		expect(findModelProvider('gemini-chat-default')).toBe('gemini');
		expect(findModelProvider('llama3.2')).toBe('ollama');
		expect(findModelProvider('gpt-5.6')).toBe('openai');
	});

	// Ollama tags only enter the list once the daemon answers, so an unknown
	// model is a real state — callers need to tell it apart from "it's Gemini".
	it('returns null for a model that is in no known list', () => {
		expect(findModelProvider('mistral-nemo')).toBeNull();
		expect(findModelProvider('')).toBeNull();
		expect(findModelProvider(undefined)).toBeNull();
	});

	it('falls back to the bundled list when the global list has been narrowed', () => {
		const bundled = DEFAULT_GEMINI_MODELS[0].value;
		setTestModels([{ value: 'llama3.2', label: 'Llama 3.2', provider: 'ollama' as const }]);
		expect(findModelProvider(bundled)).toBe('gemini');
	});
});

describe('getActiveChatModel', () => {
	let originalModels: GeminiModel[];

	beforeEach(() => {
		originalModels = [...GEMINI_MODELS];
		setTestModels([
			{ value: 'gemini-chat-default', label: 'Chat Default', defaultForRoles: ['chat'] },
			{ value: 'gemini-flash-lite', label: 'Flash Lite' },
			{ value: 'llama3.2', label: 'Llama 3.2', provider: 'ollama' as const, defaultForRoles: ['chat'] },
			{ value: 'gpt-5.6', label: 'gpt-5.6', provider: 'openai' as const, defaultForRoles: ['chat'] },
		]);
	});

	afterEach(() => {
		setTestModels(originalModels);
	});

	it('returns the stored model for whichever provider serves chat', () => {
		const s: FeatureRoutingSlice = { features: routes({ chat: { provider: 'gemini', model: 'gemini-flash-lite' } }) };
		expect(getActiveChatModel(s)).toBe('gemini-flash-lite');
	});

	it('follows chat to whichever provider it is routed to, independent of other features', () => {
		const s: FeatureRoutingSlice = {
			features: routes({
				chat: { provider: 'ollama', model: 'llama3.2' },
				summary: { provider: 'gemini', model: 'gemini-flash-lite' },
			}),
		};
		expect(getActiveChatModel(s)).toBe('llama3.2');
	});

	it('falls back to the Gemini chat default when chat is off', () => {
		const s: FeatureRoutingSlice = { features: routes({ chat: { provider: 'none', model: '' } }) };
		expect(getActiveChatModel(s)).toBe('gemini-chat-default');
	});

	it('resolves the OpenAI model when OpenAI serves chat', () => {
		const s: FeatureRoutingSlice = { features: routes({ chat: { provider: 'openai', model: 'gpt-5.6' } }) };
		expect(getActiveChatModel(s)).toBe('gpt-5.6');
	});
});
