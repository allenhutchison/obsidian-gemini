import { requestUrl } from 'obsidian';
import type ObsidianGemini from '../main';
import { GeminiModel } from '../models';

/**
 * Models that Ollama exposes for completions are tiny by convention. We pre-bias
 * known small models toward the completions role; everything else stays available
 * for chat / summary / rewrite.
 */
const COMPLETION_NAME_HINTS = ['mini', 'tiny', '1b', '3b', '0.5b', '1.5b', 'lite'];

/**
 * Models known to support vision (image input). Used as a hint only — Ollama
 * does not expose this in /api/tags, so we pattern-match on the family.
 */
const VISION_NAME_HINTS = ['llava', 'bakllava', 'vision', 'moondream', 'qwen2-vl', 'qwen2.5-vl', 'minicpm-v'];

interface OllamaTagsModel {
	name: string;
	model?: string;
	size?: number;
	modified_at?: string;
	details?: {
		parameter_size?: string;
		family?: string;
		families?: string[];
	};
}

interface OllamaTagsResponse {
	models: OllamaTagsModel[];
}

/**
 * Fetches the list of locally available models from an Ollama server's
 * `/api/tags` endpoint and returns them as `GeminiModel` entries that can
 * be merged into the global model list.
 *
 * Uses Obsidian's `requestUrl` so the call works on both desktop and mobile
 * without CORS preflight issues.
 */
export class OllamaModelsService {
	private plugin: ObsidianGemini;
	private cachedModels: GeminiModel[] | null = null;
	private lastBaseUrl: string | null = null;

	constructor(plugin: ObsidianGemini) {
		this.plugin = plugin;
	}

	/**
	 * Returns the cached model list if available, otherwise fetches fresh.
	 * Cache is invalidated when the base URL changes.
	 */
	async getModels(forceRefresh = false): Promise<GeminiModel[]> {
		const baseUrl = this.plugin.settings.ollamaBaseUrl;
		if (!forceRefresh && this.cachedModels && this.lastBaseUrl === baseUrl) {
			return this.cachedModels;
		}

		try {
			const url = `${baseUrl.replace(/\/$/, '')}/api/tags`;
			const response = await requestUrl({ url, method: 'GET', throw: false });

			if (response.status !== 200) {
				throw new Error(`Ollama /api/tags returned HTTP ${response.status}`);
			}

			const data = response.json as OllamaTagsResponse;
			if (!data || !Array.isArray(data.models)) {
				throw new Error('Invalid /api/tags response shape');
			}

			this.cachedModels = data.models.map((m) => this.toGeminiModel(m));
			this.lastBaseUrl = baseUrl;
			this.plugin.logger.log(`[OllamaModelsService] Loaded ${this.cachedModels.length} models from ${baseUrl}`);
			return this.cachedModels;
		} catch (error) {
			this.plugin.logger.warn('[OllamaModelsService] Failed to fetch model list:', error);
			// Cache an empty list so we don't hammer a down server, but tag with the
			// base URL so a successful retry later replaces it.
			this.cachedModels = [];
			this.lastBaseUrl = baseUrl;
			return [];
		}
	}

	/**
	 * Drop the cache (e.g. when the base URL changes or the user clicks "Refresh").
	 */
	invalidate(): void {
		this.cachedModels = null;
		this.lastBaseUrl = null;
	}

	private toGeminiModel(m: OllamaTagsModel): GeminiModel {
		const name = m.name;
		const lower = name.toLowerCase();
		const isCompletion = COMPLETION_NAME_HINTS.some((h) => lower.includes(h));
		const isVision = VISION_NAME_HINTS.some((h) => lower.includes(h));

		const defaultForRoles = isCompletion ? (['completions'] as const) : undefined;

		return {
			value: name,
			label: this.formatLabel(m),
			provider: 'ollama',
			supportsTools: true,
			supportsVision: isVision,
			...(defaultForRoles && { defaultForRoles: [...defaultForRoles] }),
		};
	}

	private formatLabel(m: OllamaTagsModel): string {
		const param = m.details?.parameter_size;
		if (param) {
			return `${m.name} (${param})`;
		}
		return m.name;
	}
}
