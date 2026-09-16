import { requestUrl } from 'obsidian';
import type { ObsidianGemini } from '../types/plugin';
import type { GeminiModel } from '../models';
import { KNOWN_ANTHROPIC_MODELS } from '../api/providers/anthropic/model-catalog';

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
 * empty dropdown. Uses Obsidian's `requestUrl` (no CORS preflight), and the
 * cache is keyed on the API key so a changed key re-fetches.
 */
export class AnthropicModelsService {
	private plugin: ObsidianGemini;
	private cachedModels: GeminiModel[] | null = null;
	private lastApiKey: string | null = null;
	/**
	 * Outcome of the most recent fetch; `null` until the first fetch, after
	 * `invalidate()`, or while no key is configured.
	 */
	private lastProbeResult: 'reachable' | 'unreachable' | null = null;

	constructor(plugin: ObsidianGemini) {
		this.plugin = plugin;
	}

	get lastProbe(): 'reachable' | 'unreachable' | null {
		return this.lastProbeResult;
	}

	async getModels(forceRefresh = false): Promise<GeminiModel[]> {
		const apiKey = this.plugin.anthropicApiKey;
		if (!apiKey) {
			this.lastProbeResult = null;
			return catalogModels();
		}
		if (!forceRefresh && this.cachedModels && this.lastApiKey === apiKey) {
			return this.cachedModels;
		}

		try {
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
			this.cachedModels = catalogModels().flatMap((model) => {
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
			this.lastApiKey = apiKey;
			this.lastProbeResult = 'reachable';
			this.plugin.logger.log(`[AnthropicModelsService] Loaded ${this.cachedModels.length} models`);
			return this.cachedModels;
		} catch (error) {
			this.lastProbeResult = 'unreachable';
			this.plugin.logger.warn('[AnthropicModelsService] Failed to fetch model list; using the curated list:', error);
			return this.lastApiKey === apiKey && this.cachedModels ? this.cachedModels : catalogModels();
		}
	}

	/** Drop the cache (key changed, or the user clicked "Refresh"). */
	invalidate(): void {
		this.lastProbeResult = null;
		this.cachedModels = null;
		this.lastApiKey = null;
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
		provider: 'anthropic' as const,
		supportsVision: true,
		contextWindow: meta.contextWindow,
		...(meta.defaultForRoles && { defaultForRoles: [...meta.defaultForRoles] }),
	}));
}
