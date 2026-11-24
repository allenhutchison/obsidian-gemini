import type { ObsidianGemini } from '../types/plugin';
import * as modelsModule from '../models';
import { GeminiModel, ModelProvider, getUpdatedFeatureRoutes, isModelEligibleForRole } from '../models';
import { activeProviders, featureProvider } from '../api/feature-routing';
import { PROVIDER_IDS, providerSupports } from '../api/providers/registry';
import { providerConnection } from '../api/provider-status';
import type { ObsidianGeminiSettings } from '../types/settings';
import { GeminiModelsService } from './gemini-models-service';
import { OllamaModelsService } from './ollama-models-service';
import { OpenAIModelsService } from './openai-models-service';
import { AnthropicModelsService } from './anthropic-models-service';
import { OpenRouterModelsService } from './openrouter-models-service';

export interface ModelUpdateOptions {
	forceRefresh?: boolean;
}

export type RefreshSkippedReason = 'provider' | 'offline' | 'needsKey';

export interface RefreshResult {
	fetched: boolean;
	modelCount: number;
	skippedReason?: RefreshSkippedReason;
}

type ProviderModelsService =
	GeminiModelsService | OllamaModelsService | OpenAIModelsService | AnthropicModelsService | OpenRouterModelsService;

export interface ModelUpdateOutcome {
	updatedSettings: ObsidianGeminiSettings;
	settingsChanged: boolean;
	changedSettingsInfo: string[];
}

export class ModelManager {
	private plugin: ObsidianGemini;
	private geminiModelsService: GeminiModelsService;
	private ollamaModelsService: OllamaModelsService;
	private openaiModelsService: OpenAIModelsService;
	private anthropicModelsService: AnthropicModelsService;
	private openrouterModelsService: OpenRouterModelsService;

	constructor(plugin: ObsidianGemini) {
		this.plugin = plugin;
		this.geminiModelsService = new GeminiModelsService(plugin);
		this.ollamaModelsService = new OllamaModelsService(plugin);
		this.openaiModelsService = new OpenAIModelsService(plugin);
		this.anthropicModelsService = new AnthropicModelsService(plugin);
		this.openrouterModelsService = new OpenRouterModelsService(plugin);
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
		// eslint-disable-next-line no-restricted-syntax -- provider-specific service selection inside the model manager; cleared as #703 lands
		const target = provider ?? featureProvider(this.plugin.settings, 'chat') ?? 'gemini';
		return (await this.getProviderModelsService(target).getModels(options.forceRefresh)).filter((m) =>
			isModelEligibleForRole(m, 'chat')
		);
	}

	/**
	 * Get image-generation models for the provider serving that feature.
	 */
	async getImageGenerationModels(provider?: ModelProvider): Promise<GeminiModel[]> {
		// eslint-disable-next-line no-restricted-syntax -- provider-specific service selection inside the model manager; cleared as #703 lands
		const target = provider ?? featureProvider(this.plugin.settings, 'imageGen') ?? 'gemini';
		return (await this.getProviderModelsService(target).getModels()).filter((m) => isModelEligibleForRole(m, 'image'));
	}

	/**
	 * Providers whose models go into the global list: every active provider,
	 * plus every connected chat provider, which a session could be pinned to
	 * (#1679). Connected rather than `providerSelectable`, so an Ollama daemon
	 * nobody has probed (the default localhost URL on a vault that never used
	 * Ollama) doesn't cost a failed request at every startup;
	 * {@link ensureProviderModels} covers that case on demand. A session
	 * pinned to a provider no feature routes to still needs that provider's
	 * models in the list, or its role default resolves to `''` (send refused),
	 * token counting attributes its model to the chat route's provider, and its
	 * context window falls back to the default.
	 */
	private modelListProviders(): ModelProvider[] {
		const active = new Set(activeProviders(this.plugin.settings));
		return PROVIDER_IDS.filter(
			(p) => active.has(p) || (providerSupports(p, 'chat') && providerConnection(this.plugin, p) === 'connected')
		);
	}

