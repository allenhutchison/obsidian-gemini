import { requestUrl } from 'obsidian';
import type { ObsidianGemini } from '../types/plugin';
import { DEFAULT_GEMINI_MODELS, type GeminiModel } from '../models';
import { mapGeminiModelList, type GeminiListModelsEntry } from '../api/providers/gemini/model-catalog';
import { CachedModelCatalog, joinBaseUrl, type CatalogEndpoint } from './remote-model-catalog';

/** Google's API host; `customBaseUrl` replaces it, as it does for the SDK client. */
const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com';
/** ListModels caps pages at 1000; pagination still runs in case that changes. */
const PAGE_SIZE = 1000;
/** Guards against a proxy that echoes the same page token forever. */
const MAX_PAGES = 10;

interface GeminiListModelsResponse {
	models?: GeminiListModelsEntry[];
	nextPageToken?: string;
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

	constructor(plugin: ObsidianGemini) {
		this.plugin = plugin;
		this.catalog = new CachedModelCatalog({
			logger: () => this.plugin.logger,
			logPrefix: '[GeminiModelsService]',
			endpoint: () => {
				const apiKey = this.plugin.apiKey;
				const baseUrl = this.plugin.settings.customBaseUrl?.trim() || GEMINI_API_BASE_URL;
				return { key: `${baseUrl}|${apiKey}`, label: baseUrl, apiKey, baseUrl };
			},
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

	async getModels(forceRefresh = false): Promise<GeminiModel[]> {
		// Nothing to ask without a key. Offline, `requestUrl` can hang rather than
		// fail fast, so don't start a request that can only time out.
		if (!this.plugin.apiKey || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
			this.catalog.reset();
			return this.fallbackModels();
		}
		return this.catalog.get(forceRefresh);
	}

	/** Drop the cache (key or base URL changed, or the user clicked "Refresh"). */
	invalidate(): void {
		this.catalog.reset();
	}

	/** The last list fetched with a key, else the built-in models. */
	private fallbackModels(): GeminiModel[] {
		const cached = this.plugin.settings?.remoteModelCache?.models;
		return Array.isArray(cached) && cached.length > 0 ? cached : [...DEFAULT_GEMINI_MODELS];
	}

	/** Performs the ListModels requests and maps the result; throws on any failure. */
	private async fetchModels({ apiKey, baseUrl }: GeminiEndpoint): Promise<GeminiModel[]> {
		const entries: GeminiListModelsEntry[] = [];
		let pageToken: string | undefined;
		let pages = 0;
		do {
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
			pages++;
		} while (pageToken && pages < MAX_PAGES);

		const models = mapGeminiModelList(entries);
		if (models.length === 0) {
			// A key that lists no usable model is almost certainly a proxy or
			// endpoint problem, not a real empty catalog. Treat it as a failure so
			// the fallback is served and saved choices aren't reset against it.
			throw new Error('ListModels returned no usable Gemini models');
		}
		await this.persist(models);
		return models;
	}

	/**
	 * Save the list so the next start has it before (or without) a fetch.
	 * Writing through `plugin.settings` rather than loadData/saveData avoids
	 * racing `saveSettings()`, which owns the canonical save path.
	 */
	private async persist(models: GeminiModel[]): Promise<void> {
		// Skip the write when nothing changed, so a normal start doesn't rewrite
		// data.json (and churn vault sync) every time.
		if (JSON.stringify(this.plugin.settings.remoteModelCache?.models) === JSON.stringify(models)) return;
		try {
			this.plugin.settings.remoteModelCache = { models, timestamp: Date.now() };
			await this.plugin.saveData(this.plugin.settings);
		} catch (error) {
			this.plugin.logger.warn('[GeminiModelsService] Failed to persist model list:', error);
		}
	}
}
