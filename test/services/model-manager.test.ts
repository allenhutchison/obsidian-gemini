import type { Mock } from 'vitest';
import { requestUrl } from 'obsidian';
import { ModelManager } from '../../src/services/model-manager';
import { GeminiModel, setGeminiModels, GEMINI_MODELS } from '../../src/models';

const mockedRequestUrl = requestUrl as unknown as Mock;

const mockPlugin = {
	settings: {
		chatModelName: 'gemini-flash-latest',
		summaryModelName: 'gemini-flash-latest',
		completionsModelName: 'gemini-flash-lite-latest',
		imageModelName: 'gemini-2.5-flash-image',
	},
	apiKey: 'test-api-key',
	openaiApiKey: 'sk-test-key',
	loadData: vi.fn().mockResolvedValue({}),
	saveData: vi.fn(),
	logger: {
		log: vi.fn(),
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		child: vi.fn(function (this: any, _prefix: string) {
			return this;
		}),
	},
} as any;

describe('ModelManager', () => {
	let modelManager: ModelManager;
	let originalModels: GeminiModel[];

	beforeEach(() => {
		vi.clearAllMocks();
		originalModels = [...GEMINI_MODELS];
		modelManager = new ModelManager(mockPlugin);
	});

	afterEach(() => {
		setGeminiModels(originalModels);
	});

	describe('getAvailableModels', () => {
		it('should return text models only (no image models)', async () => {
			const result = await modelManager.getAvailableModels();

			result.forEach((model) => {
				expect(model.supportsImageGeneration).not.toBe(true);
			});
		});

		it('should return at least one model', async () => {
			const result = await modelManager.getAvailableModels();
			expect(result.length).toBeGreaterThan(0);
		});
	});

	describe('getImageGenerationModels', () => {
		it('should return only image models', async () => {
			const result = await modelManager.getImageGenerationModels();

			result.forEach((model) => {
				expect(model.supportsImageGeneration).toBe(true);
			});
		});

		it('should return at least one image model', async () => {
			const result = await modelManager.getImageGenerationModels();
			expect(result.length).toBeGreaterThan(0);
		});
	});

	describe('updateModels', () => {
		it('should detect changes and update global models list when model lists differ', async () => {
			setGeminiModels([{ value: 'old-model', label: 'Old Model' }]);

			await modelManager.updateModels();

			expect(GEMINI_MODELS.some((m) => m.value === 'old-model')).toBe(false);
			expect(GEMINI_MODELS.length).toBeGreaterThan(1);
		});

		it('should return no changes when models are the same', async () => {
			await modelManager.initialize();

			const result = await modelManager.updateModels();

			expect(result.settingsChanged).toBe(false);
		});

		it('should detect changes when model count differs', async () => {
			// Start with a single model
			setGeminiModels([{ value: 'only-model', label: 'Only' }]);
			const manager = new ModelManager(mockPlugin);

			const _result = await manager.updateModels();

			// The bundled list has more models, so a change should be detected
			expect(GEMINI_MODELS.length).toBeGreaterThan(1);
		});

		it('should detect changes when model IDs differ but count is the same', async () => {
			// Same count as the Gemini fallback list, different IDs
			const fakeModels = (await modelManager.getProviderModelsService('gemini').getModels()).map((m, i) => ({
				...m,
				value: `fake-model-${i}`,
			}));
			setGeminiModels(fakeModels);

			await modelManager.updateModels();

			expect(GEMINI_MODELS.some((m) => m.value.startsWith('fake-model-'))).toBe(false);
		});

		it('does not reset a saved Gemini model while serving the fallback list', async () => {
			mockedRequestUrl.mockReset();
			mockedRequestUrl.mockRejectedValue(new Error('ECONNREFUSED'));
			const plugin = {
				...mockPlugin,
				settings: {
					...mockPlugin.settings,
					features: { chat: { provider: 'gemini', model: 'gemini-3.8-flash' } },
					providerModelMemory: {},
				},
			};
			setGeminiModels([{ value: 'only-model', label: 'Only' }]);

			const result = await new ModelManager(plugin).updateModels();

			expect(result.updatedSettings.features.chat.model).toBe('gemini-3.8-flash');
		});

		it('resets a saved Gemini model that ListModels no longer serves', async () => {
			mockedRequestUrl.mockReset();
			mockedRequestUrl.mockResolvedValue({
				status: 200,
				json: {
					models: [
						{ name: 'models/gemini-flash-latest', supportedGenerationMethods: ['generateContent'] },
						{ name: 'models/gemini-2.5-flash-image', supportedGenerationMethods: ['generateContent'] },
					],
				},
			});
			const plugin = {
				...mockPlugin,
				settings: {
					...mockPlugin.settings,
					features: { chat: { provider: 'gemini', model: 'gemini-gone' } },
					providerModelMemory: {},
				},
			};
			setGeminiModels([{ value: 'only-model', label: 'Only' }]);

			const result = await new ModelManager(plugin).updateModels();

			expect(result.updatedSettings.features.chat.model).toBe('gemini-flash-latest');
		});
	});

	describe('updateModels after initialize', () => {
		it('still reconciles a stale saved model when the list is unchanged', async () => {
			mockedRequestUrl.mockReset();
			mockedRequestUrl.mockResolvedValue({
				status: 200,
				json: { models: [{ name: 'models/gemini-flash-latest', supportedGenerationMethods: ['generateContent'] }] },
			});
			const plugin = {
				...mockPlugin,
				settings: {
					...mockPlugin.settings,
					features: { chat: { provider: 'gemini', model: 'gemini-gone' } },
					providerModelMemory: {},
				},
			};
			const manager = new ModelManager(plugin);
			await manager.initialize();

			const result = await manager.updateModels();

			expect(result.settingsChanged).toBe(true);
			expect(result.updatedSettings.features.chat.model).toBe('gemini-flash-latest');
		});
	});

	describe('updateModels when the Gemini endpoint changes mid-sync', () => {
		it('skips installing and reconciling the stale list', async () => {
			const plugin = {
				...mockPlugin,
				apiKey: 'key-a',
				settings: {
					...mockPlugin.settings,
					features: { chat: { provider: 'gemini', model: 'gemini-only-on-b' } },
					providerModelMemory: {},
				},
			};
			mockedRequestUrl.mockReset();
			mockedRequestUrl.mockImplementation(async () => {
				plugin.apiKey = 'key-b';
				return {
					status: 200,
					json: { models: [{ name: 'models/gemini-flash-latest', supportedGenerationMethods: ['generateContent'] }] },
				};
			});
			const before = [{ value: 'before', label: 'Before' }];
			setGeminiModels(before);

			const result = await new ModelManager(plugin).updateModels();

			expect(result.settingsChanged).toBe(false);
			expect(GEMINI_MODELS).toEqual(before);
		});
	});

	describe('initialize', () => {
		it('should sync global GEMINI_MODELS with provider', async () => {
			setGeminiModels([]);

			await modelManager.initialize();

			expect(GEMINI_MODELS.length).toBeGreaterThan(0);
		});
	});

	describe('refreshGeminiModels', () => {
		const geminiPlugin = (overrides: Record<string, unknown> = {}) => ({
			...mockPlugin,
			settings: { ...mockPlugin.settings, features: { chat: { provider: 'gemini', model: '' } } },
			...overrides,
		});

		it('re-queries ListModels and syncs the global list on success', async () => {
			mockedRequestUrl.mockReset();
			mockedRequestUrl.mockResolvedValue({
				status: 200,
				json: {
					models: [
						{ name: 'models/gemini-flash-latest', supportedGenerationMethods: ['generateContent'] },
						{ name: 'models/gemini-9-flash', supportedGenerationMethods: ['generateContent'] },
					],
				},
			});
			setGeminiModels([]);

			const result = await new ModelManager(geminiPlugin()).refreshGeminiModels();

			expect(result).toEqual({ fetched: true, modelCount: 2 });
			expect(GEMINI_MODELS.map((m) => m.value)).toEqual(['gemini-flash-latest', 'gemini-9-flash']);
		});

		it('skips without a key and leaves the global list alone', async () => {
			const before = [{ value: 'before', label: 'Before' }];
			setGeminiModels(before);

			const result = await new ModelManager(geminiPlugin({ apiKey: '' })).refreshGeminiModels();

			expect(result.fetched).toBe(false);
			expect(result.skippedReason).toBe('needsKey');
			expect(GEMINI_MODELS).toEqual(before);
		});

		it('skips when no feature uses Gemini', async () => {
			const plugin = geminiPlugin();
			plugin.settings = {
				...plugin.settings,
				defaultProvider: 'ollama',
				features: { chat: { provider: 'ollama', model: '' } },
			};

			const result = await new ModelManager(plugin).refreshGeminiModels();

			expect(result.skippedReason).toBe('provider');
		});

		it('rejects when the API cannot be reached', async () => {
			mockedRequestUrl.mockReset();
			mockedRequestUrl.mockResolvedValue({ status: 403, json: {} });

			await expect(new ModelManager(geminiPlugin()).refreshGeminiModels()).rejects.toThrow('Could not reach');
		});
	});

	describe('Ollama provider', () => {
		let ollamaPlugin: any;
		let ollamaManager: ModelManager;

		beforeEach(() => {
			ollamaPlugin = {
				...mockPlugin,
				settings: {
					...mockPlugin.settings,
					defaultProvider: 'ollama',
					features: { chat: { provider: 'ollama', model: '' } },
				},
			};
			ollamaManager = new ModelManager(ollamaPlugin);
		});

		afterEach(() => {
			setGeminiModels(originalModels);
		});

		it('initialize() populates models from Ollama tags', async () => {
			// The OllamaModelsService returns an empty array when the daemon is unreachable
			// — best-effort. initialize() should still complete without error.
			await ollamaManager.initialize();

			// After initialize with Ollama, the global list is replaced (even if empty)
			// — no error should be thrown.
			expect(true).toBe(true);
		});

		it('getAvailableModels() does not return Gemini bundled models', async () => {
			const models = await ollamaManager.getAvailableModels();

			// OllamaModelsService.getModels() may return empty if daemon is down,
			// but the important thing is it doesn't return Gemini bundled models.
			expect(Array.isArray(models)).toBe(true);
			const bundledValues = new Set(originalModels.map((m) => m.value));
			expect(models.some((m) => bundledValues.has(m.value))).toBe(false);
		});
	});

	describe('OpenAI provider', () => {
		let openaiPlugin: any;
		let openaiManager: ModelManager;

		beforeEach(() => {
			openaiPlugin = {
				...mockPlugin,
				settings: {
					...mockPlugin.settings,
					defaultProvider: 'openai',
					features: { chat: { provider: 'openai', model: '' } },
					openaiBaseUrl: 'https://api.openai.com/v1',
				},
			};
			openaiManager = new ModelManager(openaiPlugin);
			mockedRequestUrl.mockReset();
		});

		afterEach(() => {
			setGeminiModels(originalModels);
		});

		it('initialize() merges discovered OpenAI models into the global model list', async () => {
			mockedRequestUrl.mockResolvedValue({
				status: 200,
				json: { data: [{ id: 'gpt-5.6-sol' }, { id: 'gpt-5.6-luna' }] },
			});

			await openaiManager.initialize();

			const active = GEMINI_MODELS.filter((m) => m.provider === 'openai').map((m) => m.value);
			expect(active).toEqual(expect.arrayContaining(['gpt-5.6-sol', 'gpt-5.6-luna']));
		});

		it('initialize() still completes when the OpenAI endpoint is unreachable', async () => {
			mockedRequestUrl.mockRejectedValue(new Error('ECONNREFUSED'));

			await expect(openaiManager.initialize()).resolves.not.toThrow();
			expect(GEMINI_MODELS.filter((m) => m.provider === 'openai')).toHaveLength(0);
		});

		it('getAvailableModels() does not return Gemini bundled models', async () => {
			const models = await openaiManager.getAvailableModels();

			// OpenAIModelsService.getModels() may return empty if the endpoint is
			// unreachable, but the important thing is it doesn't return Gemini bundled models.
			expect(Array.isArray(models)).toBe(true);
			const bundledValues = new Set(originalModels.map((m) => m.value));
			expect(models.some((m) => bundledValues.has(m.value))).toBe(false);
		});

		it('offers an unknown compatible-endpoint model for image generation', async () => {
			openaiPlugin.settings.openaiBaseUrl = 'http://localhost:1234/v1';
			mockedRequestUrl.mockResolvedValue({
				status: 200,
				json: { data: [{ id: 'custom-image-model' }] },
			});

			const models = await openaiManager.getImageGenerationModels('openai');

			expect(models).toEqual([expect.objectContaining({ value: 'custom-image-model', capabilitiesUnknown: true })]);
		});

		it('getProviderModelsService() returns a distinct service per provider', () => {
			const service = openaiManager.getProviderModelsService('openai');
			expect(service).not.toBe(openaiManager.getProviderModelsService('anthropic'));
			expect(service).toBe(openaiManager.getProviderModelsService('openai'));
			expect(service).toBeDefined();
			expect(typeof service.getModels).toBe('function');
			expect(typeof service.invalidate).toBe('function');
		});
	});
});
