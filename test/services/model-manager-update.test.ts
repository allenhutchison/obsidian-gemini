import { ModelManager } from '../../src/services/model-manager';
import { ModelDiscoveryService, GoogleModel } from '../../src/services/model-discovery';
import { GeminiModel, setGeminiModels, GEMINI_MODELS, DEFAULT_GEMINI_MODELS } from '../../src/models';

// Mock only the discovery service — let ModelMapper and filterModelsForVersion run for real
jest.mock('../../src/services/model-discovery');

/**
 * These tests exercise the full updateModels() flow without mocking
 * getAvailableModels or getImageGenerationModels. They verify that model
 * discovery doesn't silently replace model settings for any role.
 *
 * Regression: updateModels() previously set the global GEMINI_MODELS list
 * using only text models from getAvailableModels(), which excluded image
 * models. When getUpdatedModelSettings() validated imageModelName against
 * that list, it couldn't find the image model and replaced it with a text
 * model, breaking image generation.
 */
describe('ModelManager.updateModels — model role preservation', () => {
	let modelManager: ModelManager;
	let mockPlugin: any;
	let mockDiscoveryService: jest.Mocked<ModelDiscoveryService>;
	let originalModels: GeminiModel[];

	// Realistic discovered models from Google's API
	const discoveredGoogleModels: GoogleModel[] = [
		{
			name: 'models/gemini-2.5-pro',
			displayName: 'Gemini 2.5 Pro',
			description: '',
			version: '002',
			inputTokenLimit: 1000000,
			outputTokenLimit: 65536,
			supportedGenerationMethods: ['generateContent'],
		},
		{
			name: 'models/gemini-2.5-flash',
			displayName: 'Gemini 2.5 Flash',
			description: '',
			version: '002',
			inputTokenLimit: 1000000,
			outputTokenLimit: 65536,
			supportedGenerationMethods: ['generateContent'],
		},
		{
			name: 'models/gemini-2.5-flash-lite',
			displayName: 'Gemini 2.5 Flash Lite',
			description: '',
			version: '001',
			inputTokenLimit: 1000000,
			outputTokenLimit: 65536,
			supportedGenerationMethods: ['generateContent'],
		},
		{
			name: 'models/gemini-3-pro-preview',
			displayName: 'Gemini 3 Pro Preview',
			description: '',
			version: '001',
			inputTokenLimit: 1000000,
			outputTokenLimit: 65536,
			supportedGenerationMethods: ['generateContent'],
		},
		{
			name: 'models/gemini-3.1-pro-preview',
			displayName: 'Gemini 3.1 Pro Preview',
			description: '',
			version: '001',
			inputTokenLimit: 1000000,
			outputTokenLimit: 65536,
			supportedGenerationMethods: ['generateContent'],
		},
		// Image models
		{
			name: 'models/gemini-2.5-flash-image',
			displayName: 'Gemini 2.5 Flash Image',
			description: '',
			version: '001',
			inputTokenLimit: 1000000,
			outputTokenLimit: 65536,
			supportedGenerationMethods: ['generateContent'],
		},
		{
			name: 'models/gemini-3-pro-image-preview',
			displayName: 'Gemini 3 Pro Image Preview',
			description: '',
			version: '001',
			inputTokenLimit: 1000000,
			outputTokenLimit: 65536,
			supportedGenerationMethods: ['generateContent'],
		},
		{
			name: 'models/gemini-3.1-flash-image-preview',
			displayName: 'Gemini 3.1 Flash Image Preview',
			description: '',
			version: '001',
			inputTokenLimit: 1000000,
			outputTokenLimit: 65536,
			supportedGenerationMethods: ['generateContent'],
		},
		// Latest aliases (returned by real API)
		{
			name: 'models/gemini-flash-latest',
			displayName: 'Gemini Flash Latest',
			description: '',
			version: '001',
			inputTokenLimit: 1000000,
			outputTokenLimit: 65536,
			supportedGenerationMethods: ['generateContent'],
		},
		{
			name: 'models/gemini-flash-lite-latest',
			displayName: 'Gemini Flash Lite Latest',
			description: '',
			version: '001',
			inputTokenLimit: 1000000,
			outputTokenLimit: 65536,
			supportedGenerationMethods: ['generateContent'],
		},
		// Models that should be filtered out
		{
			name: 'models/gemini-2.0-flash',
			displayName: 'Gemini 2.0 Flash',
			description: '',
			version: '001',
			inputTokenLimit: 1000000,
			outputTokenLimit: 65536,
			supportedGenerationMethods: ['generateContent'],
		},
		{
			name: 'models/imagen-3.0-generate-001',
			displayName: 'Imagen 3.0',
			description: '',
			version: '001',
			inputTokenLimit: 0,
			outputTokenLimit: 0,
			supportedGenerationMethods: ['generateImage'],
		},
	];

	beforeEach(() => {
		originalModels = [...GEMINI_MODELS];

		// Reset GEMINI_MODELS to static defaults (simulates a fresh plugin load)
		setGeminiModels([...DEFAULT_GEMINI_MODELS]);

		mockPlugin = {
			settings: {
				chatModelName: 'gemini-2.5-pro',
				summaryModelName: 'gemini-flash-latest',
				completionsModelName: 'gemini-flash-lite-latest',
				imageModelName: 'gemini-2.5-flash-image',
				modelDiscovery: {
					enabled: true,
					autoUpdateInterval: 24,
					lastUpdate: 0,
					fallbackToStatic: true,
				},
			},
			apiKey: 'test-api-key',
			loadData: jest.fn(),
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
		mockDiscoveryService = (modelManager as any).discoveryService as jest.Mocked<ModelDiscoveryService>;

		mockDiscoveryService.discoverModels.mockResolvedValue({
			models: discoveredGoogleModels,
			lastUpdated: Date.now(),
			success: true,
		});
	});

	afterEach(() => {
		setGeminiModels(originalModels);
	});

	it('should preserve image model setting when discovery returns new models', async () => {
		const result = await modelManager.updateModels({ preserveUserCustomizations: true });

		// The image model should NOT have been changed
		if (result.settingsChanged) {
			const imageChanged = result.changedSettingsInfo.some((info) => info.includes('Image model'));
			expect(imageChanged).toBe(false);
		}

		// Verify GEMINI_MODELS contains image models
		const imageModels = GEMINI_MODELS.filter((m) => m.supportsImageGeneration || m.value.includes('image'));
		expect(imageModels.length).toBeGreaterThan(0);
	});

	it('should preserve chat model setting when discovery returns new models', async () => {
		const result = await modelManager.updateModels({ preserveUserCustomizations: true });

		if (result.settingsChanged) {
			const chatChanged = result.changedSettingsInfo.some((info) => info.includes('Chat model'));
			expect(chatChanged).toBe(false);
		}
	});

	it('should preserve summary model setting when discovery returns new models', async () => {
		// gemini-flash-latest is in static defaults and passes the "latest" filter
		const result = await modelManager.updateModels({ preserveUserCustomizations: true });

		if (result.settingsChanged) {
			const summaryChanged = result.changedSettingsInfo.some((info) => info.includes('Summary model'));
			expect(summaryChanged).toBe(false);
		}
	});

	it('should preserve completions model setting when discovery returns new models', async () => {
		// gemini-flash-lite-latest is in static defaults and passes the "latest" filter
		const result = await modelManager.updateModels({ preserveUserCustomizations: true });

		if (result.settingsChanged) {
			const completionsChanged = result.changedSettingsInfo.some((info) => info.includes('Completions model'));
			expect(completionsChanged).toBe(false);
		}
	});

	it('should include both text and image models in global GEMINI_MODELS after update', async () => {
		await modelManager.updateModels({ preserveUserCustomizations: true });

		const textModels = GEMINI_MODELS.filter((m) => !m.supportsImageGeneration && !m.value.includes('image'));
		const imageModels = GEMINI_MODELS.filter((m) => m.supportsImageGeneration || m.value.includes('image'));

		expect(textModels.length).toBeGreaterThan(0);
		expect(imageModels.length).toBeGreaterThan(0);
	});

	it('should not include filtered-out models (2.0, imagen, veo) in global list', async () => {
		await modelManager.updateModels({ preserveUserCustomizations: true });

		const modelValues = GEMINI_MODELS.map((m) => m.value);
		expect(modelValues).not.toContain('gemini-2.0-flash');
		expect(modelValues).not.toContain('imagen-3.0-generate-001');
	});

	it('should correctly update image model if it is genuinely unavailable', async () => {
		// Set image model to something that doesn't exist in any list
		mockPlugin.settings.imageModelName = 'gemini-nonexistent-image-model';

		const result = await modelManager.updateModels({ preserveUserCustomizations: true });

		expect(result.settingsChanged).toBe(true);
		const imageChanged = result.changedSettingsInfo.some((info) => info.includes('Image model'));
		expect(imageChanged).toBe(true);

		// Should be updated to an actual image model, not a text model
		const newImageModel = GEMINI_MODELS.find((m) => m.value === result.updatedSettings.imageModelName);
		expect(newImageModel).toBeDefined();
		expect(newImageModel?.supportsImageGeneration || newImageModel?.value.includes('image')).toBe(true);
	});

	it('should correctly update chat model if it is genuinely unavailable', async () => {
		mockPlugin.settings.chatModelName = 'gemini-nonexistent-chat-model';

		const result = await modelManager.updateModels({ preserveUserCustomizations: true });

		expect(result.settingsChanged).toBe(true);
		const chatChanged = result.changedSettingsInfo.some((info) => info.includes('Chat model'));
		expect(chatChanged).toBe(true);
	});

	it('should correctly update summary model if it is genuinely unavailable', async () => {
		mockPlugin.settings.summaryModelName = 'gemini-nonexistent-summary-model';

		const result = await modelManager.updateModels({ preserveUserCustomizations: true });

		expect(result.settingsChanged).toBe(true);
		const summaryChanged = result.changedSettingsInfo.some((info) => info.includes('Summary model'));
		expect(summaryChanged).toBe(true);
	});

	it('should correctly update completions model if it is genuinely unavailable', async () => {
		mockPlugin.settings.completionsModelName = 'gemini-nonexistent-completions-model';

		const result = await modelManager.updateModels({ preserveUserCustomizations: true });

		expect(result.settingsChanged).toBe(true);
		const completionsChanged = result.changedSettingsInfo.some((info) => info.includes('Completions model'));
		expect(completionsChanged).toBe(true);
	});

	it('should preserve all model settings when discovery fails', async () => {
		mockDiscoveryService.discoverModels.mockRejectedValue(new Error('Network error'));

		const result = await modelManager.updateModels({ preserveUserCustomizations: true });

		// When discovery fails, getAvailableModels falls back to static models.
		// The global list should still include image models from static defaults.
		if (result.settingsChanged) {
			const imageChanged = result.changedSettingsInfo.some((info) => info.includes('Image model'));
			expect(imageChanged).toBe(false);
		}
	});

	it('should not deduplicate image models with text models of similar names', async () => {
		await modelManager.updateModels({ preserveUserCustomizations: true });

		// Both gemini-2.5-flash (text) and gemini-2.5-flash-image should exist
		const modelValues = GEMINI_MODELS.map((m) => m.value);
		const hasFlashText = modelValues.includes('gemini-2.5-flash') || modelValues.includes('gemini-flash-latest');
		const hasFlashImage = modelValues.includes('gemini-2.5-flash-image');

		expect(hasFlashText).toBe(true);
		expect(hasFlashImage).toBe(true);
	});

	it('should handle discovery returning only text models (no image models)', async () => {
		// Discovery returns only text models
		mockDiscoveryService.discoverModels.mockResolvedValue({
			models: discoveredGoogleModels.filter((m) => !m.name.includes('image')),
			lastUpdated: Date.now(),
			success: true,
		});

		await modelManager.updateModels({ preserveUserCustomizations: true });

		// Static image models should still be in the global list
		const imageModels = GEMINI_MODELS.filter((m) => m.supportsImageGeneration || m.value.includes('image'));
		expect(imageModels.length).toBeGreaterThan(0);
	});
});
