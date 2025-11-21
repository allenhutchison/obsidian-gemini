import ObsidianGemini from '../main';
import { GeminiModel, ModelUpdateResult, getUpdatedModelSettings, DEFAULT_GEMINI_MODELS } from '../models';
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
	private static staticModels: GeminiModel[] = [...DEFAULT_GEMINI_MODELS];

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
		// Always start with static models as baseline
		const staticImageModels = this.filterModelsForVersion(ModelManager.staticModels, true);

		// If dynamic discovery is disabled, return filtered static models
		if (!this.plugin.settings.modelDiscovery?.enabled) {
			this.plugin.logger.debug(`getImageGenerationModels (discovery disabled): returning ${staticImageModels.length} static models`, staticImageModels.map(m => m.value));
			return staticImageModels;
		}

		try {
			const discovery = await this.discoveryService.discoverModels(false);

			if (discovery.success && discovery.models.length > 0) {
				let dynamicModels = ModelMapper.mapToGeminiModels(discovery.models);

				// Merge with static models to ensure we have defaults
				// We want to add static models that are NOT in dynamicModels
				const dynamicIds = new Set(dynamicModels.map((m) => m.value));
				const missingStaticModels = ModelManager.staticModels.filter((m) => !dynamicIds.has(m.value));
				dynamicModels = [...dynamicModels, ...missingStaticModels];

				// Sort models by preference (stable first, then by family)
				dynamicModels = ModelMapper.sortModelsByPreference(dynamicModels);

				this.plugin.logger.debug(`getImageGenerationModels: About to filter ${dynamicModels.length} models for image generation`, dynamicModels.map(m => ({ value: m.value, supportsImageGeneration: m.supportsImageGeneration })));

				// Filter for image generation models only
				const filtered = this.filterModelsForVersion(dynamicModels, true);
				this.plugin.logger.debug(`getImageGenerationModels (discovery enabled): filtered ${filtered.length} from ${dynamicModels.length} models`, filtered.map(m => m.value));

				// If filtering removed everything, fall back to static models
				if (filtered.length === 0) {
					this.plugin.logger.warn('All dynamic image models were filtered out, falling back to static models');
					return staticImageModels;
				}

				return filtered;
			}
		} catch (error) {
			this.plugin.logger.warn('Model discovery failed, falling back to static models:', error);
		}

		// Fallback to filtered static models (image only)
		this.plugin.logger.debug(`getImageGenerationModels (fallback): returning ${staticImageModels.length} static models`);
		return staticImageModels;
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
		this.plugin.logger.debug(`Filtering ${models.length} models. imageModelsOnly=${imageModelsOnly}`);

		// Helper to check if a stable version exists for a preview model
		const hasStableVersion = (previewModelValue: string, allModels: GeminiModel[]): boolean => {
			// Pattern: gemini-1.5-pro-preview-04-09 -> stable: gemini-1.5-pro
			// Pattern: gemini-2.5-flash-preview-09-2025 -> stable: gemini-2.5-flash
			// Pattern: gemini-2.5-flash-image-preview -> stable: gemini-2.5-flash-image
			const baseNameMatch = previewModelValue.match(/^(gemini-[\d.]+(?:-pro|-flash|-flash-lite)(?:-image)?)(?:-preview|-exp)/);
			if (!baseNameMatch) return false;

			const baseName = baseNameMatch[1];
			// Check if the base name exists in the list (exact match)
			return allModels.some(m => m.value === baseName);
		};

		return models.filter(model => {
			const modelValue = model.value.toLowerCase();

			if (modelValue.includes('nano') || modelValue.includes('banana')) {
				// Allow Nano Banana if it's an image model and we are looking for image models
				const isImageModel = model.supportsImageGeneration || modelValue.includes('image');
				if (imageModelsOnly && isImageModel) {
					this.plugin.logger.debug(`Model allowed (Nano Banana Image): ${model.value}`);
				} else {
					this.plugin.logger.debug(`Model excluded (nano/banana): ${model.value}`);
					return false;
				}
			}

			// 1. Exclude known non-generative/specialized types
			if (
				modelValue.includes('embedding') ||
				modelValue.includes('aqa') ||
				modelValue.includes('learnlm') ||
				modelValue.includes('gemma') // Exclude Gemma for now as we focus on Gemini
			) {
				return false;
			}

			// 2. Exclude Gemini 2.0 entirely (including thinking models)
			if (modelValue.includes('gemini-2.0')) {
				return false;
			}

			// 3. Exclude Imagen, Veo, TTS, and Computer Use models
			// Note: We need to exclude 'imagen' specifically, not just 'image'
			if (modelValue.includes('imagen-') || modelValue.startsWith('imagen')) {
				this.plugin.logger.debug(`Model excluded (imagen): ${model.value}`);
				return false;
			}
			if (modelValue.includes('veo')) {
				this.plugin.logger.debug(`Model excluded (veo): ${model.value}`);
				return false;
			}
			if (modelValue.includes('tts')) {
				this.plugin.logger.debug(`Model excluded (tts): ${model.value}`);
				return false;
			}
			if (modelValue.includes('computer')) {
				this.plugin.logger.debug(`Model excluded (computer): ${model.value}`);
				return false;
			}
			if (modelValue.includes('nano') || modelValue.includes('banana') ||
				model.label.toLowerCase().includes('nano') || model.label.toLowerCase().includes('banana')) {
				// Already handled above, but just in case logic flow changes
				// This block is actually redundant because of the check at the top of the filter
				// But let's keep it consistent if we want to move the top check down
				// For now, I'll remove the redundant check here to avoid confusion
			}

			// 4. Filter by image generation capability
			if (imageModelsOnly) {
				// Must be an image model
				// Check for "image" in name (e.g. gemini-2.5-flash-image) OR supportsImageGeneration flag
				// We already excluded imagen and veo above.
				const isImageModel = model.supportsImageGeneration || modelValue.includes('image');
				if (!isImageModel) {
					return false;
				}
			} else {
				// Text/Chat models
				// Exclude image-only models
				if (model.supportsImageGeneration || modelValue.includes('image')) {
					return false;
				}
			}

			// 5. Clean up dated previews if stable version exists
			// Apply to both text and image models
			if (modelValue.includes('preview') || modelValue.includes('exp')) {
				if (hasStableVersion(modelValue, models)) {
					this.plugin.logger.debug(`Model filtered out (redundant preview): ${model.value}`);
					return false;
				}
			}

			// 6. Version Check (for both text and image)
			// We want Gemini 2.5+, Gemini 3+, and "latest" aliases.

			// Check for "latest" aliases
			if (modelValue.includes('latest')) {
				return true;
			}

			// Check for Gemini 3+
			if (modelValue.includes('gemini-3')) {
				return true;
			}

			// Check for Gemini 2.5+
			if (modelValue.includes('gemini-2.5')) {
				return true;
			}

			// Log why this model was filtered out
			this.plugin.logger.debug(`Model filtered out (failed version check): ${model.value} (imageModelsOnly=${imageModelsOnly})`);
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
