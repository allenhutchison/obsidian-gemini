import { requestUrl } from 'obsidian';
import type { ObsidianGemini } from '../types/plugin';
import { DEFAULT_GEMINI_MODELS, type GeminiModel } from '../models';
import { mapGeminiModelList, type GeminiListModelsEntry } from '../api/providers/gemini/model-catalog';
import { CachedModelCatalog, joinBaseUrl, type CatalogEndpoint } from './remote-model-catalog';

/** Google's API host; `customBaseUrl` replaces it, as it does for the SDK client. */
const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com';
/** ListModels caps pages at 1000; pagination still runs in case that changes. */
const PAGE_SIZE = 1000;
/** Guards against a proxy that never stops paging; reaching it is an error, not a short list. */
const MAX_PAGES = 10;

interface GeminiListModelsResponse {
	models?: GeminiListModelsEntry[];
	nextPageToken?: string;
}

/**
 * A non-secret fingerprint of the endpoint a list came from (base URL plus a
 * hash of the key), stored with the persisted list so a list fetched for one
 * key or proxy is never served as the fallback for another.
 */
function endpointFingerprint(baseUrl: string, apiKey: string): string {
	// FNV-1a: not a security boundary, only enough to tell two keys apart.
	let hash = 0x811c9dc5;
	for (let i = 0; i < apiKey.length; i++) {
		hash ^= apiKey.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return `${baseUrl}#${hash.toString(16)}`;
}

interface GeminiEndpoint extends CatalogEndpoint {
	apiKey: string;
	baseUrl: string;
}

/**
 * Discovers the Gemini models the user's key can call, from `GET
 * /v1beta/models` (ListModels), the same way the other providers discover
 * theirs. `mapGeminiModelList` keeps the chat and image models and drops
 * embeddings, TTS, video and the like.
 *
 * Gemini is usually the provider a new install starts on, so the dropdowns
 * need something before a key is entered or when the API can't be reached.
 * The fallback is the last list fetched successfully (persisted in
 * `settings.remoteModelCache`, so it survives restarts), and failing that the
 * short built-in `DEFAULT_GEMINI_MODELS`. `lastProbe` tells the model manager
 * whether the list in hand came from the API, so a fallback list never resets
 * a saved model choice. Uses Obsidian's `requestUrl` (no CORS preflight); the
 * cache is the shared `CachedModelCatalog`, keyed on the key and base URL.
 */
export class GeminiModelsService {
	private plugin: ObsidianGemini;
	private readonly catalog: CachedModelCatalog<GeminiEndpoint>;
	/**
	 * Bumped with every catalog reset, so a fetch that began before one can't
	 * persist its list over a newer fetch's (mirrors the generation guard
	 * `CachedModelCatalog` applies to its in-memory cache).
	 */
	private generation = 0;

	constructor(plugin: ObsidianGemini) {
		this.plugin = plugin;
		this.catalog = new CachedModelCatalog({
			logger: () => this.plugin.logger,
			logPrefix: '[GeminiModelsService]',
			endpoint: () => this.currentEndpoint(),
			load: (endpoint) => this.fetchModels(endpoint),
			fallback: () => this.fallbackModels(),
		});
	}

	/**
	 * Outcome of the most recent fetch; `null` until the first fetch, after
	 * `invalidate()`, or while no key is configured or the device is offline.
	 */
	get lastProbe(): 'reachable' | 'unreachable' | null {
		return this.catalog.lastProbe;
	}

	/** Non-secret identity of the configured endpoint (base URL + key hash). */
	get endpointKey(): string {
		return this.currentEndpoint().key;
	}

	async getModels(forceRefresh = false): Promise<GeminiModel[]> {
		// Nothing to ask without a key. Offline, `requestUrl` can hang rather than
		// fail fast, so don't start a request that can only time out.
		if (!this.plugin.apiKey || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
			this.reset();
			return this.fallbackModels();
		}
		return this.catalog.get(forceRefresh);
	}

	/** Drop the cache (key or base URL changed, or the user clicked "Refresh"). */
	invalidate(): void {
		this.reset();
	}

	private reset(): void {
		this.generation++;
		this.catalog.reset();
	}

	private currentEndpoint(): GeminiEndpoint {
		const apiKey = this.plugin.apiKey;
		const baseUrl = this.plugin.settings.customBaseUrl?.trim() || GEMINI_API_BASE_URL;
		return { key: endpointFingerprint(baseUrl, apiKey), label: baseUrl, apiKey, baseUrl };
	}

	/**
	 * The last list fetched for the current key and base URL, else the built-in
	 * models. A list persisted before the fingerprint existed (or by the old
	 * GitHub-hosted catalog) carries none and is only used while no key is set.
	 */
	private fallbackModels(): GeminiModel[] {
		const cache = this.plugin.settings?.remoteModelCache;
		const models = cache?.models;
		if (!Array.isArray(models) || models.length === 0) return [...DEFAULT_GEMINI_MODELS];
		const matches = cache?.endpoint ? cache.endpoint === this.currentEndpoint().key : !this.plugin.apiKey;
		return matches ? models : [...DEFAULT_GEMINI_MODELS];
	}

	/** Performs the ListModels requests and maps the result; throws on any failure. */
	private async fetchModels({ key, apiKey, baseUrl }: GeminiEndpoint): Promise<GeminiModel[]> {
		const generation = this.generation;
		const entries: GeminiListModelsEntry[] = [];
		const seenTokens = new Set<string>();
		let pageToken: string | undefined;
		let pages = 0;
		do {
			if (pages >= MAX_PAGES) {
				// A partial list must not count as complete: reconciliation would
				// reset saved models that were only on the pages never read.
				throw new Error(`ListModels did not finish within ${MAX_PAGES} pages`);
			}
			const params = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
			if (pageToken) params.set('pageToken', pageToken);
			const response = await requestUrl({
				url: joinBaseUrl(baseUrl, `/v1beta/models?${params.toString()}`),
				method: 'GET',
				headers: { 'x-goog-api-key': apiKey },
				throw: false,
			});
			if (response.status !== 200) {
				throw new Error(`Gemini ListModels returned HTTP ${response.status}`);
			}
			const data = response.json as GeminiListModelsResponse;
			if (!data || !Array.isArray(data.models)) {
				throw new Error('Invalid ListModels response shape');
			}
			entries.push(...data.models);
			pageToken = data.nextPageToken || undefined;
			if (pageToken) {
				if (seenTokens.has(pageToken)) throw new Error('ListModels repeated a page token');
				seenTokens.add(pageToken);
			}
			pages++;
		} while (pageToken);

		const models = mapGeminiModelList(entries);
		if (models.length === 0) {
			// A key that lists no usable model is almost certainly a proxy or
			// endpoint problem, not a real empty catalog. Treat it as a failure so
			// the fallback is served and saved choices aren't reset against it.
			throw new Error('ListModels returned no usable Gemini models');
		}
		// The key or base URL changed while this was in flight, or the cache was
		// reset since it started: either way a newer fetch owns the persisted
		// fallback, so don't overwrite it.
		if (generation === this.generation && this.currentEndpoint().key === key) await this.persist(models, key);
		return models;
	}

	/**
	 * Save the list so the next start has it before (or without) a fetch.
	 * Writing through `plugin.settings` rather than loadData/saveData avoids
	 * racing `saveSettings()`, which owns the canonical save path.
	 */
	private async persist(models: GeminiModel[], endpoint: string): Promise<void> {
		// Skip the write when nothing changed, so a normal start doesn't rewrite
		// data.json (and churn vault sync) every time.
		const cache = this.plugin.settings.remoteModelCache;
		if (cache?.endpoint === endpoint && JSON.stringify(cache.models) === JSON.stringify(models)) return;
		try {
			this.plugin.settings.remoteModelCache = { models, timestamp: Date.now(), endpoint };
			await this.plugin.saveData(this.plugin.settings);
		} catch (error) {
			this.plugin.logger.warn('[GeminiModelsService] Failed to persist model list:', error);
		}
	}
}
