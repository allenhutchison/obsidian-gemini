import { requestUrl } from 'obsidian';
import type ObsidianGemini from '../main';
import { GeminiModel } from '../models';

/**
 * Models that Ollama exposes for completions are tiny by convention. We pre-bias
 * known small models toward the completions role; everything else stays available
 * for chat / summary / rewrite. Patterns are matched with digit-aware boundaries
 * so e.g. `1b` does not bleed into `11b` and bias `llava:13b` toward completions.
 */
const COMPLETION_NAME_HINT_PATTERNS = [
	/(?<!\d)0\.5b(?!\d)/i,
	/(?<!\d)1\.5b(?!\d)/i,
	/(?<!\d)1b(?!\d)/i,
	/(?<!\d)3b(?!\d)/i,
	/\bmini\b/i,
	/\btiny\b/i,
	/\blite\b/i,
];

/**
 * Models known to support vision (image input). Used as a hint only — Ollama
 * does not expose this in /api/tags, so we pattern-match on the family.
 */
const VISION_NAME_HINTS = ['llava', 'bakllava', 'vision', 'moondream', 'qwen2-vl', 'qwen2.5-vl', 'minicpm-v'];

const OLLAMA_DEFAULT_BASE_URL = 'http://localhost:11434';

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
		// Mirror the runtime client's fallback so model refresh and generation
		// target the same daemon when the user has cleared the field.
		const baseUrl = this.plugin.settings.ollamaBaseUrl || OLLAMA_DEFAULT_BASE_URL;
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
			// Don't poison the cache with an empty array — that would stick until
			// the user manually clicks "Refresh" even after the daemon comes back.
			// Returning the previous cache (or an empty list as a non-cached
			// fallback) lets a subsequent automatic call retry the fetch.
			return this.cachedModels ?? [];
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
		const isCompletion = COMPLETION_NAME_HINT_PATTERNS.some((re) => re.test(lower));
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
