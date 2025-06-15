import ObsidianGemini from '../../main';

export interface GoogleModel {
	name: string;
	displayName: string;
	description: string;
	version: string;
	inputTokenLimit: number;
	outputTokenLimit: number;
	supportedGenerationMethods: string[];
	baseModelId?: string;
}

export interface ModelDiscoveryResult {
	models: GoogleModel[];
	lastUpdated: number;
	success: boolean;
	error?: string;
}

export class ModelDiscoveryService {
	private plugin: ObsidianGemini;
	private cache: ModelDiscoveryResult | null = null;
	private readonly CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
	private readonly API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

	constructor(plugin: ObsidianGemini) {
		this.plugin = plugin;
	}

	/**
	 * Discover available models from Google API
	 */
	async discoverModels(forceRefresh = false): Promise<ModelDiscoveryResult> {
		// Check cache first
		if (!forceRefresh && this.cache && this.isCacheValid()) {
			return this.cache;
		}

		try {
			const models = await this.fetchModelsFromAPI();
			const result: ModelDiscoveryResult = {
				models,
				lastUpdated: Date.now(),
				success: true,
			};

			this.cache = result;
			await this.persistCache(result);
			return result;
		} catch (error) {
			const result: ModelDiscoveryResult = {
				models: [],
				lastUpdated: Date.now(),
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error',
			};

			// Return cached models if available, even if stale
			return this.cache || result;
		}
	}

	/**
	 * Fetch models from Google API with pagination support
	 */
	private async fetchModelsFromAPI(): Promise<GoogleModel[]> {
		const apiKey = this.plugin.settings.apiKey;
		if (!apiKey) {
			throw new Error('API key not configured');
		}

		let allModels: GoogleModel[] = [];
		let pageToken: string | undefined;

		do {
			const url = new URL(`${this.API_BASE}/models`);
			url.searchParams.set('key', apiKey);
			if (pageToken) {
				url.searchParams.set('pageToken', pageToken);
			}
			url.searchParams.set('pageSize', '50'); // Max page size

			const response = await fetch(url.toString());
			if (!response.ok) {
				throw new Error(`API request failed: ${response.status} ${response.statusText}`);
			}

			const data = await response.json();
			allModels = allModels.concat(data.models || []);
			pageToken = data.nextPageToken;
		} while (pageToken);

		return allModels.filter((model) => this.isGenerativeModel(model));
	}

	/**
	 * Filter to only generative text models suitable for our use case
	 */
	private isGenerativeModel(model: GoogleModel): boolean {
		return (
			model.supportedGenerationMethods?.includes('generateContent') &&
			model.name.includes('gemini') && // Focus on Gemini models
			!model.name.includes('vision') // Exclude vision-only models for now
		);
	}

	/**
	 * Check if cache is still valid
	 */
	private isCacheValid(): boolean {
		return this.cache && Date.now() - this.cache.lastUpdated < this.CACHE_DURATION;
	}

	/**
	 * Persist cache to plugin data
	 */
	private async persistCache(result: ModelDiscoveryResult): Promise<void> {
		const data = (await this.plugin.loadData()) || {};
		data.modelDiscoveryCache = result;
		await this.plugin.saveData(data);
	}

	/**
	 * Load cache from plugin data
	 */
	async loadCache(): Promise<void> {
		const data = (await this.plugin.loadData()) || {};
		this.cache = data.modelDiscoveryCache || null;
	}

	/**
	 * Clear the cache
	 */
	clearCache(): void {
		this.cache = null;
	}

	/**
	 * Get cache status information
	 */
	getCacheInfo(): { hasCache: boolean; isValid: boolean; lastUpdated?: number } {
		return {
			hasCache: !!this.cache,
			isValid: this.isCacheValid(),
			lastUpdated: this.cache?.lastUpdated,
		};
	}
}