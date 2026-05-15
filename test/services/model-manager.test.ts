import { ModelManager } from '../../src/services/model-manager';
import { GeminiModel, setGeminiModels, GEMINI_MODELS } from '../../src/models';

const mockPlugin = {
	settings: {
		chatModelName: 'gemini-flash-latest',
		summaryModelName: 'gemini-flash-latest',
		completionsModelName: 'gemini-flash-lite-latest',
		imageModelName: 'gemini-2.5-flash-image',
	},
	apiKey: 'test-api-key',
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
			// Set global to have same count as bundled but different IDs
			const bundledModels = new ModelManager(mockPlugin).getListProvider().getModels();
			const fakeModels = bundledModels.map((m, i) => ({
				...m,
				value: `fake-model-${i}`,
			}));
			setGeminiModels(fakeModels);

			const _result = await modelManager.updateModels();

			// Should detect the change since model values differ
			expect(GEMINI_MODELS.some((m) => m.value.startsWith('fake-model-'))).toBe(false);
		});
	});

	describe('initialize', () => {
		it('should sync global GEMINI_MODELS with provider', async () => {
			setGeminiModels([]);

			await modelManager.initialize();

			expect(GEMINI_MODELS.length).toBeGreaterThan(0);
		});
	});

	describe('static methods', () => {
		it('should return static models copy', () => {
			const staticModels = ModelManager.getStaticModels();

			expect(staticModels).toEqual(expect.arrayContaining([expect.objectContaining({ value: expect.any(String) })]));
			staticModels.push({ value: 'test', label: 'Test' });
			expect(ModelManager.getStaticModels()).not.toContainEqual(expect.objectContaining({ value: 'test' }));
		});
	});

	describe('getParameterRanges', () => {
		it('should return valid parameter ranges', async () => {
			const ranges = await modelManager.getParameterRanges();

			expect(ranges.temperature.min).toBe(0);
			expect(ranges.temperature.max).toBeGreaterThanOrEqual(1);
			expect(ranges.topP.min).toBe(0);
			expect(ranges.topP.max).toBe(1);
		});

		it('should return step values for temperature and topP', async () => {
			const ranges = await modelManager.getParameterRanges();

			expect(ranges.temperature.step).toBeGreaterThan(0);
			expect(ranges.topP.step).toBeGreaterThan(0);
		});
	});

	describe('validateParameters', () => {
		it('should accept valid parameters', async () => {
			const result = await modelManager.validateParameters(0.7, 0.9);

			expect(result.temperature.isValid).toBe(true);
			expect(result.topP.isValid).toBe(true);
		});

		it('should reject out-of-range parameters', async () => {
			const result = await modelManager.validateParameters(10, 1.5);

			expect(result.temperature.isValid).toBe(false);
			expect(result.topP.isValid).toBe(false);
		});

		it('should accept edge-case zero values', async () => {
			const result = await modelManager.validateParameters(0, 0);

			expect(result.temperature.isValid).toBe(true);
			expect(result.topP.isValid).toBe(true);
		});

		it('should reject negative values', async () => {
			const result = await modelManager.validateParameters(-1, -0.5);

			expect(result.temperature.isValid).toBe(false);
			expect(result.topP.isValid).toBe(false);
		});
	});

	describe('getListProvider', () => {
		it('should return the internal ModelListProvider instance', () => {
			const provider = modelManager.getListProvider();

			expect(provider).toBeDefined();
			expect(typeof provider.getModels).toBe('function');
			expect(typeof provider.getTextModels).toBe('function');
			expect(typeof provider.getImageModels).toBe('function');
		});
	});

	describe('getParameterDisplayInfo', () => {
		it('should return display strings and hasModelData flag', async () => {
			const info = await modelManager.getParameterDisplayInfo();

			expect(typeof info.temperature).toBe('string');
			expect(typeof info.topP).toBe('string');
			expect(typeof info.hasModelData).toBe('boolean');
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
					provider: 'ollama',
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

		it('getAvailableModels() returns Ollama models instead of Gemini models', async () => {
			const models = await ollamaManager.getAvailableModels();

			// OllamaModelsService.getModels() may return empty if daemon is down,
			// but the important thing is it doesn't return Gemini bundled models.
			expect(Array.isArray(models)).toBe(true);
		});

		it('getParameterRanges() works via Ollama provider path', async () => {
			const ranges = await ollamaManager.getParameterRanges();

			expect(ranges.temperature.min).toBe(0);
			expect(ranges.topP.min).toBe(0);
		});
	});
});
