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
 * `/v1/models` reports no capability metadata at all — only id, created, and
 * owned_by — so context windows have to be curated here. All three GPT-5.6
 * models share one input limit, measured against the live API by submitting an
 * over-limit request and reading the ceiling back out of the
 * `context_length_exceeded` error ("Input tokens exceed the configured limit of
 * 922000 tokens"). Re-measure that way rather than trusting published figures;
 * the marketing "1M" does not match what the endpoint enforces.
 */
const GPT56_INPUT_TOKEN_LIMIT = 922_000;

/**
 * Curated metadata for known OpenAI-hosted models, keyed by the model id
 * returned from `/v1/models`. Unknown ids — OpenAI-compatible local servers
 * (LM Studio, MLX, ...) whose catalog we have no curated data for — fall back
 * to `UNKNOWN_MODEL_DEFAULTS` in `toGeminiModel`.
 */
const KNOWN_OPENAI_MODELS: Record<string, OpenAIModelMetadata> = {
	// Current flagship family — the supported set on api.openai.com. Older
	// families (gpt-5.1, gpt-4o, ...) are still reachable via a custom base URL
	// but aren't offered here; see SUPPORTED_OPENAI_HOSTED_MODELS.
	'gpt-5.6-sol': { contextWindow: GPT56_INPUT_TOKEN_LIMIT, supportsVision: true, defaultForRoles: ['chat'] },
	'gpt-5.6-terra': { contextWindow: GPT56_INPUT_TOKEN_LIMIT, supportsVision: true, defaultForRoles: ['summary'] },
	'gpt-5.6-luna': { contextWindow: GPT56_INPUT_TOKEN_LIMIT, supportsVision: true, defaultForRoles: ['completions'] },
};

/**
 * The models offered when the base URL is api.openai.com. The endpoint
 * advertises ~90 ids, most of which this Chat Completions client can't drive
 * usefully (Responses-only, audio, embeddings, legacy families); rather than
 * filter that catalog by heuristic, we allowlist the models actually validated
 * against this client. A custom base URL is unaffected — a compatible server's
 * catalog is whatever it advertises.
 */
const SUPPORTED_OPENAI_HOSTED_MODELS = new Set(Object.keys(KNOWN_OPENAI_MODELS));

/** Applied to a model id absent from {@link KNOWN_OPENAI_MODELS}. */
const UNKNOWN_MODEL_DEFAULTS: OpenAIModelMetadata = {
	contextWindow: 128_000,
	supportsVision: false,
};

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

			const restrictToSupported = isOpenAIHostedEndpoint(baseUrl);
			this.cachedModels = data.data
				.filter((m) => !restrictToSupported || SUPPORTED_OPENAI_HOSTED_MODELS.has(m.id))
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
			supportsVision: meta.supportsVision,
			contextWindow: meta.contextWindow,
			...(meta.defaultForRoles && { defaultForRoles: [...meta.defaultForRoles] }),
		};
	}
}
