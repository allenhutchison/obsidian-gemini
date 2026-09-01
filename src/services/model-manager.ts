import type { ObsidianGemini } from '../types/plugin';
import * as modelsModule from '../models';
import {
	GeminiModel,
	ModelProvider,
	ModelUpdateResult,
	getUpdatedModelSettings,
	DEFAULT_GEMINI_MODELS,
} from '../models';
import { activeProviders, resolveProviderOrDefault } from '../api/provider-routing';
import type { ObsidianGeminiSettings } from '../types/settings';
import { ModelListProvider, RefreshResult } from './model-list-provider';
import { OllamaModelsService } from './ollama-models-service';
import { OpenAIModelsService } from './openai-models-service';
import { ParameterValidationService, ParameterRanges } from './parameter-validation';

export interface ModelUpdateOptions {
	forceRefresh?: boolean;
}

export class ModelManager {
	private plugin: ObsidianGemini;
	private listProvider: ModelListProvider;
	private ollamaModelsService: OllamaModelsService;
	private openaiModelsService: OpenAIModelsService;
	private static staticModels: GeminiModel[] = [...DEFAULT_GEMINI_MODELS];

	constructor(plugin: ObsidianGemini) {
		this.plugin = plugin;
		this.listProvider = new ModelListProvider(plugin);
		this.ollamaModelsService = new OllamaModelsService(plugin);
		this.openaiModelsService = new OpenAIModelsService(plugin);
	}

	/**
	 * Text/chat models (excludes image generation models) for a given provider.
	 * Defaults to the provider serving chat.
	 *
	 * Each settings dropdown asks for the provider its own use case resolves to,
	 * so a config that runs chat on Ollama and summaries on Gemini offers the
	 * right models in each row (#704).
	 */
	async getAvailableModels(options: ModelUpdateOptions = {}, provider?: ModelProvider): Promise<GeminiModel[]> {
		const target = provider ?? resolveProviderOrDefault(this.plugin.settings, 'chat');
		if (target === 'ollama') {
			return this.ollamaModelsService.getModels(options.forceRefresh);
		}
		if (target === 'openai') {
			return this.openaiModelsService.getModels(options.forceRefresh);
		}
		return this.listProvider.getTextModels();
	}

	/**
	 * Get image generation models. Only Gemini serves image generation today
	 * (`capabilities.imageGen`), so this is always the Gemini list; the picker is
	 * hidden entirely when no provider is routed to image generation.
	 */
	async getImageGenerationModels(): Promise<GeminiModel[]> {
		return this.listProvider.getImageModels();
	}

	/**
	 * The union of every active provider's models — what the global
	 * `GEMINI_MODELS` list holds since #704, so that a mixed configuration can
	 * look up models for either provider at the same time. Ollama tags are
	 * best-effort: a daemon that's down contributes nothing rather than failing
	 * the whole list.
	 */
	private async collectActiveModels(forceRefresh?: boolean): Promise<GeminiModel[]> {
		const providers = activeProviders(this.plugin.settings);
		const models: GeminiModel[] = [];

		if (providers.includes('gemini')) {
			models.push(...this.listProvider.getModels());
		}
		if (providers.includes('ollama')) {
			try {
				models.push(...(await this.ollamaModelsService.getModels(forceRefresh)));
			} catch (error) {
				this.plugin.logger.warn('[ModelManager] Could not load Ollama models:', error);
			}
		}
		if (providers.includes('openai')) {
			try {
				models.push(...(await this.openaiModelsService.getModels(forceRefresh)));
			} catch (error) {
				this.plugin.logger.warn('[ModelManager] Could not load OpenAI models:', error);
			}
		}
		return models;
	}

	/**
	 * Get the Ollama models service for direct interaction (e.g. cache refresh).
	 */
	getOllamaModelsService(): OllamaModelsService {
		return this.ollamaModelsService;
	}

	/**
	 * Get the OpenAI models service for direct interaction (e.g. cache refresh).
	 */
	getOpenAIModelsService(): OpenAIModelsService {
		return this.openaiModelsService;
	}

	/**
	 * Update the global GEMINI_MODELS list from every active provider and fix any stale settings.
	 */
	async updateModels(options: ModelUpdateOptions = {}): Promise<ModelUpdateResult<ObsidianGeminiSettings>> {
		const allModels = await this.collectActiveModels(options.forceRefresh);
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
	 * Initialize the model manager: load cached data and start background fetch.
	 */
	async initialize(): Promise<void> {
		this.listProvider.initialize();

		// Seed the global list with every active provider's models, so a mixed
		// configuration can resolve models for both at once.
		this.updateGlobalModelsList(await this.collectActiveModels());

		if (activeProviders(this.plugin.settings).includes('gemini')) {
			// Start non-blocking remote fetch for updates
			this.listProvider.startRemoteFetch();
		}
	}

	/**
	 * Get the list provider for direct access.
	 */
	getListProvider(): ModelListProvider {
		return this.listProvider;
	}

	/**
	 * Force-refresh the remote Gemini model list (bypassing the 24h cache) and
	 * sync the global model array so any open dropdowns see the new entries.
	 * Provider/offline gates are enforced by `ModelListProvider.refresh()`; on a
	 * skip we leave the global list untouched.
	 */
	async refreshRemoteModels(): Promise<RefreshResult> {
		const result = await this.listProvider.refresh();
		if (result.fetched) {
			// Rebuild the whole union rather than replacing it with the Gemini
			// list alone — an Ollama-served use case still needs its models.
			this.updateGlobalModelsList(await this.collectActiveModels());
		}
		return result;
	}

	/**
	 * Get static models as fallback.
	 */
	static getStaticModels(): GeminiModel[] {
		return [...ModelManager.staticModels];
	}

	/**
	 * Full model list (text + image) for the parameter helpers. Temperature/topP
	 * are chat-request parameters, so the ranges come from the chat provider's
	 * models rather than the union — mixing in another provider's metadata would
	 * widen the range beyond what chat actually accepts.
	 */
	private async getModelsForActiveProvider(): Promise<GeminiModel[]> {
		const provider = resolveProviderOrDefault(this.plugin.settings, 'chat');
		if (provider === 'ollama') {
			return this.ollamaModelsService.getModels();
		}
		if (provider === 'openai') {
			return this.openaiModelsService.getModels();
		}
		return this.listProvider.getModels();
	}

	/**
	 * Get parameter ranges based on available models.
	 */
	async getParameterRanges(): Promise<ParameterRanges> {
		return ParameterValidationService.getParameterRanges(await this.getModelsForActiveProvider());
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
		const models = await this.getModelsForActiveProvider();
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
		return ParameterValidationService.getParameterDisplayInfo(await this.getModelsForActiveProvider());
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
