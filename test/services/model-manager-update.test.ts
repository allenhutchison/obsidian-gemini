import { ModelManager } from '../../src/services/model-manager';
import { GeminiModel, setGeminiModels, GEMINI_MODELS, DEFAULT_GEMINI_MODELS } from '../../src/models';

/**
 * These tests verify that updateModels() preserves feature routing (settings
 * redesign: `features`/`providerModelMemory`, replacing the old per-role
 * `chatModelName`/`summaryModelName`/`completionsModelName`/`imageModelName`
 * fields) when the model list changes, preventing any feature's model from
 * being silently replaced.
 */
describe('ModelManager.updateModels — model role preservation', () => {
	let modelManager: ModelManager;
	let mockPlugin: any;
	let originalModels: GeminiModel[];

	beforeEach(() => {
		originalModels = [...GEMINI_MODELS];

		// Reset GEMINI_MODELS to static defaults (simulates a fresh plugin load)
		setGeminiModels([...DEFAULT_GEMINI_MODELS]);

		mockPlugin = {
			settings: {
				defaultProvider: 'gemini',
				features: {
					chat: { provider: 'gemini', model: 'gemini-flash-latest' },
					summary: { provider: 'gemini', model: 'gemini-flash-latest' },
					completions: { provider: 'gemini', model: 'gemini-flash-lite-latest' },
					rewrite: { provider: 'gemini', model: '' },
					webSearch: { provider: 'gemini', model: '' },
					deepResearch: { provider: 'gemini', model: '' },
					rag: { provider: 'gemini', model: '' },
					imageGen: { provider: 'gemini', model: 'gemini-2.5-flash-image' },
				},
				providerModelMemory: {},
			},
			apiKey: 'test-api-key',
			loadData: vi.fn().mockResolvedValue({}),
			saveData: vi.fn(),
			logger: {
				log: vi.fn(),
				debug: vi.fn(),
				warn: vi.fn(),
				error: vi.fn(),
				child: vi.fn(function (this: any) {
					return this;
				}),
			},
		};

		modelManager = new ModelManager(mockPlugin);
	});

	afterEach(() => {
		setGeminiModels(originalModels);
	});

	it('should preserve image model setting when models are synced', async () => {
		await modelManager.initialize();
		const result = await modelManager.updateModels();

		expect(result.updatedSettings.features.imageGen.model).toBe('gemini-2.5-flash-image');
		expect(result.changedSettingsInfo.some((info) => info.includes('imageGen model'))).toBe(false);

		// Verify GEMINI_MODELS contains image models
		const imageModels = GEMINI_MODELS.filter((m) => m.supportsImageGeneration);
		expect(imageModels.length).toBeGreaterThan(0);
	});

	it('should preserve chat model setting', async () => {
		await modelManager.initialize();
		const result = await modelManager.updateModels();

		expect(result.updatedSettings.features.chat.model).toBe('gemini-flash-latest');
		expect(result.changedSettingsInfo.some((info) => info.includes('chat model'))).toBe(false);
	});

	it('should preserve summary model setting', async () => {
		await modelManager.initialize();
		const result = await modelManager.updateModels();

		expect(result.updatedSettings.features.summary.model).toBe('gemini-flash-latest');
		expect(result.changedSettingsInfo.some((info) => info.includes('summary model'))).toBe(false);
	});

	it('should preserve completions model setting', async () => {
		await modelManager.initialize();
		const result = await modelManager.updateModels();

		expect(result.updatedSettings.features.completions.model).toBe('gemini-flash-lite-latest');
		expect(result.changedSettingsInfo.some((info) => info.includes('completions model'))).toBe(false);
	});

	it('should include both text and image models in global GEMINI_MODELS', async () => {
		await modelManager.initialize();

		const textModels = GEMINI_MODELS.filter((m) => !m.supportsImageGeneration);
		const imageModels = GEMINI_MODELS.filter((m) => m.supportsImageGeneration);

		expect(textModels.length).toBeGreaterThan(0);
		expect(imageModels.length).toBeGreaterThan(0);
	});

	it('should correctly update image model if it is genuinely unavailable', async () => {
		mockPlugin.settings.features.imageGen.model = 'gemini-nonexistent-image-model';

		setGeminiModels([{ value: 'old-model', label: 'Old' }]);

		const result = await modelManager.updateModels();

		expect(result.settingsChanged).toBe(true);
		expect(result.changedSettingsInfo.some((info) => info.includes('imageGen model'))).toBe(true);

		// Should be updated to an actual image model, not a text model
		const newImageModel = GEMINI_MODELS.find((m) => m.value === result.updatedSettings.features.imageGen.model);
		expect(newImageModel).toBeDefined();
		expect(newImageModel?.supportsImageGeneration || newImageModel?.value.includes('image')).toBe(true);
	});

	it('should correctly update chat model if it is genuinely unavailable', async () => {
		mockPlugin.settings.features.chat.model = 'gemini-nonexistent-chat-model';

		setGeminiModels([{ value: 'old-model', label: 'Old' }]);

		const result = await modelManager.updateModels();

		expect(result.settingsChanged).toBe(true);
		expect(result.changedSettingsInfo.some((info) => info.includes('chat model'))).toBe(true);

		// Should be updated to a valid text model in GEMINI_MODELS, not an image model
		const newChatModel = GEMINI_MODELS.find((m) => m.value === result.updatedSettings.features.chat.model);
		expect(newChatModel).toBeDefined();
		expect(newChatModel?.supportsImageGeneration).not.toBe(true);
		expect(newChatModel?.value.includes('image')).toBe(false);
	});
});