	/**
	 * Make sure the global list holds `provider`'s models, fetching and merging
	 * them in when it holds none (#1679). A session can be pinned to a provider
	 * the startup list skipped: one no feature routes to whose connection
	 * wasn't confirmed yet (an Ollama daemon not probed this run, a custom
	 * endpoint with no key). Without its models in the list the session's
	 * default model resolves to `''` and its model ids can't be attributed to
	 * it. A no-op when the list already has the provider's models, so callers
	 * can run it before every turn. Best-effort: a list that fails to load
	 * leaves the global list as it was.
	 */
	async ensureProviderModels(provider: ModelProvider): Promise<void> {
		if (modelsModule.hasModelsFor(provider)) return;
		let models: GeminiModel[];
		try {
			models = await this.getProviderModelsService(provider).getModels();
		} catch (error) {
			this.plugin.logger.warn(`[ModelManager] Could not load ${provider} models:`, error);
			return;
		}
		// Re-check after the await: another load may have installed them meanwhile.
		if (models.length === 0 || modelsModule.hasModelsFor(provider)) return;
		this.updateGlobalModelsList([...modelsModule.GEMINI_MODELS, ...models]);
	}

	/**
	 * The union of the models of every provider in {@link modelListProviders} —
	 * what the global `GEMINI_MODELS` list holds since #704, so that a mixed
	 * configuration can look up models for any of them at the same time. Ollama
	 * tags are best-effort: a daemon that's down contributes nothing rather than
	 * failing the whole list.
	 */
	private async collectActiveModels(forceRefresh?: boolean): Promise<GeminiModel[]> {
		return (await this.collectActiveModelsWithCompleteness(forceRefresh)).models;
	}

	/**
	 * {@link collectActiveModels}, plus the providers whose list was incomplete
	 * when it was collected. Completeness is read right after each provider's
	 * own fetch, so a later refresh landing while other providers are still
	 * loading can't vouch for the older, partial list in hand.
	 */
	private async collectActiveModelsWithCompleteness(
		forceRefresh?: boolean
	): Promise<{ models: GeminiModel[]; incomplete: Set<ModelProvider> }> {
		const models: GeminiModel[] = [];
		const incomplete = new Set<ModelProvider>();
		for (const provider of this.modelListProviders()) {
			const service = this.getProviderModelsService(provider);
			try {
				models.push(...(await service.getModels(forceRefresh)));
			} catch (error) {
				this.plugin.logger.warn(`[ModelManager] Could not load ${provider} models:`, error);
			}
			// A catalog merged from several sources (Ollama local + cloud) with one
			// source missing is reachable but not authoritative: judging saved
			// models against it would clear selections from the missing source.
			if ('catalogComplete' in service && !service.catalogComplete) {
				incomplete.add(provider);
			}
		}
		return { models, incomplete };
	}

	/**
	 * Active providers whose list in hand came from their API. The others are
	 * serving a fallback (or nothing), so stale-model reconciliation leaves
	 * their saved choices alone.
	 */
	private verifiedProviders(incomplete: Set<ModelProvider>): Set<ModelProvider> {
		return new Set(
			activeProviders(this.plugin.settings).filter(
				(p) => this.getProviderModelsService(p).lastProbe === 'reachable' && !incomplete.has(p)
			)
		);
	}

	/**
	 * Get the Ollama models service for direct interaction (e.g. cache refresh).
	 */
	getOllamaModelsService(): OllamaModelsService {
		return this.ollamaModelsService;
	}

	/** The model-list service for a provider. */
	getProviderModelsService(provider: ModelProvider): ProviderModelsService {
		// A Record keyed by every provider id: adding a provider without a
		// service is a compile error rather than silently handing out
		// Anthropic's catalog, which the old if-ladder's last arm did (#1757).
		const services: Record<ModelProvider, ProviderModelsService> = {
			gemini: this.geminiModelsService,
			ollama: this.ollamaModelsService,
			openai: this.openaiModelsService,
			anthropic: this.anthropicModelsService,
			openrouter: this.openrouterModelsService,
		};
		return services[provider];
	}

