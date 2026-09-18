import { CachedModelCatalog, joinBaseUrl } from '../../src/services/remote-model-catalog';
import type { CatalogEndpoint } from '../../src/services/remote-model-catalog';
import type { GeminiModel } from '../../src/models';

const buildLogger = () => ({ log: vi.fn(), warn: vi.fn() });

function model(value: string): GeminiModel {
	return { value, label: value, provider: 'ollama', supportsVision: false };
}

interface TestEndpoint extends CatalogEndpoint {
	baseUrl: string;
}

/**
 * Builds a catalog over a mutable endpoint so a test can "switch servers" the
 * way the settings UI does, and a `load` spy standing in for the provider fetch.
 */
function buildCatalog(options?: { withBeforeFetch?: boolean }) {
	const logger = buildLogger();
	const endpoint: TestEndpoint = { key: 'http://a', label: 'http://a', baseUrl: 'http://a' };
	const load = vi.fn<(e: TestEndpoint) => Promise<GeminiModel[]>>();
	const beforeFetch = vi.fn();
	const catalog = new CachedModelCatalog<TestEndpoint>({
		logger: () => logger,
		logPrefix: '[TestService]',
		endpoint: () => endpoint,
		load,
		...(options?.withBeforeFetch ? { beforeFetch } : {}),
	});
	const setEndpoint = (key: string) => {
		endpoint.key = key;
		endpoint.label = key;
		endpoint.baseUrl = key;
	};
	return { catalog, load, logger, beforeFetch, setEndpoint };
}

describe('joinBaseUrl', () => {
	it('appends the path to a base URL without a trailing slash', () => {
		expect(joinBaseUrl('http://localhost:11434', '/api/tags')).toBe('http://localhost:11434/api/tags');
	});

	it('does not double the separator when the base URL has a trailing slash', () => {
		expect(joinBaseUrl('http://localhost:11434/', '/api/tags')).toBe('http://localhost:11434/api/tags');
	});

	it('trims only the final slash, leaving a path prefix intact', () => {
		expect(joinBaseUrl('https://api.openai.com/v1/', '/models')).toBe('https://api.openai.com/v1/models');
		expect(joinBaseUrl('https://api.openai.com/v1', '/models')).toBe('https://api.openai.com/v1/models');
	});
});

