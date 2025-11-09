import ObsidianGemini from '../main';
import { GeminiModel, ModelUpdateResult, getUpdatedModelSettings } from '../models';
import { ModelDiscoveryService, GoogleModel } from './model-discovery';
import { ModelMapper } from './model-mapper';
import { ParameterValidationService, ParameterRanges } from './parameter-validation';

export interface ModelUpdateOptions {
	forceRefresh?: boolean;
	preserveUserCustomizations?: boolean;
}

export interface ModelDiscoverySettings {
	enabled: boolean;
	autoUpdateInterval: number; // hours
	lastUpdate: number;
	fallbackToStatic: boolean;
}

export class ModelManager {
	private plugin: ObsidianGemini;
	private discoveryService: ModelDiscoveryService;
	private static staticModels: GeminiModel[] = [
		// Keep current models as fallback
		{ value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', defaultForRoles: ['chat'] },
		{ value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', defaultForRoles: ['summary'] },
		{ value: 'gemini-2.5-flash-lite-preview-06-17', label: 'Gemini 2.5 Flash Lite', defaultForRoles: ['completions'] },
		{ value: 'gemini-2.5-flash-image-preview', label: 'Gemini 2.5 Flash Image', defaultForRoles: ['image'], supportsImageGeneration: true },
	];

	constructor(plugin: ObsidianGemini) {
		this.plugin = plugin;
		this.discoveryService = new ModelDiscoveryService(plugin);
	}

	/**
	 * Get current models (dynamic or static fallback)
	 * By default, excludes image generation models
	 */
	async getAvailableModels(options: ModelUpdateOptions = {}): Promise<GeminiModel[]> {
		// If dynamic discovery is disabled, return filtered static models
		if (!this.plugin.settings.modelDiscovery?.enabled) {
			return this.filterModelsForVersion(ModelManager.staticModels, false);
		}

		try {
			const discovery = await this.discoveryService.discoverModels(options.forceRefresh);

			if (discovery.success && discovery.models.length > 0) {
				let dynamicModels = ModelMapper.mapToGeminiModels(discovery.models);

				// Sort models by preference (stable first, then by family)
				dynamicModels = ModelMapper.sortModelsByPreference(dynamicModels);

				if (options.preserveUserCustomizations) {
					dynamicModels = ModelMapper.mergeWithExistingModels(dynamicModels, ModelManager.staticModels);
				}

				// Filter for Gemini 2.5+ models only, excluding image models
				return this.filterModelsForVersion(dynamicModels, false);
			}
		} catch (error) {
			this.plugin.logger.warn('Model discovery failed, falling back to static models:', error);
		}

		// Fallback to filtered static models
		return this.filterModelsForVersion(ModelManager.staticModels, false);
	}

	/**
	 * Get image generation models
	 */
	async getImageGenerationModels(): Promise<GeminiModel[]> {
		// If dynamic discovery is disabled, return filtered static models
		if (!this.plugin.settings.modelDiscovery?.enabled) {
			return this.filterModelsForVersion(ModelManager.staticModels, true);
		}

		try {
			const discovery = await this.discoveryService.discoverModels(false);

			if (discovery.success && discovery.models.length > 0) {
				let dynamicModels = ModelMapper.mapToGeminiModels(discovery.models);

				// Sort models by preference (stable first, then by family)
				dynamicModels = ModelMapper.sortModelsByPreference(dynamicModels);

				// Filter for image generation models only
				return this.filterModelsForVersion(dynamicModels, true);
			}
		} catch (error) {
			this.plugin.logger.warn('Model discovery failed, falling back to static models:', error);
		}

		// Fallback to filtered static models (image only)
		return this.filterModelsForVersion(ModelManager.staticModels, true);
	}

	/**
	 * Update models and notify if changes occurred
	 */
	async updateModels(options: ModelUpdateOptions = {}): Promise<ModelUpdateResult> {
		const currentModels = await this.getAvailableModels(options);
		const previousModels = this.getCurrentGeminiModels();

		// Check for changes
		const hasChanges = this.detectModelChanges(currentModels, previousModels);

		if (hasChanges) {
			// Update the global GEMINI_MODELS array
			this.updateGlobalModelsList(currentModels);

			// Update settings to use new default models if current ones are no longer available
			return getUpdatedModelSettings(this.plugin.settings);
		}

		return {
			updatedSettings: this.plugin.settings,
			settingsChanged: false,
			changedSettingsInfo: [],
		};
	}

	/**
	 * Get the current GEMINI_MODELS array
	 */
	private getCurrentGeminiModels(): GeminiModel[] {
		// Import dynamically to avoid circular dependencies
		const models = require('../models');
		return models.GEMINI_MODELS || [];
	}

	/**
	 * Update the global GEMINI_MODELS array
	 */
	private updateGlobalModelsList(newModels: GeminiModel[]): void {
		// Import dynamically to avoid circular dependencies
		const models = require('../models');
		if (models.setGeminiModels) {
			models.setGeminiModels(newModels);
		}
	}

	/**
	 * Detect if there are changes between current and previous models
	 */
	private detectModelChanges(current: GeminiModel[], previous: GeminiModel[]): boolean {
		if (current.length !== previous.length) {
			return true;
		}

		const currentIds = new Set(current.map((m) => m.value));
		const previousIds = new Set(previous.map((m) => m.value));

		return !this.areSetsEqual(currentIds, previousIds);
	}

	/**
	 * Check if two sets are equal
	 */
	private areSetsEqual<T>(set1: Set<T>, set2: Set<T>): boolean {
		return set1.size === set2.size && [...set1].every((item) => set2.has(item));
	}

	/**
	 * Initialize the model manager and load cache
	 */
	async initialize(): Promise<void> {
		await this.discoveryService.loadCache();
	}

	/**
	 * Get discovery service for direct access
	 */
	getDiscoveryService(): ModelDiscoveryService {
		return this.discoveryService;
	}

	/**
	 * Get static models as fallback
	 */
	static getStaticModels(): GeminiModel[] {
		return [...ModelManager.staticModels];
	}

	/**
	 * Filter models to only include Gemini 2.5 or higher
	 * Older versions have been deprecated by Google and are no longer supported
	 *
	 * @param models - Array of models to filter
	 * @param imageModelsOnly - If true, return only image generation models. If false, exclude image generation models.
	 */
	private filterModelsForVersion(models: GeminiModel[], imageModelsOnly: boolean): GeminiModel[] {
		return models.filter(model => {
			const modelValue = model.value.toLowerCase();

			// Filter by image generation capability
			if (imageModelsOnly) {
				// Only return models that support image generation
				if (!model.supportsImageGeneration) {
					return false;
				}
			} else {
				// Exclude models that are only for image generation
				if (model.supportsImageGeneration) {
					return false;
				}
			}

			// Check for Gemini 2.5 or higher
			if (modelValue.includes('gemini-2.5')) {
				return true;
			}

			// Check for Gemini 2.0 or higher (but exclude 2.0 since we need 2.5+)
			if (modelValue.includes('gemini-2.0')) {
				return false;
			}

			// Check for future versions (3.0+)
			const versionMatch = modelValue.match(/gemini-(\d+)\.(\d+)/);
			if (versionMatch) {
				const major = parseInt(versionMatch[1]);
				const minor = parseInt(versionMatch[2]);

				// Accept 2.5+ or any 3.0+
				if (major > 2 || (major === 2 && minor >= 5)) {
					return true;
				}
			}

			// Log filtered models for debugging
			this.plugin.logger.debug(`Filtering out deprecated model ${model.value} - only Gemini 2.5+ supported`);
			return false;
		});
	}

	/**
	 * Check if model discovery is enabled and working
	 */
	async getDiscoveryStatus(): Promise<{
		enabled: boolean;
		working: boolean;
		lastUpdate?: number;
		error?: string;
	}> {
		const enabled = this.plugin.settings.modelDiscovery?.enabled || false;

		if (!enabled) {
			return { enabled: false, working: false };
		}

		try {
			const discovery = await this.discoveryService.discoverModels(false); // Use cache
			return {
				enabled: true,
				working: discovery.success,
				lastUpdate: discovery.lastUpdated,
				error: discovery.error,
			};
		} catch (error) {
			return {
				enabled: true,
				working: false,
				error: error instanceof Error ? error.message : 'Unknown error',
			};
		}
	}

	/**
	 * Force refresh models and return status
	 */
	async refreshModels(): Promise<{
		success: boolean;
		modelsFound: number;
		changes: boolean;
		error?: string;
	}> {
		try {
			const result = await this.updateModels({
				forceRefresh: true,
				preserveUserCustomizations: true,
			});

			const models = await this.getAvailableModels({ forceRefresh: true });

			return {
				success: true,
				modelsFound: models.length,
				changes: result.settingsChanged,
			};
		} catch (error) {
			return {
				success: false,
				modelsFound: 0,
				changes: false,
				error: error instanceof Error ? error.message : 'Unknown error',
			};
		}
	}

	/**
	 * Get parameter ranges based on discovered models
	 */
	async getParameterRanges(): Promise<ParameterRanges> {
		if (!this.plugin.settings.modelDiscovery?.enabled) {
			return ParameterValidationService.getParameterRanges([]);
		}

		try {
			const discovery = await this.discoveryService.discoverModels(false); // Use cache
			const discoveredModels = discovery.success ? discovery.models : [];
			return ParameterValidationService.getParameterRanges(discoveredModels);
		} catch (error) {
			this.plugin.logger.warn('Failed to get parameter ranges from discovered models:', error);
			return ParameterValidationService.getParameterRanges([]);
		}
	}

	/**
	 * Get discovered models with parameter information
	 */
	async getDiscoveredModels(): Promise<GoogleModel[]> {
		if (!this.plugin.settings.modelDiscovery?.enabled) {
			return [];
		}

		try {
			const discovery = await this.discoveryService.discoverModels(false);
			return discovery.success ? discovery.models : [];
		} catch (error) {
			this.plugin.logger.warn('Failed to get discovered models:', error);
			return [];
		}
	}

	/**
	 * Validate parameter values against model capabilities
	 */
	async validateParameters(temperature: number, topP: number, modelName?: string): Promise<{
		temperature: { isValid: boolean; adjustedValue?: number; warning?: string };
		topP: { isValid: boolean; adjustedValue?: number; warning?: string };
	}> {
		const discoveredModels = await this.getDiscoveredModels();
		
		return {
			temperature: ParameterValidationService.validateTemperature(temperature, modelName, discoveredModels),
			topP: ParameterValidationService.validateTopP(topP, modelName, discoveredModels),
		};
	}

	/**
	 * Get parameter display information for settings UI
	 */
	async getParameterDisplayInfo(): Promise<{
		temperature: string;
		topP: string;
		hasModelData: boolean;
	}> {
		const discoveredModels = await this.getDiscoveredModels();
		return ParameterValidationService.getParameterDisplayInfo(discoveredModels);
	}
}
