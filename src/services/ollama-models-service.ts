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
 * Last-resort vision hint list used only when the /api/show probe is unavailable
 * (network failure, older Ollama that lacks the endpoint, etc.). Primary detection
 * now uses the structured `capabilities` array returned by /api/show, with a
 * template-regex fallback for Ollama versions that predate the capabilities field.
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

/** Subset of the /api/show response used for capability detection. */
interface OllamaShowResponse {
	/** Structured capability strings present in Ollama ≥ 0.x (e.g. "vision", "tools"). */
	capabilities?: string[];
	/** Modelfile template text, present in all Ollama versions. */
	template?: string;
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
	/**
	 * Caches /api/show responses by model name so each model is probed at most
	 * once per listing cycle. A sibling probe (e.g. for tool-use detection,
	 * issue #709) can reuse these cached responses without extra network calls.
	 */
	private showCache = new Map<string, OllamaShowResponse>();

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
		const cacheMatchesBaseUrl = this.lastBaseUrl === baseUrl;
		if (!forceRefresh && this.cachedModels && cacheMatchesBaseUrl) {
			return this.cachedModels;
		}

		// Clear capability probes so they run against the current daemon state.
		if (forceRefresh || !cacheMatchesBaseUrl) {
			this.showCache.clear();
		}

		try {
			// Deliberately no retry/backoff here. The Ollama daemon is local; the
			// dominant failure mode is `ECONNREFUSED` against `localhost:11434`,
			// which is permanent until the user runs `ollama serve` — retrying
			// would just delay the actionable error by 6–14s. Settings → Refresh
			// model list provides the recovery path. Mirrors ModelListProvider's
			// best-effort + manual-refresh pattern for the bundled Gemini list.
			const url = `${baseUrl.replace(/\/$/, '')}/api/tags`;
			const response = await requestUrl({ url, method: 'GET', throw: false });

			if (response.status !== 200) {
				throw new Error(`Ollama /api/tags returned HTTP ${response.status}`);
			}

			const data = response.json as OllamaTagsResponse;
			if (!data || !Array.isArray(data.models)) {
				throw new Error('Invalid /api/tags response shape');
			}

			this.cachedModels = await Promise.all(data.models.map((m) => this.toGeminiModel(m, baseUrl)));
			this.lastBaseUrl = baseUrl;
			this.plugin.logger.log(`[OllamaModelsService] Loaded ${this.cachedModels.length} models from ${baseUrl}`);
			return this.cachedModels;
		} catch (error) {
			this.plugin.logger.warn('[OllamaModelsService] Failed to fetch model list:', error);
			// Don't poison the cache with an empty array — that would stick until
			// the user manually clicks "Refresh" even after the daemon comes back.
			// Returning the previous cache (or an empty list as a non-cached
			// fallback) lets a subsequent automatic call retry the fetch. But only
			// reuse the cache when it matches the active base URL — falling back to
			// another daemon's models would let the dropdown surface entries that
			// don't exist on the new daemon and let the user save invalid selections.
			return cacheMatchesBaseUrl ? (this.cachedModels ?? []) : [];
		}
	}

	/**
	 * Drop the cache (e.g. when the base URL changes or the user clicks "Refresh").
	 */
	invalidate(): void {
		this.cachedModels = null;
		this.lastBaseUrl = null;
		this.showCache.clear();
	}

	/**
	 * Fetches /api/show for a model and caches the result. Returns null on any
	 * failure so callers can fall back to name-hint detection gracefully.
	 */
	private async probeModel(name: string, baseUrl: string): Promise<OllamaShowResponse | null> {
		if (this.showCache.has(name)) {
			return this.showCache.get(name)!;
		}
		try {
			const url = `${baseUrl.replace(/\/$/, '')}/api/show`;
			const response = await requestUrl({ url, method: 'POST', body: JSON.stringify({ model: name }), throw: false });
			if (response.status !== 200) {
				return null;
			}
			const result = response.json as OllamaShowResponse;
			this.showCache.set(name, result);
			return result;
		} catch {
			return null;
		}
	}

	/**
	 * Three-tier vision detection (most- to least-authoritative):
	 *   1. `capabilities` array from /api/show — structured, authoritative on
	 *      current Ollama (e.g. `["completion", "vision"]`).
	 *   2. Template regex — covers older Ollama versions that predate the
	 *      capabilities field but document image support in the modelfile template.
	 *   3. VISION_NAME_HINTS name-match — last resort when /api/show is
	 *      unavailable (daemon unreachable, network error, etc.).
	 */
	private detectVision(name: string, show: OllamaShowResponse | null): boolean {
		if (show !== null) {
			if (Array.isArray(show.capabilities)) {
				return show.capabilities.includes('vision');
			}
			if (typeof show.template === 'string') {
				return /image|vision|multimodal/i.test(show.template);
			}
		}
		const lower = name.toLowerCase();
		return VISION_NAME_HINTS.some((h) => lower.includes(h));
	}

	private async toGeminiModel(m: OllamaTagsModel, baseUrl: string): Promise<GeminiModel> {
		const name = m.name;
		const lower = name.toLowerCase();
		const isCompletion = COMPLETION_NAME_HINT_PATTERNS.some((re) => re.test(lower));
		const show = await this.probeModel(name, baseUrl);
		const isVision = this.detectVision(name, show);

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
