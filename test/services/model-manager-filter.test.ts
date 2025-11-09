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
		} as ObsidianGemini;

		// Create model manager
		modelManager = new ModelManager(mockPlugin);

		// Get mocked discovery service
		mockDiscoveryService = (modelManager as any).discoveryService as jest.Mocked<ModelDiscoveryService>;
	});

	describe('filterModelsForVersion', () => {
		it('should keep Gemini 2.5 models', async () => {
			const testModels: GeminiModel[] = [
				{ value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
				{ value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
				{ value: 'gemini-2.5-flash-lite-preview-06-17', label: 'Gemini 2.5 Flash Lite' },
			];

			// Use static models (discovery disabled)
			const models = await modelManager.getAvailableModels();

			// All 2.5 models should be included
			expect(models.some(m => m.value === 'gemini-2.5-pro')).toBe(true);
			expect(models.some(m => m.value === 'gemini-2.5-flash')).toBe(true);
			expect(models.some(m => m.value === 'gemini-2.5-flash-lite-preview-06-17')).toBe(true);
		});

		it('should filter out Gemini 2.0 models', async () => {
			// Enable discovery
			mockPlugin.settings.modelDiscovery.enabled = true;

			// Mock discovery to return mixed versions
			mockDiscoveryService.discoverModels.mockResolvedValue({
				success: true,
				models: [
					{
						name: 'models/gemini-2.5-pro',
						version: '001',
						displayName: 'Gemini 2.5 Pro',
						description: 'Latest Pro model',
						inputTokenLimit: 2097152,
						outputTokenLimit: 8192,
						supportedGenerationMethods: ['generateContent'],
						maxTemperature: 2.0,
						topP: 0.95,
						topK: 40,
					},
					{
						name: 'models/gemini-2.0-flash',
						version: '001',
						displayName: 'Gemini 2.0 Flash',
						description: 'Older Flash model',
						inputTokenLimit: 1048576,
						outputTokenLimit: 8192,
						supportedGenerationMethods: ['generateContent'],
						maxTemperature: 2.0,
						topP: 0.95,
						topK: 40,
					},
					{
						name: 'models/gemini-1.5-pro',
						version: '001',
						displayName: 'Gemini 1.5 Pro',
						description: 'Legacy Pro model',
						inputTokenLimit: 1048576,
						outputTokenLimit: 8192,
						supportedGenerationMethods: ['generateContent'],
						maxTemperature: 2.0,
						topP: 0.95,
						topK: 40,
					},
				],
				lastUpdated: Date.now(),
			});

			const models = await modelManager.getAvailableModels();

			// Only 2.5 models should be included
			expect(models.some(m => m.value === 'gemini-2.5-pro')).toBe(true);
			expect(models.some(m => m.value === 'gemini-2.0-flash')).toBe(false);
			expect(models.some(m => m.value === 'gemini-1.5-pro')).toBe(false);
		});

		it('should keep future versions (3.0+)', async () => {
			// Enable discovery
			mockPlugin.settings.modelDiscovery.enabled = true;

			// Mock discovery to return future versions
			mockDiscoveryService.discoverModels.mockResolvedValue({
				success: true,
				models: [
					{
						name: 'models/gemini-3.0-ultra',
						version: '001',
						displayName: 'Gemini 3.0 Ultra',
						description: 'Future Ultra model',
						inputTokenLimit: 4194304,
						outputTokenLimit: 16384,
						supportedGenerationMethods: ['generateContent'],
						maxTemperature: 2.0,
						topP: 0.95,
						topK: 40,
					},
					{
						name: 'models/gemini-2.5-pro',
						version: '001',
						displayName: 'Gemini 2.5 Pro',
						description: 'Current Pro model',
						inputTokenLimit: 2097152,
						outputTokenLimit: 8192,
						supportedGenerationMethods: ['generateContent'],
						maxTemperature: 2.0,
						topP: 0.95,
						topK: 40,
					},
				],
				lastUpdated: Date.now(),
			});

			const models = await modelManager.getAvailableModels();

			// Both 2.5 and 3.0 models should be included
			expect(models.some(m => m.value === 'gemini-3.0-ultra')).toBe(true);
			expect(models.some(m => m.value === 'gemini-2.5-pro')).toBe(true);
		});

		it('should handle version variants correctly', async () => {
			// Enable discovery
			mockPlugin.settings.modelDiscovery.enabled = true;

			// Mock discovery to return various version formats
			mockDiscoveryService.discoverModels.mockResolvedValue({
				success: true,
				models: [
					{
						name: 'models/gemini-2.5-pro-preview',
						version: '001',
						displayName: 'Gemini 2.5 Pro Preview',
						description: 'Preview version',
						inputTokenLimit: 2097152,
						outputTokenLimit: 8192,
						supportedGenerationMethods: ['generateContent'],
						maxTemperature: 2.0,
						topP: 0.95,
						topK: 40,
					},
					{
						name: 'models/gemini-2.5-flash-001',
						version: '001',
						displayName: 'Gemini 2.5 Flash 001',
						description: 'Versioned model',
						inputTokenLimit: 1048576,
						outputTokenLimit: 8192,
						supportedGenerationMethods: ['generateContent'],
						maxTemperature: 2.0,
						topP: 0.95,
						topK: 40,
					},
				],
				lastUpdated: Date.now(),
			});

			const models = await modelManager.getAvailableModels();

			// All 2.5 variants should be included
			expect(models.some(m => m.value === 'gemini-2.5-pro-preview')).toBe(true);
			expect(models.some(m => m.value === 'gemini-2.5-flash-001')).toBe(true);
		});

		it('should fall back to filtered static models on discovery failure', async () => {
			// Enable discovery
			mockPlugin.settings.modelDiscovery.enabled = true;

			// Mock discovery failure
			mockDiscoveryService.discoverModels.mockRejectedValue(new Error('Network error'));

			const models = await modelManager.getAvailableModels();

			// Should get filtered static models (all 2.5+)
			expect(models.length).toBeGreaterThan(0);
			models.forEach(model => {
				expect(model.value.toLowerCase()).toContain('gemini-2.5');
			});
		});
	});
});