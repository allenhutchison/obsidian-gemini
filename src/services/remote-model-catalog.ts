import type { GeminiModel } from '../models';

/**
 * The subset of the logger this module reads. Declared structurally rather than
 * importing `Logger` so the module stays a leaf (see AGENTS.md — "wiring
 * interfaces carry only what is read").
 */
export interface CatalogLogger {
	log(...args: unknown[]): void;
	warn(...args: unknown[]): void;
}

/**
 * The endpoint a catalog is about to be — or was last — loaded from.
 *
 * `key` is the *identity* the cache is keyed on, and what counts as identity is
 * the one axis on which the providers legitimately differ: Ollama's daemon is
 * unauthenticated, so its base URL alone identifies a catalog, while a changed
 * OpenAI API key must not keep serving the previous key's model list. Services
 * extend this with whatever their own `load` needs.
 */
export interface CatalogEndpoint {
	/** Cache identity — a fetch is only served from cache when this still matches. */
	key: string;
	/** The endpoint as written in the log line; may be a subset of `key`. */
	label: string;
}

/** Why a fetch is about to happen, for {@link CachedModelCatalogOptions.beforeFetch}. */
export interface CatalogFetchState {
	/** The caller asked for a refresh even though the cache may be warm. */
	forceRefresh: boolean;
	/** The endpoint identity differs from the cached one. */
	identityChanged: boolean;
}

export interface CachedModelCatalogOptions<E extends CatalogEndpoint> {
	/**
	 * Resolved on each use rather than captured, so a service constructed before
	 * the plugin wires its logger still logs to the real one.
	 */
	logger: () => CatalogLogger;
	/** Prefix on both log sentences, e.g. `[OllamaModelsService]`. */
	logPrefix: string;
	/** Resolves the endpoint to fetch from, read fresh on every call. */
	endpoint: () => E;
	/** Performs the request and maps the response; throws on any failure. */
	load: (endpoint: E) => Promise<GeminiModel[]>;
	/** Provider-specific state to reset immediately before a fetch. */
	beforeFetch?: (state: CatalogFetchState) => void;
}

/**
 * Joins a user-supplied base URL to an absolute path, tolerating a trailing
 * slash on the base. Written once here because every provider endpoint needs
 * it and a hand-rolled copy is one new endpoint away from a fifth.
 *
 * @param baseUrl Base URL, with or without a trailing slash.
 * @param path Path to append, including its leading slash.
 */
export function joinBaseUrl(baseUrl: string, path: string): string {
	return `${baseUrl.replace(/\/$/, '')}${path}`;
}

/**
 * The cached-model-list lifecycle shared by the provider model services: fetch a
 * provider's catalog, cache it against the identity of the endpoint it came
 * from, and — on failure — serve the previous cache only while that identity
 * still matches.
 *
 * That last clause is the subtle, load-bearing part, and the reason this is one
 * policy rather than one per provider: it is what stops the model picker
 * offering models that don't exist on the endpoint the user just switched to,
 * and what stops an empty list sticking until a manual "Refresh".
 *
 * Held by composition, not extended — each service keeps its own
 * provider-specific state (Ollama's `/api/show` and `/api/ps` probe caches)
 * outside the shared policy.
 */
export class CachedModelCatalog<E extends CatalogEndpoint> {
	private cachedModels: GeminiModel[] | null = null;
	private lastIdentity: string | null = null;
	private lastProbeResult: 'reachable' | 'unreachable' | null = null;

	constructor(private readonly options: CachedModelCatalogOptions<E>) {}

	/**
	 * Outcome of the most recent fetch; `null` until the first one or after
	 * {@link reset}. Lets the settings UI tell "not checked yet" from a failed
	 * refresh, since {@link get} never rejects.
	 */
	get lastProbe(): 'reachable' | 'unreachable' | null {
		return this.lastProbeResult;
	}

	/** Returns the cached list when it is still valid, otherwise fetches fresh. */
	async get(forceRefresh = false): Promise<GeminiModel[]> {
		const endpoint = this.options.endpoint();
		const identityMatches = this.lastIdentity === endpoint.key;
		if (!forceRefresh && this.cachedModels && identityMatches) {
			return this.cachedModels;
		}

		this.options.beforeFetch?.({ forceRefresh, identityChanged: !identityMatches });

		const { logPrefix } = this.options;
		try {
			const models = await this.options.load(endpoint);
			this.cachedModels = models;
			this.lastIdentity = endpoint.key;
			this.lastProbeResult = 'reachable';
			this.options.logger().log(`${logPrefix} Loaded ${models.length} models from ${endpoint.label}`);
			return models;
		} catch (error) {
			this.lastProbeResult = 'unreachable';
			this.options.logger().warn(`${logPrefix} Failed to fetch model list:`, error);
			// Don't poison the cache with an empty array — that would stick until the
			// user manually clicks "Refresh" even after the server comes back.
			// Returning the previous cache (or an empty list as a non-cached fallback)
			// lets a subsequent automatic call retry the fetch. But only reuse the
			// cache while it matches the active endpoint identity — falling back to
			// another endpoint's models would let the dropdown surface entries that
			// don't exist there and let the user save invalid selections.
			return identityMatches ? (this.cachedModels ?? []) : [];
		}
	}

	/** Drops the cached list, its identity, and the probe outcome. */
	reset(): void {
		this.lastProbeResult = null;
		this.cachedModels = null;
		this.lastIdentity = null;
	}
}
