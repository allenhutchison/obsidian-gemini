import { requestUrl } from 'obsidian';
import type ObsidianGemini from '../main';
import { GeminiModel } from '../models';

interface OpenAiModelEntry {
	id: string;
	object?: string;
	created?: number;
	owned_by?: string;
}

interface OpenAiModelsResponse {
	data: OpenAiModelEntry[];
}

export class OpenAiModelsService {
	private plugin: ObsidianGemini;
	private cachedModels: GeminiModel[] | null = null;
	private lastBaseUrl: string | null = null;

	constructor(plugin: ObsidianGemini) {
		this.plugin = plugin;
	}

	async getModels(forceRefresh = false): Promise<GeminiModel[]> {
		const baseUrl = this.plugin.settings.openaiBaseUrl;
		if (!baseUrl) return [];

		const cacheMatchesBaseUrl = this.lastBaseUrl === baseUrl;
		if (!forceRefresh && this.cachedModels && cacheMatchesBaseUrl) {
			return this.cachedModels;
		}

		try {
			const url = `${baseUrl.replace(/\/$/, '')}/models`;
			const response = await requestUrl({ url, method: 'GET', throw: false });

			if (response.status !== 200) {
				throw new Error(`OpenAI /models returned HTTP ${response.status}`);
			}

			const data = response.json as OpenAiModelsResponse;
			if (!data || !Array.isArray(data.data)) {
				throw new Error('Invalid /models response shape');
			}

			this.cachedModels = data.data.map((m) => this.toGeminiModel(m));
			this.lastBaseUrl = baseUrl;
			this.plugin.logger.log(`[OpenAiModelsService] Loaded ${this.cachedModels.length} models from ${baseUrl}`);
			return this.cachedModels;
		} catch (error) {
			this.plugin.logger.warn('[OpenAiModelsService] Failed to fetch model list:', error);
			return cacheMatchesBaseUrl ? (this.cachedModels ?? []) : [];
		}
	}

	invalidate(): void {
		this.cachedModels = null;
		this.lastBaseUrl = null;
	}

	private toGeminiModel(m: OpenAiModelEntry): GeminiModel {
		return {
			value: m.id,
			label: m.id,
			provider: 'openai',
			supportsTools: true,
			supportsVision: false,
		};
	}
}
