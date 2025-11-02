import { ModelManager, ModelUpdateOptions } from './model-manager';
import { ModelDiscoveryService } from './model-discovery';
import { GeminiModel } from '../models';

// Mock the models module
jest.mock('../models', () => ({
	GEMINI_MODELS: [
		{ value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', defaultForRoles: ['chat'] },
		{ value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', defaultForRoles: ['summary'] },
	],
	setGeminiModels: jest.fn(),
	getUpdatedModelSettings: jest.fn((settings) => ({
		updatedSettings: settings,
		settingsChanged: false,
		changedSettingsInfo: [],
	})),
}));

// Mock ModelDiscoveryService
jest.mock('./model-discovery');
jest.mock('./model-mapper');

import { ModelMapper } from './model-mapper';

// Get the mocked function after import
const { setGeminiModels } = require('../models');
const mockSetGeminiModels = setGeminiModels as jest.Mock;

const mockPlugin = {
	settings: {
		modelDiscovery: {
			enabled: true,
			autoUpdateInterval: 24,
			lastUpdate: Date.now(),
			fallbackToStatic: true,
		},
		apiKey: 'test-api-key',
	},
	loadData: jest.fn(),
	saveData: jest.fn(),
} as any;

describe('ModelManager', () => {
	let modelManager: ModelManager;
	let mockDiscoveryService: jest.Mocked<ModelDiscoveryService>;

	beforeEach(() => {
		jest.clearAllMocks();
		mockDiscoveryService = new ModelDiscoveryService(mockPlugin) as jest.Mocked<ModelDiscoveryService>;
		modelManager = new ModelManager(mockPlugin);
		(modelManager as any).discoveryService = mockDiscoveryService;
	});

	describe('getAvailableModels', () => {
		it('should return static models when discovery is disabled', async () => {
			const pluginWithDisabledDiscovery = {
				...mockPlugin,
				settings: {
					...mockPlugin.settings,
					modelDiscovery: { enabled: false },
				},
			};
			const manager = new ModelManager(pluginWithDisabledDiscovery);

			const result = await manager.getAvailableModels();

			// Should return static models WITHOUT image generation models (filtered out by default)
			const expectedModels = ModelManager.getStaticModels().filter(m => !m.supportsImageGeneration);
			expect(result).toEqual(expectedModels);
		});

		it('should return dynamic models when discovery is successful', async () => {
			const discoveredGoogleModels = [
				{
					name: 'models/gemini-2.5-pro-new',
					displayName: 'Gemini 2.5 Pro New',
					description: 'Updated model',
					version: '002',
					inputTokenLimit: 1000000,
					outputTokenLimit: 8192,
					supportedGenerationMethods: ['generateContent'],
				},
			];

			const mappedModels: GeminiModel[] = [
				{ value: 'gemini-2.5-pro-new', label: 'Gemini 2.5 Pro New', defaultForRoles: ['chat'] },
			];

			mockDiscoveryService.discoverModels.mockResolvedValue({
				models: discoveredGoogleModels,
				lastUpdated: Date.now(),
				success: true,
			});

			(ModelMapper.mapToGeminiModels as jest.Mock).mockReturnValue(mappedModels);
			(ModelMapper.sortModelsByPreference as jest.Mock).mockReturnValue(mappedModels);

			const result = await modelManager.getAvailableModels();

			expect(result).toEqual(mappedModels);
			expect(mockDiscoveryService.discoverModels).toHaveBeenCalledWith(undefined);
		});

		it('should preserve user customizations when requested', async () => {
			const discoveredGoogleModels = [
				{
					name: 'models/gemini-2.5-pro',
					displayName: 'Gemini 2.5 Pro',
					description: 'Standard model',
					version: '001',
					inputTokenLimit: 1000000,
					outputTokenLimit: 8192,
					supportedGenerationMethods: ['generateContent'],
				},
			];

			const mappedModels: GeminiModel[] = [
				{ value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', defaultForRoles: ['chat'] },
			];

			const mergedModels: GeminiModel[] = [
				{ value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro Custom', defaultForRoles: ['chat', 'summary'] },
			];

			mockDiscoveryService.discoverModels.mockResolvedValue({
				models: discoveredGoogleModels,
				lastUpdated: Date.now(),
				success: true,
			});

			(ModelMapper.mapToGeminiModels as jest.Mock).mockReturnValue(mappedModels);
			(ModelMapper.sortModelsByPreference as jest.Mock).mockReturnValue(mappedModels);
			(ModelMapper.mergeWithExistingModels as jest.Mock).mockReturnValue(mergedModels);

			const result = await modelManager.getAvailableModels({ preserveUserCustomizations: true });

			expect(ModelMapper.mergeWithExistingModels).toHaveBeenCalledWith(mappedModels, ModelManager.getStaticModels());
			expect(result).toEqual(mergedModels);
		});

		it('should fallback to static models when discovery fails', async () => {
			mockDiscoveryService.discoverModels.mockResolvedValue({
				models: [],
				lastUpdated: Date.now(),
				success: false,
				error: 'API Error',
			});

			const result = await modelManager.getAvailableModels();

			// Should return static models WITHOUT image generation models (filtered out by default)
			const expectedModels = ModelManager.getStaticModels().filter(m => !m.supportsImageGeneration);
			expect(result).toEqual(expectedModels);
		});

		it('should fallback to static models when discovery throws exception', async () => {
			mockDiscoveryService.discoverModels.mockRejectedValue(new Error('Network error'));

			const result = await modelManager.getAvailableModels();

			// Should return static models WITHOUT image generation models (filtered out by default)
			const expectedModels = ModelManager.getStaticModels().filter(m => !m.supportsImageGeneration);
			expect(result).toEqual(expectedModels);
		});
	});

	describe('updateModels', () => {
		it('should detect changes and update global models list', async () => {
			const newModels: GeminiModel[] = [
				{ value: 'gemini-3.0-pro', label: 'Gemini 3.0 Pro', defaultForRoles: ['chat'] },
			];

			const existingModels = [
				{ value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', defaultForRoles: ['chat'] },
				{ value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', defaultForRoles: ['summary'] },
			];

			// Mock getAvailableModels to return new models
			jest.spyOn(modelManager, 'getAvailableModels').mockResolvedValue(newModels);

			// Mock getCurrentGeminiModels to return different models
			(modelManager as any).getCurrentGeminiModels = jest.fn().mockReturnValue(existingModels);

			const result = await modelManager.updateModels();

			expect(mockSetGeminiModels).toHaveBeenCalledWith(newModels);
		});

		it('should return no changes when models are the same', async () => {
			const mockModels = [
				{ value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', defaultForRoles: ['chat'] },
				{ value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', defaultForRoles: ['summary'] },
			];

			// Mock getAvailableModels to return same models
			jest.spyOn(modelManager, 'getAvailableModels').mockResolvedValue(mockModels as any);

			// Mock getCurrentGeminiModels to return same models
			(modelManager as any).getCurrentGeminiModels = jest.fn().mockReturnValue(mockModels);

			const result = await modelManager.updateModels();

			expect(result.settingsChanged).toBe(false);
			expect(mockSetGeminiModels).not.toHaveBeenCalled();
		});
	});

	describe('getDiscoveryStatus', () => {
		it('should return disabled status when discovery is disabled', async () => {
			const pluginWithDisabledDiscovery = {
				...mockPlugin,
				settings: {
					...mockPlugin.settings,
					modelDiscovery: { enabled: false },
				},
			};
			const manager = new ModelManager(pluginWithDisabledDiscovery);

			const status = await manager.getDiscoveryStatus();

			expect(status.enabled).toBe(false);
			expect(status.working).toBe(false);
		});

		it('should return working status when discovery is successful', async () => {
			const lastUpdate = Date.now();
			mockDiscoveryService.discoverModels.mockResolvedValue({
				models: [],
				lastUpdated: lastUpdate,
				success: true,
			});

			const status = await modelManager.getDiscoveryStatus();

			expect(status.enabled).toBe(true);
			expect(status.working).toBe(true);
			expect(status.lastUpdate).toBe(lastUpdate);
		});

		it('should return error status when discovery fails', async () => {
			mockDiscoveryService.discoverModels.mockResolvedValue({
				models: [],
				lastUpdated: Date.now(),
				success: false,
				error: 'API Error',
			});

			const status = await modelManager.getDiscoveryStatus();

			expect(status.enabled).toBe(true);
			expect(status.working).toBe(false);
			expect(status.error).toBe('API Error');
		});

		it('should handle discovery service exceptions', async () => {
			mockDiscoveryService.discoverModels.mockRejectedValue(new Error('Network error'));

			const status = await modelManager.getDiscoveryStatus();

			expect(status.enabled).toBe(true);
			expect(status.working).toBe(false);
			expect(status.error).toBe('Network error');
		});
	});

	describe('refreshModels', () => {
		it('should force refresh and return success status', async () => {
			const newModels: GeminiModel[] = [{ value: 'gemini-new', label: 'New Model', defaultForRoles: ['chat'] }];

			jest.spyOn(modelManager, 'updateModels').mockResolvedValue({
				updatedSettings: mockPlugin.settings,
				settingsChanged: true,
				changedSettingsInfo: ['Model updated'],
			});

			jest.spyOn(modelManager, 'getAvailableModels').mockResolvedValue(newModels);

			const result = await modelManager.refreshModels();

			expect(result.success).toBe(true);
			expect(result.modelsFound).toBe(1);
			expect(result.changes).toBe(true);
			expect(modelManager.updateModels).toHaveBeenCalledWith({
				forceRefresh: true,
				preserveUserCustomizations: true,
			});
		});

		it('should handle refresh errors', async () => {
			jest.spyOn(modelManager, 'updateModels').mockRejectedValue(new Error('Refresh failed'));

			const result = await modelManager.refreshModels();

			expect(result.success).toBe(false);
			expect(result.modelsFound).toBe(0);
			expect(result.changes).toBe(false);
			expect(result.error).toBe('Refresh failed');
		});
	});

	describe('initialize', () => {
		it('should initialize discovery service cache', async () => {
			await modelManager.initialize();

			expect(mockDiscoveryService.loadCache).toHaveBeenCalled();
		});
	});

	describe('static methods', () => {
		it('should return static models copy', () => {
			const staticModels = ModelManager.getStaticModels();

			expect(staticModels).toEqual(expect.arrayContaining([expect.objectContaining({ value: expect.any(String) })]));
			// Ensure it's a copy, not the original array
			staticModels.push({ value: 'test', label: 'Test', defaultForRoles: ['chat'] });
			expect(ModelManager.getStaticModels()).not.toContainEqual(expect.objectContaining({ value: 'test' }));
		});
	});

	describe('detectModelChanges', () => {
		it('should detect length differences', () => {
			const current: GeminiModel[] = [{ value: 'model1', label: 'Model 1', defaultForRoles: ['chat'] }];
			const previous: GeminiModel[] = [
				{ value: 'model1', label: 'Model 1', defaultForRoles: ['chat'] },
				{ value: 'model2', label: 'Model 2', defaultForRoles: ['summary'] },
			];

			const hasChanges = (modelManager as any).detectModelChanges(current, previous);

			expect(hasChanges).toBe(true);
		});

		it('should detect different model IDs', () => {
			const current: GeminiModel[] = [{ value: 'model1', label: 'Model 1', defaultForRoles: ['chat'] }];
			const previous: GeminiModel[] = [{ value: 'model2', label: 'Model 2', defaultForRoles: ['chat'] }];

			const hasChanges = (modelManager as any).detectModelChanges(current, previous);

			expect(hasChanges).toBe(true);
		});

		it('should return false for identical model lists', () => {
			const models: GeminiModel[] = [
				{ value: 'model1', label: 'Model 1', defaultForRoles: ['chat'] },
				{ value: 'model2', label: 'Model 2', defaultForRoles: ['summary'] },
			];

			const hasChanges = (modelManager as any).detectModelChanges(models, models);

			expect(hasChanges).toBe(false);
		});
	});
});
