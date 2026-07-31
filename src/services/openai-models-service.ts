import { requestUrl } from 'obsidian';
import type { ObsidianGemini } from '../types/plugin';
import { GeminiModel, ModelRole } from '../models';
import { DEFAULT_OPENAI_BASE_URL } from '../api/providers/openai/config';

interface OpenAIModelMetadata {
	contextWindow: number;
	supportsVision: boolean;
	defaultForRoles?: ModelRole[];
}

/**
 * Curated metadata for known OpenAI-hosted models, keyed by the model id
 * returned from `/v1/models`. Unknown ids — OpenAI-compatible local servers
 * (LM Studio, MLX, ...) whose catalog we have no curated data for — fall back
 * to `UNKNOWN_MODEL_DEFAULTS` in `toGeminiModel`.
 */
const KNOWN_OPENAI_MODELS: Record<string, OpenAIModelMetadata> = {
	// Current flagship family. 'gpt-5.6' is an alias of 'gpt-5.6-sol'.
	'gpt-5.6': { contextWindow: 1_000_000, supportsVision: true, defaultForRoles: ['chat'] },
	'gpt-5.6-sol': { contextWindow: 1_000_000, supportsVision: true },
	'gpt-5.6-terra': { contextWindow: 400_000, supportsVision: true, defaultForRoles: ['summary'] },
	'gpt-5.6-luna': { contextWindow: 128_000, supportsVision: true, defaultForRoles: ['completions'] },
	// Still-available older families.
	'gpt-5.1': { contextWindow: 400_000, supportsVision: true },
	'gpt-5': { contextWindow: 400_000, supportsVision: true },
	'gpt-4.1': { contextWindow: 400_000, supportsVision: true },
	'gpt-4o': { contextWindow: 128_000, supportsVision: true },
};

/** Applied to a model id absent from {@link KNOWN_OPENAI_MODELS}. */
const UNKNOWN_MODEL_DEFAULTS: OpenAIModelMetadata = {
	contextWindow: 128_000,
	supportsVision: false,
};

/**
 * Model ids on api.openai.com that aren't chat-completion models (embeddings,
 * audio, image, moderation, legacy completion-only models, ...). Only applied
 * when the base URL is api.openai.com — a compatible local server's catalog
 * is whatever it advertises, and we don't second-guess it.
 */
const NON_CHAT_ID_PATTERNS: RegExp[] = [
	/embedding/i,
	/whisper/i,
	/\btts\b/i,
	/dall-?e/i,
	/moderation/i,
	/davinci/i,
	/babbage/i,
	/realtime/i,
	/\baudio\b/i,
	/\bimage\b/i,
];

interface OpenAIModelListEntry {
	id: string;
}

interface OpenAIModelListResponse {
	data?: OpenAIModelListEntry[];
}

/** Whether `baseUrl` points at the real OpenAI API rather than a compatible server. */
function isOpenAIHostedEndpoint(baseUrl: string): boolean {
	try {
		return new URL(baseUrl).hostname === 'api.openai.com';
	} catch {
		// Unparseable base URL — treat as a compatible server rather than
		// substring-matching (a host like `api.openai.com.evil.example` must
		// never be classified as the official endpoint).
		return false;
	}
}

/**
 * Fetches the list of models available from an OpenAI-compatible `/models`
 * endpoint (api.openai.com or a custom base URL — LM Studio, MLX, ...) and
 * returns them as `GeminiModel` entries that can be merged into the global
 * model list.
 *
 * Uses Obsidian's `requestUrl` so the call works on both desktop and mobile
 * without CORS preflight issues. Caching mirrors `OllamaModelsService`, keyed
 * on base URL *and* API key — unlike Ollama's unauthenticated daemon, a
 * changed key must not keep serving the previous key's model list.
 */
export class OpenAIModelsService {
	private plugin: ObsidianGemini;
	private cachedModels: GeminiModel[] | null = null;
	private lastBaseUrl: string | null = null;
	private lastApiKey: string | null = null;

	constructor(plugin: ObsidianGemini) {
		this.plugin = plugin;
	}

	/**
	 * Returns the cached model list if available, otherwise fetches fresh.
	 * Cache is invalidated when the base URL or API key changes.
	 */
	async getModels(forceRefresh = false): Promise<GeminiModel[]> {
		const baseUrl = this.plugin.settings.openaiBaseUrl || DEFAULT_OPENAI_BASE_URL;
		const apiKey = this.plugin.openaiApiKey;
		const cacheMatches = this.lastBaseUrl === baseUrl && this.lastApiKey === apiKey;
		if (!forceRefresh && this.cachedModels && cacheMatches) {
			return this.cachedModels;
		}

		try {
			const url = `${baseUrl.replace(/\/$/, '')}/models`;
			const response = await requestUrl({
				url,
				method: 'GET',
				headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
				throw: false,
			});

			if (response.status !== 200) {
				throw new Error(`OpenAI /models returned HTTP ${response.status}`);
			}

			const data = response.json as OpenAIModelListResponse;
			if (!data || !Array.isArray(data.data)) {
				throw new Error('Invalid /models response shape');
			}

			const filterNonChatIds = isOpenAIHostedEndpoint(baseUrl);
			this.cachedModels = data.data
				.filter((m) => !filterNonChatIds || !NON_CHAT_ID_PATTERNS.some((re) => re.test(m.id)))
				.map((m) => this.toGeminiModel(m.id));
			this.lastBaseUrl = baseUrl;
			this.lastApiKey = apiKey;
			this.plugin.logger.log(`[OpenAIModelsService] Loaded ${this.cachedModels.length} models from ${baseUrl}`);
			return this.cachedModels;
		} catch (error) {
			this.plugin.logger.warn('[OpenAIModelsService] Failed to fetch model list:', error);
			// Don't poison the cache with an empty array — that would stick until the
			// user manually clicks "Refresh" even after the server comes back. Only
			// reuse the cache when it matches the active base URL/key; falling back to
			// another endpoint's models would let the dropdown surface entries that
			// don't exist there and let the user save invalid selections.
			return cacheMatches ? (this.cachedModels ?? []) : [];
		}
	}

	/**
	 * Drop the cache (e.g. when the base URL or API key changes, or the user
	 * clicks "Refresh").
	 */
	invalidate(): void {
		this.cachedModels = null;
		this.lastBaseUrl = null;
		this.lastApiKey = null;
	}

	private toGeminiModel(id: string): GeminiModel {
		const meta = KNOWN_OPENAI_MODELS[id] ?? UNKNOWN_MODEL_DEFAULTS;
		return {
			value: id,
			label: id,
			provider: 'openai',
			supportsTools: true,
			supportsVision: meta.supportsVision,
			contextWindow: meta.contextWindow,
			...(meta.defaultForRoles && { defaultForRoles: [...meta.defaultForRoles] }),
		};
	}
}
