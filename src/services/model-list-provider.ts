import { requestUrl } from 'obsidian';
import type ObsidianGemini from '../main';
import { GeminiModel } from '../models';

// @ts-ignore — esbuild JSON loader
import bundledModelData from '../data/models.json';

interface ModelListJson {
	version: number;
	lastUpdated: string;
	models: GeminiModel[];
}

const REMOTE_URL = 'https://raw.githubusercontent.com/allenhutchison/obsidian-gemini/master/src/data/models.json';
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

export class ModelListProvider {
	private plugin: ObsidianGemini;
	private bundledModels: GeminiModel[];
	private remoteModels: GeminiModel[] | null = null;
	private cacheTimestamp: number = 0;

	constructor(plugin: ObsidianGemini) {
		this.plugin = plugin;
		this.bundledModels = (bundledModelData as ModelListJson).models;
	}

	/**
	 * Load cached remote data from plugin settings (populated during loadSettings()).
	 */
	initialize(): void {
		const cache = this.plugin.settings?.remoteModelCache;
		if (cache?.models && cache?.timestamp) {
			this.remoteModels = cache.models;
			this.cacheTimestamp = cache.timestamp;
			this.plugin.logger.debug(`[ModelListProvider] Loaded cached remote models: ${this.remoteModels!.length} models`);
		}
	}

	/**
	 * Fire-and-forget fetch of the latest models.json from GitHub.
	 * Uses a 24h cache to avoid unnecessary fetches.
	 */
	startRemoteFetch(): void {
		const now = Date.now();
		if (now - this.cacheTimestamp < CACHE_DURATION) {
			this.plugin.logger.debug('[ModelListProvider] Remote cache still fresh, skipping fetch');
			return;
		}

		this.fetchRemoteModels().catch((error) => {
			this.plugin.logger.warn('[ModelListProvider] Remote fetch failed:', error);
		});
	}

	/**
	 * Returns the best available model list: remote if available, otherwise bundled.
	 */
	getModels(): GeminiModel[] {
		return this.remoteModels ?? this.bundledModels;
	}

	/**
	 * Returns text/chat models (excludes image generation models).
	 */
	getTextModels(): GeminiModel[] {
		return this.getModels().filter((m) => !m.supportsImageGeneration);
	}

	/**
	 * Returns only image generation models.
	 */
	getImageModels(): GeminiModel[] {
		return this.getModels().filter((m) => m.supportsImageGeneration === true);
	}

	/**
	 * Returns maxTemperature for a specific model, defaulting to 2.
	 */
	getMaxTemperature(modelValue: string): number {
		const model = this.getModels().find((m) => m.value === modelValue);
		return model?.maxTemperature ?? 2;
	}

	private async fetchRemoteModels(): Promise<void> {
		this.plugin.logger.debug('[ModelListProvider] Fetching remote models.json...');

		const response = await requestUrl({ url: REMOTE_URL });
		if (response.status !== 200) {
			throw new Error(`HTTP ${response.status}`);
		}

		const data: ModelListJson = response.json;

		// Validate schema
		if (typeof data.version !== 'number' || !Array.isArray(data.models) || data.models.length === 0) {
			throw new Error('Invalid models.json schema');
		}

		this.remoteModels = data.models;
		this.cacheTimestamp = Date.now();

		this.plugin.logger.log(`[ModelListProvider] Fetched ${data.models.length} models (updated: ${data.lastUpdated})`);

		// Persist to plugin settings so the cache survives restarts.
		// Writing through plugin.settings (not loadData/saveData) avoids racing with
		// ObsidianGemini.saveSettings(), which owns the canonical save path.
		try {
			this.plugin.settings.remoteModelCache = {
				models: this.remoteModels,
				timestamp: this.cacheTimestamp,
			};
			await this.plugin.saveData(this.plugin.settings);
		} catch (error) {
			this.plugin.logger.warn('[ModelListProvider] Failed to persist remote cache:', error);
		}
	}
}
