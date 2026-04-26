import type ObsidianGemini from '../main';
import * as modelsModule from '../models';
import { GeminiModel, ModelUpdateResult, getUpdatedModelSettings, DEFAULT_GEMINI_MODELS } from '../models';
import { ModelListProvider } from './model-list-provider';
import { ParameterValidationService, ParameterRanges } from './parameter-validation';

export interface ModelUpdateOptions {
	forceRefresh?: boolean;
	preserveUserCustomizations?: boolean;
}

export class ModelManager {
	private plugin: ObsidianGemini;
	private listProvider: ModelListProvider;
	private static staticModels: GeminiModel[] = [...DEFAULT_GEMINI_MODELS];

	constructor(plugin: ObsidianGemini) {
		this.plugin = plugin;
		this.listProvider = new ModelListProvider(plugin);
	}

	/**
	 * Get current text/chat models (excludes image generation models).
	 */
	async getAvailableModels(_options: ModelUpdateOptions = {}): Promise<GeminiModel[]> {
		return this.listProvider.getTextModels();
	}

	/**
	 * Get image generation models.
	 */
	async getImageGenerationModels(): Promise<GeminiModel[]> {
		return this.listProvider.getImageModels();
	}

	/**
	 * Update the global GEMINI_MODELS list from the provider and fix any stale settings.
	 */
	async updateModels(_options: ModelUpdateOptions = {}): Promise<ModelUpdateResult> {
		const allModels = this.listProvider.getModels();
		const previousModels = this.getCurrentGeminiModels();

		const hasChanges = this.detectModelChanges(allModels, previousModels);

		if (hasChanges) {
			this.updateGlobalModelsList(allModels);
			return getUpdatedModelSettings(this.plugin.settings);
		}

		return {
			updatedSettings: this.plugin.settings,
			settingsChanged: false,
			changedSettingsInfo: [],
		};
	}

	/**
	 * Initialize the model manager: load cached remote data and start background fetch.
	 */
	async initialize(): Promise<void> {
		this.listProvider.initialize();

		// Sync global GEMINI_MODELS with the provider's list
		const allModels = this.listProvider.getModels();
		this.updateGlobalModelsList(allModels);

		// Start non-blocking remote fetch for updates
		this.listProvider.startRemoteFetch();
	}

	/**
	 * Get the list provider for direct access.
	 */
	getListProvider(): ModelListProvider {
		return this.listProvider;
	}

	/**
	 * Get static models as fallback.
	 */
	static getStaticModels(): GeminiModel[] {
		return [...ModelManager.staticModels];
	}

	/**
	 * Get parameter ranges based on available models.
	 */
	async getParameterRanges(): Promise<ParameterRanges> {
		return ParameterValidationService.getParameterRanges(this.listProvider.getModels());
	}

	/**
	 * Validate parameter values against model capabilities.
	 */
	async validateParameters(
		temperature: number,
		topP: number
	): Promise<{
		temperature: { isValid: boolean; adjustedValue?: number; warning?: string };
		topP: { isValid: boolean; adjustedValue?: number; warning?: string };
	}> {
		const models = this.listProvider.getModels();
		return {
			temperature: ParameterValidationService.validateTemperature(temperature, undefined, models),
			topP: ParameterValidationService.validateTopP(topP, undefined, models),
		};
	}

	/**
	 * Get parameter display information for settings UI.
	 */
	async getParameterDisplayInfo(): Promise<{
		temperature: string;
		topP: string;
		hasModelData: boolean;
	}> {
		return ParameterValidationService.getParameterDisplayInfo(this.listProvider.getModels());
	}

	/**
	 * Get the current GEMINI_MODELS array.
	 */
	private getCurrentGeminiModels(): GeminiModel[] {
		return modelsModule.GEMINI_MODELS || [];
	}

	/**
	 * Update the global GEMINI_MODELS array.
	 */
	private updateGlobalModelsList(newModels: GeminiModel[]): void {
		if (modelsModule.setGeminiModels) {
			modelsModule.setGeminiModels(newModels);
		}
	}

	/**
	 * Detect if there are changes between current and previous models.
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
	 * Check if two sets are equal.
	 */
	private areSetsEqual<T>(set1: Set<T>, set2: Set<T>): boolean {
		return set1.size === set2.size && [...set1].every((item) => set2.has(item));
	}
}
