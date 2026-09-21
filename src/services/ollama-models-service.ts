import { requestUrl } from 'obsidian';
import type { ObsidianGemini } from '../types/plugin';
import { GeminiModel } from '../models';
import { t } from '../i18n';
import { CachedModelCatalog, joinBaseUrl, type CatalogEndpoint } from './remote-model-catalog';

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
 * Cache identity shared by the two probe caches: endpoint plus model name. The
 * same model name on two daemons must never share a probe answer (#1545).
 */
function probeCacheKey(baseUrl: string, name: string): string {
	return `${baseUrl}|${name}`;
}

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
	// wiring:keep
	// wiring:keep — SDK wire shape: parsed from the Ollama /api/tags JSON, consumed by the client that serializes it onward
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

interface OllamaEndpoint extends CatalogEndpoint {
	baseUrl: string;
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
	private readonly catalog: CachedModelCatalog<OllamaEndpoint>;
	/**
	 * Caches /api/show responses so each model is probed at most once per
	 * listing cycle. A sibling probe (e.g. for tool-use detection, issue #709)
	 * can reuse these cached responses without extra network calls.
	 *
	 * Keyed by {@link probeCacheKey} — endpoint plus model name. Keying on the
	 * name alone let a probe from one daemon serve a same-named model on
	 * another after an endpoint switch (#1545).
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
	 * In-flight /api/ps probes with the ps generation each started under, so
	 * concurrent misses for the same key share one request instead of each
	 * hitting the daemon. An entry is reused only while its generation is still
	 * current — after an invalidate() the stale probe keeps answering its own
	 * caller, but new lookups probe fresh. Entries are removed on settle, and
	 * only by the probe that owns them: a stale probe superseded by a newer one
	 * must not evict the newer entry when it lands.
	 */
	private psInFlight = new Map<string, { promise: Promise<number | null>; generation: number }>();
	/**
	 * Generations guarding the two probe caches against a probe that was already
	 * in flight when its cache was cleared. Kept separate because the caches have
	 * different clearing paths: `showCache` is also emptied by the endpoint-change
	 * / force-refresh hook, which must not discard in-flight /api/ps results — a
	 * forced refresh of the same daemon leaves those perfectly valid. Bumping a
	 * shared generation there would throw away good data, so each cache bumps its
	 * own. `invalidate()` bumps both.
	 */
	private showGeneration = 0;
	private psGeneration = 0;

	/**
	 * Outcome of the most recent /api/tags fetch: whether the daemon answered.
	 * `null` until the first fetch (or after `invalidate()`), so the settings UI
	 * can distinguish "not checked yet" from "unreachable".
	 */
	get lastProbe(): 'reachable' | 'unreachable' | null {
		return this.catalog.lastProbe;
	}

	constructor(plugin: ObsidianGemini) {
		this.plugin = plugin;
		this.catalog = new CachedModelCatalog({
			logger: () => this.plugin.logger,
			logPrefix: '[OllamaModelsService]',
			endpoint: () => {
				// Mirror the runtime client's fallback so model refresh and generation
				// target the same daemon when the user has cleared the field.
				const baseUrl = this.plugin.settings.ollamaBaseUrl || OLLAMA_DEFAULT_BASE_URL;
				// The daemon is unauthenticated, so the base URL alone identifies a catalog.
				return { key: baseUrl, label: baseUrl, baseUrl };
			},
			// Clear capability probes so they run against the current daemon state.
			// Bumping the show generation too: a probe already in flight against the
			// previous endpoint must not re-seed the cache it just cleared (#1545).
			beforeFetch: ({ forceRefresh, identityChanged }) => {
				if (forceRefresh || identityChanged) {
					this.showCache.clear();
					this.showGeneration++;
				}
			},
			load: ({ baseUrl }) => this.fetchModels(baseUrl),
		});
	}

	/**
	 * Returns the cached model list if available, otherwise fetches fresh.
	 * Cache is invalidated when the base URL changes.
	 */
	async getModels(forceRefresh = false): Promise<GeminiModel[]> {
		return this.catalog.get(forceRefresh);
	}

	/**
	 * Fetches and maps the daemon's `/api/tags` catalog. Throws on an unreachable
	 * daemon, a non-200 status, or an unexpected response shape; the shared
	 * catalog turns any of those into the identity-aware cache fallback.
	 */
	private async fetchModels(baseUrl: string): Promise<GeminiModel[]> {
		// Deliberately no retry/backoff: ECONNREFUSED against the local daemon is
		// permanent until `ollama serve` runs, so retrying only delays the
		// actionable error — see #709 for the full rationale.
		const response = await requestUrl({ url: joinBaseUrl(baseUrl, '/api/tags'), method: 'GET', throw: false });

		if (response.status !== 200) {
			throw new Error(`Ollama /api/tags returned HTTP ${response.status}`);
		}

		const data = response.json as OllamaTagsResponse;
		if (!data || !Array.isArray(data.models)) {
			throw new Error('Invalid /api/tags response shape');
		}

		return Promise.all(data.models.map((m) => this.toGeminiModel(m, baseUrl)));
	}

	/**
	 * Drop the cache (e.g. when the base URL changes or the user clicks "Refresh").
	 */
	invalidate(): void {
		this.catalog.reset();
		this.showCache.clear();
		this.psCache.clear();
		this.showGeneration++;
		this.psGeneration++;
	}

	/**
	 * Fetches /api/show for a model and caches the result. Returns null on any
	 * failure so callers can fall back to name-hint detection gracefully.
	 *
	 * Keyed by {@link probeCacheKey} and generation-guarded like `psCache`: the
	 * capture-before-await / write-only-if-current pair means a probe started
	 * against one endpoint (or before an invalidate) can neither serve nor re-seed
	 * another endpoint's cache entry after the switch (#1545).
	 */
	private async probeModel(name: string, baseUrl: string): Promise<OllamaShowResponse | null> {
		const cacheKey = probeCacheKey(baseUrl, name);
		if (this.showCache.has(cacheKey)) {
			return this.showCache.get(cacheKey)!;
		}
		const generation = this.showGeneration;
		try {
			const response = await requestUrl({
				url: joinBaseUrl(baseUrl, '/api/show'),
				method: 'POST',
				contentType: 'application/json',
				body: JSON.stringify({ model: name }),
				throw: false,
			});
			if (response.status !== 200) {
				return null;
			}
			const result = response.json as OllamaShowResponse;
			if (generation === this.showGeneration) {
				this.showCache.set(cacheKey, result);
			}
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
		// Keyed by probeCacheKey too: pointing at a different daemon must not serve
		// the previous one's allocation, and this probe can run without getModels()
		// having noticed the switch.
		const cacheKey = probeCacheKey(baseUrl, modelName);
		const cached = this.psCache.get(cacheKey);
		if (cached && Date.now() - cached.at < PS_CACHE_TTL_MS) {
			return cached.contextLength;
		}
		// The result cache only helps once a probe has resolved, so callers that
		// overlap (the UI's token indicator refreshing while a turn's
		// prepareHistory runs) would each miss and hit the daemon. Share the
		// in-flight probe instead — but only while its generation is still
		// current: after an invalidate() mid-probe, a new lookup must go to the
		// daemon rather than ride the stale probe.
		const inFlight = this.psInFlight.get(cacheKey);
		if (inFlight && inFlight.generation === this.psGeneration) {
			return inFlight.promise;
		}

		// Writes are guarded by the generation captured at probe start: an
		// invalidate() mid-probe must not be undone by the older result landing
		// afterwards and re-seeding the cache it just cleared.
		const generation = this.psGeneration;
		const probe = this.fetchRuntimeContextLength(modelName, baseUrl)
			.then((contextLength) => {
				// Every outcome is cached, including "not loaded" and probe failure. A
				// failing daemon is the case that most needs it — otherwise each turn
				// pays the connection timeout three times over — and the short TTL
				// keeps recovery within a few seconds.
				if (generation === this.psGeneration) {
					this.psCache.set(cacheKey, { contextLength, at: Date.now() });
				}
				return contextLength;
			})
			.finally(() => {
				// Remove only if the map still holds *this* probe: a superseded stale
				// probe settling late must not evict the newer entry that replaced it.
				const entry = this.psInFlight.get(cacheKey);
				if (entry?.promise === probe) {
					this.psInFlight.delete(cacheKey);
				}
			});

		this.psInFlight.set(cacheKey, { promise: probe, generation });
		return probe;
	}

	private async fetchRuntimeContextLength(modelName: string, baseUrl: string): Promise<number | null> {
		try {
			const response = await requestUrl({ url: joinBaseUrl(baseUrl, '/api/ps'), method: 'GET', throw: false });
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
			// eslint-disable-next-line no-restricted-syntax -- data tag stamping the provider onto models this service discovered
			provider: 'ollama',
			supportsVision: isVision,
			...(contextWindow && { contextWindow }),
			...(m.remote_host && { remoteHost: m.remote_host }),
			...(defaultForRoles && { defaultForRoles: [...defaultForRoles] }),
		};
	}

	private formatLabel(m: OllamaTagsModel): string {
		const param = m.details?.parameter_size;
		const base = param ? `${m.name} (${param})` : m.name;
		// Cloud entries are local manifests that proxy to ollama.com; say so in
		// the picker, since the provider itself is otherwise "on this machine".
		return m.remote_host ? t('settings.providers.ollamaCloudModelLabel', { model: base }) : base;
	}
}