describe('CachedModelCatalog', () => {
	it('fetches on first use and logs the count and endpoint', async () => {
		const { catalog, load, logger } = buildCatalog();
		load.mockResolvedValue([model('a'), model('b')]);

		expect(await catalog.get()).toEqual([model('a'), model('b')]);
		expect(load).toHaveBeenCalledTimes(1);
		expect(logger.log).toHaveBeenCalledWith('[TestService] Loaded 2 models from http://a');
		expect(catalog.lastProbe).toBe('reachable');
	});

	it('starts with no probe outcome', () => {
		const { catalog } = buildCatalog();
		expect(catalog.lastProbe).toBeNull();
	});

	it('serves the cache on a second call without refetching', async () => {
		const { catalog, load } = buildCatalog();
		load.mockResolvedValue([model('a')]);

		await catalog.get();
		expect(await catalog.get()).toEqual([model('a')]);
		expect(load).toHaveBeenCalledTimes(1);
	});

	it('refetches when forceRefresh is set even with a warm cache', async () => {
		const { catalog, load } = buildCatalog();
		load.mockResolvedValue([model('a')]);

		await catalog.get();
		await catalog.get(true);
		expect(load).toHaveBeenCalledTimes(2);
	});

	it('refetches when the endpoint identity changes', async () => {
		const { catalog, load, setEndpoint } = buildCatalog();
		load.mockResolvedValue([model('a')]);
		await catalog.get();

		load.mockResolvedValue([model('b')]);
		setEndpoint('http://b');

		expect(await catalog.get()).toEqual([model('b')]);
		expect(load).toHaveBeenCalledTimes(2);
		expect(load.mock.calls[1][0].baseUrl).toBe('http://b');
	});

	it('returns an empty list when the very first fetch fails', async () => {
		const { catalog, load, logger } = buildCatalog();
		const error = new Error('HTTP 500');
		load.mockRejectedValue(error);

		expect(await catalog.get()).toEqual([]);
		expect(logger.warn).toHaveBeenCalledWith('[TestService] Failed to fetch model list:', error);
		expect(catalog.lastProbe).toBe('unreachable');
	});

	it('treats a malformed-response failure exactly like an HTTP failure', async () => {
		// The policy is loader-agnostic: each service throws for a non-200 status and
		// for an unexpected response shape, and the catalog must not distinguish them.
		const { catalog, load, logger } = buildCatalog();
		load.mockResolvedValue([model('a')]);
		await catalog.get();

		const httpError = new Error('Ollama /api/tags returned HTTP 500');
		load.mockRejectedValue(httpError);
		expect(await catalog.get(true)).toEqual([model('a')]);
		expect(logger.warn).toHaveBeenLastCalledWith('[TestService] Failed to fetch model list:', httpError);

		const shapeError = new Error('Invalid /api/tags response shape');
		load.mockRejectedValue(shapeError);
		expect(await catalog.get(true)).toEqual([model('a')]);
		expect(logger.warn).toHaveBeenLastCalledWith('[TestService] Failed to fetch model list:', shapeError);
		expect(catalog.lastProbe).toBe('unreachable');
	});

	it('returns an empty list when a malformed response is the very first fetch', async () => {
		const { catalog, load } = buildCatalog();
		load.mockRejectedValue(new Error('Invalid /models response shape'));

		expect(await catalog.get()).toEqual([]);
		expect(catalog.lastProbe).toBe('unreachable');
	});

	it('serves the previous cache when a refresh fails against the same endpoint', async () => {
		const { catalog, load } = buildCatalog();
		load.mockResolvedValue([model('a')]);
		await catalog.get();

		// Don't poison the cache with an empty array — the list must survive a
		// server that went away so it comes back without a manual "Refresh".
		load.mockRejectedValue(new Error('ECONNREFUSED'));
		expect(await catalog.get(true)).toEqual([model('a')]);
		expect(catalog.lastProbe).toBe('unreachable');
	});

	it('returns an empty list — not the previous cache — when a fetch fails after the endpoint changed', async () => {
		const { catalog, load, setEndpoint } = buildCatalog();
		load.mockResolvedValue([model('a')]);
		await catalog.get();

		// Serving endpoint A's models for endpoint B would let the dropdown offer
		// entries that don't exist there and let the user save invalid selections.
		setEndpoint('http://b');
		load.mockRejectedValue(new Error('ECONNREFUSED'));
		expect(await catalog.get()).toEqual([]);
	});

	it('keeps serving the last good list after a failure, then recovers on the next success', async () => {
		const { catalog, load } = buildCatalog();
		load.mockResolvedValue([model('a')]);
		await catalog.get();

		load.mockRejectedValue(new Error('down'));
		await catalog.get(true);
		expect(catalog.lastProbe).toBe('unreachable');

		load.mockResolvedValue([model('c')]);
		expect(await catalog.get(true)).toEqual([model('c')]);
		expect(catalog.lastProbe).toBe('reachable');
	});

	it('does not cache a failed fetch as the current identity, so the next call retries', async () => {
		const { catalog, load, setEndpoint } = buildCatalog();
		setEndpoint('http://b');
		load.mockRejectedValue(new Error('down'));

		await catalog.get();
		await catalog.get();
		expect(load).toHaveBeenCalledTimes(2);
	});

	describe('beforeFetch', () => {
		it('reports a first fetch as an identity change', async () => {
			const { catalog, load, beforeFetch } = buildCatalog({ withBeforeFetch: true });
			load.mockResolvedValue([]);

			await catalog.get();
			expect(beforeFetch).toHaveBeenCalledWith({ forceRefresh: false, identityChanged: true });
		});

		it('reports forceRefresh without an identity change on a warm cache', async () => {
			const { catalog, load, beforeFetch } = buildCatalog({ withBeforeFetch: true });
			load.mockResolvedValue([model('a')]);
			await catalog.get();
			beforeFetch.mockClear();

			await catalog.get(true);
			expect(beforeFetch).toHaveBeenCalledWith({ forceRefresh: true, identityChanged: false });
		});

		it('reports an identity change when the endpoint switches', async () => {
			const { catalog, load, beforeFetch, setEndpoint } = buildCatalog({ withBeforeFetch: true });
			load.mockResolvedValue([model('a')]);
			await catalog.get();
			beforeFetch.mockClear();
			setEndpoint('http://b');

			await catalog.get();
			expect(beforeFetch).toHaveBeenCalledWith({ forceRefresh: false, identityChanged: true });
		});

		it('is not called on a cache hit', async () => {
			const { catalog, load, beforeFetch } = buildCatalog({ withBeforeFetch: true });
			load.mockResolvedValue([model('a')]);
			await catalog.get();
			beforeFetch.mockClear();

			await catalog.get();
			expect(beforeFetch).not.toHaveBeenCalled();
		});
	});

	describe('a reset landing mid-load', () => {
		/** A load the test resolves or rejects by hand, so reset() can land mid-flight. */
		function deferred<T>() {
			let settle!: (value: T) => void;
			let fail!: (error: unknown) => void;
			const promise = new Promise<T>((resolve, reject) => {
				settle = resolve;
				fail = reject;
			});
			return { promise, settle, fail };
		}

		it('hands the result to its caller but does not re-seed the cleared cache', async () => {
			const { catalog, load } = buildCatalog();
			const gate = deferred<GeminiModel[]>();
			load.mockReturnValue(gate.promise);

			const inFlight = catalog.get();
			catalog.reset();
			gate.settle([model('a')]);

			// The caller asked for this list, so it still gets it...
			expect(await inFlight).toEqual([model('a')]);
			// ...but the state reset() cleared stays cleared.
			expect(catalog.lastProbe).toBeNull();
			load.mockResolvedValue([model('b')]);
			expect(await catalog.get()).toEqual([model('b')]);
			expect(load).toHaveBeenCalledTimes(2);
		});

		it('does not report a probe outcome when the stale load fails', async () => {
			const { catalog, load } = buildCatalog();
			load.mockResolvedValue([model('a')]);
			await catalog.get();

			const gate = deferred<GeminiModel[]>();
			load.mockReturnValue(gate.promise);
			const inFlight = catalog.get(true);
			catalog.reset();
			gate.fail(new Error('down'));

			// Nothing valid is left to serve: reset() dropped the cache this would
			// otherwise have fallen back to.
			expect(await inFlight).toEqual([]);
			expect(catalog.lastProbe).toBeNull();
		});
	});

	describe('reset', () => {
		it('drops the cached list so the next call refetches', async () => {
			const { catalog, load } = buildCatalog();
			load.mockResolvedValue([model('a')]);
			await catalog.get();

			catalog.reset();
			await catalog.get();
			expect(load).toHaveBeenCalledTimes(2);
		});

		it('clears the probe outcome back to "not checked yet"', async () => {
			const { catalog, load } = buildCatalog();
			load.mockResolvedValue([model('a')]);
			await catalog.get();
			expect(catalog.lastProbe).toBe('reachable');

			catalog.reset();
			expect(catalog.lastProbe).toBeNull();
		});

		it('clears the cached identity, so a failure right after reset serves nothing', async () => {
			const { catalog, load } = buildCatalog();
			load.mockResolvedValue([model('a')]);
			await catalog.get();

			catalog.reset();
			load.mockRejectedValue(new Error('down'));
			expect(await catalog.get()).toEqual([]);
		});
	});
});
