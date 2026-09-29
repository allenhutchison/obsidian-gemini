import { requestUrl } from 'obsidian';
import type { ObsidianGemini } from '../types/plugin';
import type { GeminiModel } from '../models';
import { KNOWN_ANTHROPIC_MODELS } from '../api/providers/anthropic/model-catalog';
import { CachedModelCatalog, type CatalogEndpoint } from './remote-model-catalog';

const MODELS_URL = 'https://api.anthropic.com/v1/models?limit=1000';
const ANTHROPIC_VERSION = '2023-06-01';

interface AnthropicModelListEntry {
	id: string;
	display_name?: string;
	/** The model's context window; reported since March 2026. */
	max_input_tokens?: number | null;
}

interface AnthropicModelListResponse {
	data?: AnthropicModelListEntry[];
}

interface AnthropicEndpoint extends CatalogEndpoint {
	apiKey: string;
}

/**
 * The Claude models offered in the settings dropdowns.
 *
 * Only ids in `KNOWN_ANTHROPIC_MODELS` are offered — the client shapes each
 * request per model (see `model-catalog.ts`), so an unvetted id could be sent
 * parameters it rejects. `/v1/models` narrows that allowlist to what the key's
 * organization can actually use, and supplies display names and context
 * windows. Without a key, or when the endpoint can't be reached, the curated
 * list is served as-is: the catalog is static knowledge, and a bad key
 * surfaces as an actionable error on the first real request instead of an
 * empty dropdown. Uses Obsidian's `requestUrl` (no CORS preflight). The cache
 * lifecycle is the shared `CachedModelCatalog`, keyed on the API key so a
 * changed key re-fetches.
 */
export class AnthropicModelsService {
	private plugin: ObsidianGemini;
	private readonly catalog: CachedModelCatalog<AnthropicEndpoint>;

	constructor(plugin: ObsidianGemini) {
		this.plugin = plugin;
		this.catalog = new CachedModelCatalog({
			logger: () => this.plugin.logger,
			logPrefix: '[AnthropicModelsService]',
			endpoint: () => {
				const apiKey = this.plugin.anthropicApiKey;
				return { key: apiKey, label: 'api.anthropic.com', apiKey };
			},
			load: ({ apiKey }) => this.fetchModels(apiKey),
			fallback: catalogModels,
		});
	}

	/**
	 * Outcome of the most recent fetch; `null` until the first fetch, after
	 * `invalidate()`, or while no key is configured.
	 */
	get lastProbe(): 'reachable' | 'unreachable' | null {
		return this.catalog.lastProbe;
	}

	async getModels(forceRefresh = false): Promise<GeminiModel[]> {
		if (!this.plugin.anthropicApiKey) {
			// Nothing to probe without a key. Resetting keeps `lastProbe` from
			// reporting the removed key's outcome.
			this.catalog.reset();
			return catalogModels();
		}
		return this.catalog.get(forceRefresh);
	}

	/** Performs the `/v1/models` request and narrows the curated list; throws on any failure. */
	private async fetchModels(apiKey: string): Promise<GeminiModel[]> {
		const response = await requestUrl({
			url: MODELS_URL,
			method: 'GET',
			headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
			throw: false,
		});
		if (response.status !== 200) {
			throw new Error(`Anthropic /v1/models returned HTTP ${response.status}`);
		}
		const data = response.json as AnthropicModelListResponse;
		if (!data || !Array.isArray(data.data)) {
			throw new Error('Invalid /v1/models response shape');
		}

		const entries = data.data;
		return catalogModels().flatMap((model) => {
			const entry = entries.find((candidate) => servesAlias(candidate.id, model.value));
			if (!entry) return [];
			return [
				{
					...model,
					label: entry.display_name || model.label,
					contextWindow: entry.max_input_tokens || model.contextWindow,
				},
			];
		});
	}

	/** Drop the cache (key changed, or the user clicked "Refresh"). */
	invalidate(): void {
		this.catalog.reset();
	}
}

/**
 * Whether a `/v1/models` id is the catalog alias itself or a dated snapshot of
 * it. The endpoint lists some models only by snapshot (`claude-haiku-4-5` shows
 * up as `claude-haiku-4-5-20251001`); the alias is still what we send.
 */
function servesAlias(id: string, alias: string): boolean {
	return id === alias || (id.startsWith(`${alias}-`) && /^\d{8}$/.test(id.slice(alias.length + 1)));
}

function catalogModels(): GeminiModel[] {
	return Object.entries(KNOWN_ANTHROPIC_MODELS).map(([id, meta]) => ({
		value: id,
		label: id,
		// eslint-disable-next-line no-restricted-syntax -- data tag stamping the provider onto models this service discovered
		provider: 'anthropic' as const,
		supportsVision: true,
		contextWindow: meta.contextWindow,
		...(meta.defaultForRoles && { defaultForRoles: [...meta.defaultForRoles] }),
	}));
}
