import { requestUrl } from 'obsidian';
import type { ObsidianGemini } from '../types/plugin';
import type { GeminiModel, ModelRole } from '../models';
import { OPENROUTER_BASE_URL } from '../api/providers/openrouter/config';
import { CachedModelCatalog, joinBaseUrl, type CatalogEndpoint } from './remote-model-catalog';

/** One entry of `GET /models` (text-output models). Only the fields we read are declared. */
interface OpenRouterModelEntry {
	id: string;
	name?: string;
	created?: number;
	context_length?: number | null;
	architecture?: { input_modalities?: string[]; output_modalities?: string[] };
	supported_parameters?: string[];
}

/** One entry of `GET /images/models` (models served by the Images endpoint). */
interface OpenRouterImageModelEntry {
	id: string;
	name?: string;
	created?: number;
}

interface OpenRouterListResponse<T> {
	data?: T[];
}

interface OpenRouterEndpoint extends CatalogEndpoint {
	apiKey: string;
}

/**
 * Role defaults, as ordered preferences over the live catalog. OpenRouter's
 * ids churn with every vendor release, so rather than pinning ids that go
 * stale we pick the newest catalog entry matching each pattern (falling back
 * down the list, then to the catalog's first eligible model via
 * `getDefaultModelForRole`). Gemini Flash-class models lead because they are
 * fast, cheap, tool-capable, and vision-capable — and on-brand.
 */
const ROLE_PREFERENCES: Record<Exclude<ModelRole, 'image'>, RegExp[]> = {
	chat: [/^google\/gemini-[\d.]+-flash(?:-preview)?$/, /^google\/gemini-[\d.]+-pro(?:-preview)?$/],
	summary: [/^google\/gemini-[\d.]+-flash(?:-preview)?$/],
	rewrite: [/^google\/gemini-[\d.]+-flash(?:-preview)?$/],
	completions: [/^google\/gemini-[\d.]+-flash-lite(?:-preview)?$/, /^google\/gemini-[\d.]+-flash(?:-preview)?$/],
};

/**
 * Fetches OpenRouter's model catalog and maps it to `GeminiModel` entries.
 *
 * Unlike OpenAI's bare `/v1/models`, OpenRouter's catalog carries real
 * metadata — `context_length` and per-model input/output modalities — so
 * every model gets its true context window and vision flag instead of the
 * "capabilities unknown" fallback a generic compatible server gets. Image
 * models come from the separate `/images/models` list, which is exactly the
 * set the client's `POST /images` call can drive.
 *
 * Both lists are public, but a provider the user hasn't set up gets no
 * traffic: without a key the catalog is empty. Uses Obsidian's `requestUrl`
 * (no CORS preflight); the cache is the shared `CachedModelCatalog`, keyed on
 * the API key.
 */
export class OpenRouterModelsService {
	private plugin: ObsidianGemini;
	private readonly catalog: CachedModelCatalog<OpenRouterEndpoint>;

	constructor(plugin: ObsidianGemini) {
		this.plugin = plugin;
		this.catalog = new CachedModelCatalog({
			logger: () => this.plugin.logger,
			logPrefix: '[OpenRouterModelsService]',
			endpoint: () => {
				const apiKey = this.plugin.openrouterApiKey;
				return { key: apiKey, label: 'openrouter.ai', apiKey };
			},
			load: ({ apiKey }) => this.fetchModels(apiKey),
		});
	}

	/** Outcome of the most recent fetch; `null` until the first fetch, after `invalidate()`, or with no key. */
	get lastProbe(): 'reachable' | 'unreachable' | null {
		return this.catalog.lastProbe;
	}

	async getModels(forceRefresh = false): Promise<GeminiModel[]> {
		if (!this.plugin.openrouterApiKey) {
			this.catalog.reset();
			return [];
		}
		return this.catalog.get(forceRefresh);
	}

	/** Drop the cache (key changed, or the user clicked "Refresh"). */
	invalidate(): void {
		this.catalog.reset();
	}

