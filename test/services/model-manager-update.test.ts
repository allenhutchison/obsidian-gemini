import { ModelManager } from '../../src/services/model-manager';
import { GeminiModel, setGeminiModels, GEMINI_MODELS, DEFAULT_GEMINI_MODELS } from '../../src/models';

/**
 * These tests verify that updateModels() preserves model settings for all
 * roles when the model list changes, preventing any role's model from being
 * silently replaced.
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
				child: jest.fn(function (this: any) {
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

		expect(result.updatedSettings.imageModelName).toBe('gemini-2.5-flash-image');
		expect(result.changedSettingsInfo.some((info) => info.includes('Image model'))).toBe(false);

		// Verify GEMINI_MODELS contains image models
		const imageModels = GEMINI_MODELS.filter((m) => m.supportsImageGeneration);
		expect(imageModels.length).toBeGreaterThan(0);
	});

	it('should preserve chat model setting', async () => {
		await modelManager.initialize();
		const result = await modelManager.updateModels();

		expect(result.updatedSettings.chatModelName).toBe('gemini-flash-latest');
		expect(result.changedSettingsInfo.some((info) => info.includes('Chat model'))).toBe(false);
	});

	it('should preserve summary model setting', async () => {
		await modelManager.initialize();
		const result = await modelManager.updateModels();

		expect(result.updatedSettings.summaryModelName).toBe('gemini-flash-latest');
		expect(result.changedSettingsInfo.some((info) => info.includes('Summary model'))).toBe(false);
	});

	it('should preserve completions model setting', async () => {
		await modelManager.initialize();
		const result = await modelManager.updateModels();

		expect(result.updatedSettings.completionsModelName).toBe('gemini-flash-lite-latest');
		expect(result.changedSettingsInfo.some((info) => info.includes('Completions model'))).toBe(false);
	});

	it('should include both text and image models in global GEMINI_MODELS', async () => {
		await modelManager.initialize();

		const textModels = GEMINI_MODELS.filter((m) => !m.supportsImageGeneration);
		const imageModels = GEMINI_MODELS.filter((m) => m.supportsImageGeneration);

		expect(textModels.length).toBeGreaterThan(0);
		expect(imageModels.length).toBeGreaterThan(0);
	});

	it('should correctly update image model if it is genuinely unavailable', async () => {
		mockPlugin.settings.imageModelName = 'gemini-nonexistent-image-model';

		setGeminiModels([{ value: 'old-model', label: 'Old' }]);

		const result = await modelManager.updateModels();

		expect(result.settingsChanged).toBe(true);
		expect(result.changedSettingsInfo.some((info) => info.includes('Image model'))).toBe(true);

		// Should be updated to an actual image model, not a text model
		const newImageModel = GEMINI_MODELS.find((m) => m.value === result.updatedSettings.imageModelName);
		expect(newImageModel).toBeDefined();
		expect(newImageModel?.supportsImageGeneration || newImageModel?.value.includes('image')).toBe(true);
	});

	it('should correctly update chat model if it is genuinely unavailable', async () => {
		mockPlugin.settings.chatModelName = 'gemini-nonexistent-chat-model';

		setGeminiModels([{ value: 'old-model', label: 'Old' }]);

		const result = await modelManager.updateModels();

		expect(result.settingsChanged).toBe(true);
		expect(result.changedSettingsInfo.some((info) => info.includes('Chat model'))).toBe(true);

		// Should be updated to a valid text model in GEMINI_MODELS, not an image model
		const newChatModel = GEMINI_MODELS.find((m) => m.value === result.updatedSettings.chatModelName);
		expect(newChatModel).toBeDefined();
		expect(newChatModel?.supportsImageGeneration).not.toBe(true);
		expect(newChatModel?.value.includes('image')).toBe(false);
	});
});