	/**
	 * Update the global GEMINI_MODELS list from every active provider and fix any stale settings.
	 *
	 * The collected list is always installed (labels, context windows and other
	 * metadata can change under the same ids), and reconciliation always runs:
	 * `initialize()` has usually installed the same list already, so gating it on
	 * a change would mean a saved model the API no longer lists is never fixed.
	 * `verifiedProviders()` keeps a fallback list from resetting saved choices.
	 */
	async updateModels(options: ModelUpdateOptions = {}): Promise<ModelUpdateOutcome> {
		// A sync whose Gemini key or base URL changed while it was collecting holds
		// another endpoint's list; installing or reconciling it would judge the
		// current endpoint's saved models against the wrong catalog.
		const endpointBefore = this.geminiModelsService.endpointKey;
		const { models: collected, incomplete } = await this.collectActiveModelsWithCompleteness(options.forceRefresh);
		if (this.geminiModelsService.endpointKey !== endpointBefore) {
			return { updatedSettings: this.plugin.settings, settingsChanged: false, changedSettingsInfo: [] };
		}
		this.updateGlobalModelsList(collected);
		const result = getUpdatedFeatureRoutes(
			this.plugin.settings.features,
			this.plugin.settings.providerModelMemory,
			this.verifiedProviders(incomplete)
		);
		if (!result.changed) {
			return { updatedSettings: this.plugin.settings, settingsChanged: false, changedSettingsInfo: [] };
		}
		return {
			updatedSettings: { ...this.plugin.settings, features: result.features, providerModelMemory: result.memory },
			settingsChanged: true,
			changedSettingsInfo: result.info,
		};
	}

	/**
	 * Initialize the model manager: seed the global list with every active
	 * provider's models, so a mixed configuration can resolve models for all of
	 * them at once.
	 */
	async initialize(): Promise<void> {
		this.updateGlobalModelsList(await this.collectActiveModels());
	}

	/**
	 * Re-query Gemini's ListModels (bypassing the session cache) and sync the
	 * global model array so any open dropdowns see the new entries. Skipped when
	 * no feature uses Gemini, without a key, or offline; on a skip the global
	 * list is left untouched. Rejects when the API can't be reached, so the
	 * caller can show why.
	 */
	async refreshGeminiModels(): Promise<RefreshResult> {
		// eslint-disable-next-line no-restricted-syntax -- provider-specific service selection inside the model manager; cleared as #703 lands
		const gemini: ModelProvider = 'gemini';
		const service = this.geminiModelsService;
		const skipped = (skippedReason: RefreshSkippedReason): RefreshResult => ({
			fetched: false,
			modelCount: modelsModule.GEMINI_MODELS.filter((m) => (m.provider ?? gemini) === gemini).length,
			skippedReason,
		});
		if (!activeProviders(this.plugin.settings).includes(gemini)) return skipped('provider');
		if (!this.plugin.apiKey) return skipped('needsKey');
		if (typeof navigator !== 'undefined' && navigator.onLine === false) return skipped('offline');

		const models = await service.getModels(true);
		if (service.lastProbe !== 'reachable') {
			throw new Error('Could not reach the Gemini API');
		}
		// Rebuild the whole union rather than replacing it with the Gemini list
		// alone — a use case on another provider still needs its models.
		this.updateGlobalModelsList(await this.collectActiveModels());
		return { fetched: true, modelCount: models.length };
	}

	/**
	 * Update the global GEMINI_MODELS array.
	 */
	private updateGlobalModelsList(newModels: GeminiModel[]): void {
		if (modelsModule.setGeminiModels) {
			modelsModule.setGeminiModels(newModels);
		}
	}
}