	/** Fetches both catalogs; throws when the text catalog fails, tolerates a failed image catalog. */
	private async fetchModels(apiKey: string): Promise<GeminiModel[]> {
		const textEntries = await this.fetchList<OpenRouterModelEntry>(apiKey, '/models');
		let imageEntries: OpenRouterImageModelEntry[] = [];
		try {
			imageEntries = await this.fetchList<OpenRouterImageModelEntry>(apiKey, '/images/models');
		} catch (error) {
			this.plugin.logger.warn('[OpenRouterModelsService] Could not load image models:', error);
		}
		return mapOpenRouterCatalog(textEntries, imageEntries);
	}

	private async fetchList<T>(apiKey: string, path: string): Promise<T[]> {
		const response = await requestUrl({
			url: joinBaseUrl(OPENROUTER_BASE_URL, path),
			method: 'GET',
			headers: { Authorization: `Bearer ${apiKey}` },
			throw: false,
		});
		if (response.status !== 200) {
			throw new Error(`OpenRouter ${path} returned HTTP ${response.status}`);
		}
		const data = response.json as OpenRouterListResponse<T>;
		if (!data || !Array.isArray(data.data)) {
			throw new Error(`Invalid OpenRouter ${path} response shape`);
		}
		return data.data;
	}
}

/**
 * Map OpenRouter's two catalogs to `GeminiModel`s and stamp role defaults.
 * Exported for tests; pure.
 */
export function mapOpenRouterCatalog(
	textEntries: readonly OpenRouterModelEntry[],
	imageEntries: readonly OpenRouterImageModelEntry[]
): GeminiModel[] {
	const valid = <T extends { id?: unknown }>(entry: T): boolean => typeof entry?.id === 'string' && entry.id !== '';
	const textModels: GeminiModel[] = textEntries.filter(valid).map((entry) => ({
		value: entry.id,
		label: entry.name || entry.id,
		// eslint-disable-next-line no-restricted-syntax -- data tag stamping the provider onto models this service discovered
		provider: 'openrouter' as const,
		supportsVision: entry.architecture?.input_modalities?.includes('image') ?? false,
		...(entry.context_length ? { contextWindow: entry.context_length } : {}),
	}));
	const imageModels: GeminiModel[] = imageEntries.filter(valid).map((entry) => ({
		value: entry.id,
		label: entry.name || entry.id,
		// eslint-disable-next-line no-restricted-syntax -- data tag stamping the provider onto models this service discovered
		provider: 'openrouter' as const,
		supportsVision: false,
		supportsImageGeneration: true,
	}));

	const created = new Map<string, number>();
	for (const entry of [...textEntries, ...imageEntries]) {
		if (typeof entry?.id === 'string') created.set(entry.id, entry.created ?? 0);
	}
	const toolCapable = new Set(
		textEntries.filter((e) => valid(e) && e.supported_parameters?.includes('tools')).map((e) => e.id)
	);

	for (const [role, patterns] of Object.entries(ROLE_PREFERENCES) as [ModelRole, RegExp[]][]) {
		// Chat drives the agent's tool loop, so its default must accept tools.
		const pool = role === 'chat' ? textModels.filter((m) => toolCapable.has(m.value)) : textModels;
		const pick = pickNewest(pool, patterns, created);
		if (pick) pick.defaultForRoles = [...(pick.defaultForRoles ?? []), role];
	}
	const imageDefault = imageModels.reduce<GeminiModel | undefined>(
		(best, m) => (!best || (created.get(m.value) ?? 0) > (created.get(best.value) ?? 0) ? m : best),
		undefined
	);
	if (imageDefault) imageDefault.defaultForRoles = ['image'];

	return [...textModels, ...imageModels];
}

/** The newest model matching the first pattern that matches anything. */
function pickNewest(
	models: readonly GeminiModel[],
	patterns: readonly RegExp[],
	created: ReadonlyMap<string, number>
): GeminiModel | undefined {
	for (const pattern of patterns) {
		const matches = models.filter((m) => pattern.test(m.value));
		if (matches.length) {
			return matches.reduce((best, m) => ((created.get(m.value) ?? 0) > (created.get(best.value) ?? 0) ? m : best));
		}
	}
	return undefined;
}
