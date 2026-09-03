import { requestUrl } from 'obsidian';
import type { ObsidianGemini } from '../types/plugin';
import { GeminiModel } from '../models';

/**
 * Models that Ollama exposes for completions are tiny by convention. We pre-bias
 * known small models toward the completions role; everything else stays available
 * for chat / summary / rewrite. Patterns are matched with digit-aware boundaries
 * so e.g. `1b` does not bleed into `11b` and bias `llava:13b` toward completions.
 *
 * The leading (?:^|\D) consumes any preceding non-digit instead of using a
 * negative lookbehind, which is only supported on iOS 16.4+ (see
 * .claude/guidelines/coding.md) and would crash plugin load on older iOS.
 * Consuming the boundary is safe here because these patterns feed `.test()`,
 * so the extra matched character does not affect the boolean result.
 */
const COMPLETION_NAME_HINT_PATTERNS = [
	/(?:^|\D)0\.5b(?!\d)/i,
	/(?:^|\D)1\.5b(?!\d)/i,
	/(?:^|\D)1b(?!\d)/i,
	/(?:^|\D)3b(?!\d)/i,
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

/**
 * How long an /api/ps result stays fresh. Long enough to collapse the two or
 * three context-limit lookups a single turn makes into one probe, short enough
 * that a model swap (which reloads under a different window) is picked up on the
 * next turn rather than persisting.
 */
const PS_CACHE_TTL_MS = 5_000;

interface OllamaTagsModel {
	name: string;
	model?: string;
	size?: number;
	modified_at?: string;
	/**
	 * Present only on Ollama Cloud entries (e.g. `https://ollama.com`), which are
	 * local manifests that proxy inference to Ollama's servers. This structural
	 * field is the reliable cloud signal — the tag itself is not, since the
	 * suffix varies (`gpt-oss:120b-cloud` vs `glm-5.2:cloud`) and nothing stops a
	 * local model from being named `…-cloud`.
	 */
	remote_host?: string;
	/** The upstream model name the cloud entry proxies to. */
	remote_model?: string;
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
	/**
	 * Architecture-keyed metadata. The context window is reported under an
	 * architecture-prefixed key (`llama.context_length`, `gptoss.context_length`,
	 * …) rather than a fixed field, so it is matched by suffix.
	 */
	model_info?: Record<string, unknown>;
}

/** Subset of the /api/ps response describing currently-loaded models. */
interface OllamaPsResponse {
	models?: { name?: string; model?: string; context_length?: number }[];
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
	/**
	 * Short-lived /api/ps results, keyed by model name. A single turn resolves the
	 * context limit up to three times — the token-usage indicator plus both
	 * compaction thresholds — and the daemon's allocation cannot meaningfully
	 * change between them, so without this each turn issues redundant probes.
	 *
	 * The TTL stays short because the allocation *can* change across turns: Ollama
	 * keeps one model resident, so a swap reloads it under a different window.
	 */
	private psCache = new Map<string, { contextLength: number | null; at: number }>();
	/**
	 * In-flight /api/ps probes, so concurrent misses for the same key share one
	 * request instead of each hitting the daemon. Entries are removed on settle.
	 */
	private psInFlight = new Map<string, Promise<number | null>>();
	/** Bumped by invalidate() so a probe started beforehand can't re-seed the cache. */
	private cacheGeneration = 0;

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
			// Deliberately no retry/backoff: ECONNREFUSED against the local daemon is
			// permanent until `ollama serve` runs, so retrying only delays the
			// actionable error — see #709 for the full rationale.
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
		this.psCache.clear();
		this.cacheGeneration++;
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
			const response = await requestUrl({
				url,
				method: 'POST',
				contentType: 'application/json',
				body: JSON.stringify({ model: name }),
				throw: false,
			});
			if (response.status !== 200) {
				return null;
			}
			const result = response.json as OllamaShowResponse;
			this.showCache.set(name, result);
			return result;
		} catch (err) {
			this.plugin.logger.debug(`[OllamaModelsService] /api/show probe failed for ${name}:`, err);
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
			// A present-but-empty capabilities array is authoritative: the daemon
			// explicitly reports no capabilities, so we do not fall through to name hints.
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

	/**
	 * The model's *trained* context length, from the architecture-prefixed
	 * `<arch>.context_length` key in /api/show's `model_info`.
	 *
	 * This is the model's ceiling, not what the daemon actually allocates —
	 * Ollama sizes the runtime window from available VRAM (4k under 24 GiB) or
	 * `OLLAMA_CONTEXT_LENGTH`, which is usually far smaller. Use
	 * {@link getRuntimeContextLength} for the effective window; this value is
	 * only a better-than-nothing upper bound before the model is first loaded.
	 */
	private extractContextWindow(show: OllamaShowResponse | null): number | undefined {
		const info = show?.model_info;
		if (!info) return undefined;
		for (const [key, value] of Object.entries(info)) {
			if (key.endsWith('.context_length') && typeof value === 'number' && value > 0) {
				return value;
			}
		}
		return undefined;
	}

	/**
	 * The context window the daemon has actually allocated for a currently-loaded
	 * model, from /api/ps. This is authoritative — a model whose weights support
	 * 262k may well be running in a 4k window (see #1252, where that mismatch made
	 * the agent's own system prompt overflow and the model hallucinate).
	 *
	 * Returns null when the model isn't loaded (nothing has been sent to it yet)
	 * or the daemon is unreachable, so callers fall back to a bound.
	 */
	async getRuntimeContextLength(modelName: string): Promise<number | null> {
		const baseUrl = this.plugin.settings.ollamaBaseUrl || OLLAMA_DEFAULT_BASE_URL;
		// Keyed by base URL too: pointing at a different daemon must not serve the
		// previous one's allocation, and this probe can run without getModels()
		// having noticed the switch.
		const cacheKey = `${baseUrl}|${modelName}`;
		const cached = this.psCache.get(cacheKey);
		if (cached && Date.now() - cached.at < PS_CACHE_TTL_MS) {
			return cached.contextLength;
		}
		// The result cache only helps once a probe has resolved, so callers that
		// overlap (the UI's token indicator refreshing while a turn's
		// prepareHistory runs) would each miss and hit the daemon. Share the
		// in-flight probe instead.
		const inFlight = this.psInFlight.get(cacheKey);
		if (inFlight) return inFlight;

		// Writes are guarded by the generation captured at probe start: an
		// invalidate() mid-probe must not be undone by the older result landing
		// afterwards and re-seeding the cache it just cleared.
		const generation = this.cacheGeneration;
		const probe = this.fetchRuntimeContextLength(modelName, baseUrl)
			.then((contextLength) => {
				// Every outcome is cached, including "not loaded" and probe failure. A
				// failing daemon is the case that most needs it — otherwise each turn
				// pays the connection timeout three times over — and the short TTL
				// keeps recovery within a few seconds.
				if (generation === this.cacheGeneration) {
					this.psCache.set(cacheKey, { contextLength, at: Date.now() });
				}
				return contextLength;
			})
			.finally(() => this.psInFlight.delete(cacheKey));

		this.psInFlight.set(cacheKey, probe);
		return probe;
	}

	private async fetchRuntimeContextLength(modelName: string, baseUrl: string): Promise<number | null> {
		try {
			const url = `${baseUrl.replace(/\/$/, '')}/api/ps`;
			const response = await requestUrl({ url, method: 'GET', throw: false });
			if (response.status !== 200) return null;

			const data = response.json as OllamaPsResponse;
			const entry = data?.models?.find((m) => m.name === modelName || m.model === modelName);
			return typeof entry?.context_length === 'number' && entry.context_length > 0 ? entry.context_length : null;
		} catch (err) {
			this.plugin.logger.debug(`[OllamaModelsService] /api/ps probe failed for ${modelName}:`, err);
			return null;
		}
	}

	private async toGeminiModel(m: OllamaTagsModel, baseUrl: string): Promise<GeminiModel> {
		const name = m.name;
		const lower = name.toLowerCase();
		const isCompletion = COMPLETION_NAME_HINT_PATTERNS.some((re) => re.test(lower));
		const show = await this.probeModel(name, baseUrl);
		const isVision = this.detectVision(name, show);
		const contextWindow = this.extractContextWindow(show);

		const defaultForRoles = isCompletion ? (['completions'] as const) : undefined;

		return {
			value: name,
			label: this.formatLabel(m),
			provider: 'ollama',
			supportsVision: isVision,
			...(contextWindow && { contextWindow }),
			...(m.remote_host && { remoteHost: m.remote_host }),
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
