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
	loadData: jest.fn().mockResolvedValue({}),
	saveData: jest.fn(),
	logger: {
		log: jest.fn(),
		debug: jest.fn(),
		warn: jest.fn(),
		error: jest.fn(),
		child: jest.fn(function (this: any, _prefix: string) {
			return this;
		}),
	},
} as any;

describe('ModelManager', () => {
	let modelManager: ModelManager;
	let originalModels: GeminiModel[];

	beforeEach(() => {
		jest.clearAllMocks();
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
	});
});
