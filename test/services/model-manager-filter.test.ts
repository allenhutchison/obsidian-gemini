import { ModelManager } from '../../src/services/model-manager';
import { ModelDiscoveryService } from '../../src/services/model-discovery';
import { GeminiModel } from '../../src/models';
import ObsidianGemini from '../../src/main';

// Mock the model discovery service
jest.mock('../../src/services/model-discovery');

describe('ModelManager Version Filtering', () => {
	let modelManager: ModelManager;
	let mockPlugin: ObsidianGemini;
	let mockDiscoveryService: jest.Mocked<ModelDiscoveryService>;

	beforeEach(() => {
		// Create mock plugin
		mockPlugin = {
			settings: {
				modelDiscovery: {
					enabled: false,
					autoUpdateInterval: 24,
					lastUpdate: 0,
					fallbackToStatic: true,
				},
			},
			logger: {
				log: jest.fn(),
				debug: jest.fn(),
				warn: jest.fn(),
				error: jest.fn(),
				child: jest.fn(function (this: any, prefix: string) {
					return this;
				})
			}
		} as unknown as ObsidianGemini;

		// Create model manager
		modelManager = new ModelManager(mockPlugin);

		// Get mocked discovery service
		mockDiscoveryService = (modelManager as any).discoveryService as jest.Mocked<ModelDiscoveryService>;
	});

	describe('filterModelsForVersion', () => {
		it('should filter models correctly based on version and image capability', () => {
			const models = [
				{ value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
				{ value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
				{ value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' }, // Should be excluded
				{ value: 'gemini-2.0-flash-thinking-exp', label: 'Gemini 2.0 Flash Thinking' }, // Should be excluded
				{ value: 'gemini-3-pro-preview', label: 'Gemini 3 Pro Preview' },
				{ value: 'gemini-flash-latest', label: 'Gemini Flash Latest' },
				{ value: 'embedding-001', label: 'Embedding 001' }, // Should be excluded
				{ value: 'aqa', label: 'AQA' }, // Should be excluded
				{ value: 'tts-1-hd', label: 'TTS 1 HD' }, // Should be excluded
				{ value: 'gemini-2.0-pro-exp-02-05-computer-use', label: 'Gemini 2.0 Pro Computer Use' }, // Should be excluded
				{ value: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image', supportsImageGeneration: true },
				{ value: 'models/nano-banana-pro-preview', label: 'Nano Banana Pro Preview' }, // Should be excluded
				{ value: 'nano-banana-pro-preview', label: 'Nano Banana Pro Preview' }, // Should be excluded
				{ value: 'imagen-3.0-generate-001', label: 'Imagen 3.0', supportsImageGeneration: true }, // Should be excluded
				{ value: 'veo-2.0-generate-001', label: 'Veo 2.0', supportsImageGeneration: true }, // Should be excluded
			];

			// Test text models (imageModelsOnly = false)
			const textModels = modelManager['filterModelsForVersion'](models, false);
			const textModelValues = textModels.map(m => m.value);

			expect(textModelValues).toContain('gemini-2.5-pro');
			expect(textModelValues).toContain('gemini-2.5-flash');
			expect(textModelValues).toContain('gemini-3-pro-preview');
			expect(textModelValues).toContain('gemini-flash-latest');

			// Exclusions
			expect(textModelValues).not.toContain('gemini-2.0-flash-thinking-exp');
			expect(textModelValues).not.toContain('gemini-2.0-flash');
			expect(textModelValues).not.toContain('embedding-001');
			expect(textModelValues).not.toContain('aqa');
			expect(textModelValues).not.toContain('tts-1-hd');
			expect(textModelValues).not.toContain('gemini-2.0-pro-exp-02-05-computer-use');
			expect(textModelValues).not.toContain('gemini-2.5-flash-image');
			expect(textModelValues).not.toContain('models/nano-banana-pro-preview');
			expect(textModelValues).not.toContain('nano-banana-pro-preview');
			expect(textModelValues).not.toContain('imagen-3.0-generate-001');
			expect(textModelValues).not.toContain('veo-2.0-generate-001');

			// Test image models (imageModelsOnly = true)
			const imageModels = modelManager['filterModelsForVersion'](models, true);
			const imageModelValues = imageModels.map(m => m.value);

			expect(imageModelValues).toContain('gemini-2.5-flash-image');

			// Exclusions for image models
			expect(imageModelValues).not.toContain('imagen-3.0-generate-001');
			expect(imageModelValues).not.toContain('veo-2.0-generate-001');
			expect(imageModelValues).not.toContain('gemini-2.5-pro');
			expect(imageModelValues).not.toContain('models/nano-banana-pro-preview');
			expect(imageModelValues).not.toContain('nano-banana-pro-preview');
			expect(imageModelValues).not.toContain('gemini-2.0-flash');
		});

		it('should fall back to filtered static models on discovery failure', async () => {
			// Enable discovery
			mockPlugin.settings.modelDiscovery.enabled = true;

			// Mock discovery failure
			mockDiscoveryService.discoverModels.mockRejectedValue(new Error('Network error'));

			const models = await modelManager.getAvailableModels();

			// Should get filtered static models (all 2.5+, 3+, or latest)
			expect(models.length).toBeGreaterThan(0);
			models.forEach(model => {
				const val = model.value.toLowerCase();
				const isValid = (val.includes('gemini-2.5') ||
					val.includes('gemini-3') ||
					val.includes('latest')) &&
					!val.includes('gemini-2.0') &&
					!val.includes('imagen') &&
					!val.includes('veo') &&
					!val.includes('tts') &&
					!val.includes('computer');
				expect(isValid).toBe(true);
			});
		});
	});
});