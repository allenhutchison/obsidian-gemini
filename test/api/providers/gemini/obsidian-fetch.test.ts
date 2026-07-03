import { describe, test, expect, vi, beforeEach } from 'vitest';

// Control Obsidian's requestUrl precisely for these tests.
const { requestUrlMock } = vi.hoisted(() => ({ requestUrlMock: vi.fn() }));
vi.mock('obsidian', () => ({ requestUrl: requestUrlMock }));

import { obsidianFetcher, installObsidianFetch } from '../../../../src/api/providers/gemini/obsidian-fetch';

/**
 * Build a minimal `fetcher`-shaped request. The Next-Gen `HTTPClient` calls its
 * fetcher with a WHATWG `Request`; we only touch `url`, `method`, `headers`, and
 * `arrayBuffer()`, so a duck-typed object keeps the test independent of the
 * jsdom `Request` body implementation.
 */
function fakeRequest(url: string, method: string, headers: Record<string, string>, body?: string): Request {
	const buffer = body !== undefined ? new TextEncoder().encode(body).buffer : new ArrayBuffer(0);
	return {
		url,
		method,
		headers: new Headers(headers),
		arrayBuffer: async () => buffer,
	} as unknown as Request;
}

describe('obsidianFetcher', () => {
	beforeEach(() => {
		requestUrlMock.mockReset();
		requestUrlMock.mockResolvedValue({
			status: 200,
			headers: { 'content-type': 'application/json' },
			arrayBuffer: new TextEncoder().encode(JSON.stringify({ ok: true })).buffer,
		});
	});

	test('proxies a POST Request through requestUrl and returns a real Response', async () => {
		const body = JSON.stringify({ model: 'gemini-3.5-flash' });
		const res = await obsidianFetcher(
			fakeRequest('https://example.com/v1beta/interactions', 'POST', { 'x-goog-api-key': 'k' }, body)
		);

		expect(requestUrlMock).toHaveBeenCalledTimes(1);
		const param = requestUrlMock.mock.calls[0][0];
		expect(param.url).toBe('https://example.com/v1beta/interactions');
		expect(param.method).toBe('POST');
		expect(param.headers['x-goog-api-key']).toBe('k');
		expect(new TextDecoder().decode(param.body)).toBe(body);
		expect(param.throw).toBe(false); // let the SDK map HTTP errors itself

		expect(res).toBeInstanceOf(Response);
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ ok: true });
	});

	test('omits the body for GET requests (does not read arrayBuffer)', async () => {
		const arrayBuffer = vi.fn();
		const req = {
			url: 'https://example.com/x',
			method: 'GET',
			headers: new Headers({ authorization: 'Bearer t' }),
			arrayBuffer,
		} as unknown as Request;

		await obsidianFetcher(req);

		const param = requestUrlMock.mock.calls[0][0];
		expect(param.headers.authorization).toBe('Bearer t');
		expect(param.body).toBeUndefined();
		expect(arrayBuffer).not.toHaveBeenCalled();
	});

	test('non-2xx responses are returned (not thrown) for the SDK to handle', async () => {
		requestUrlMock.mockResolvedValue({
			status: 429,
			headers: {},
			arrayBuffer: new TextEncoder().encode('rate limited').buffer,
		});
		const res = await obsidianFetcher(fakeRequest('https://example.com/x', 'GET', {}));
		expect(res.status).toBe(429);
		expect(res.ok).toBe(false);
	});
});

describe('installObsidianFetch', () => {
	function makeAi(initialFetcher: unknown) {
		// Each getClient call rebuilds a sub-client, mirroring the real SDK where
		// `interactions.getClient(api_version)` returns a fresh client per call.
		const built: Array<{ _httpClient: { fetcher: unknown } }> = [];
		const getClient = vi.fn(() => {
			const subClient = { _httpClient: { fetcher: initialFetcher } };
			built.push(subClient);
			return subClient;
		});
		return { ai: { interactions: { getClient } }, getClient, built };
	}

	test('wraps getClient so each sub-client uses obsidianFetcher; idempotent', () => {
		const original = () => Promise.resolve(new Response());
		const { ai, built } = makeAi(original);

		expect(installObsidianFetch(ai)).toBe(true);

		// The fetcher is swapped when getClient runs (per-call rebuild).
		const sub1 = ai.interactions.getClient();
		expect(sub1._httpClient.fetcher).toBe(obsidianFetcher);

		const sub2 = ai.interactions.getClient();
		expect(sub2._httpClient.fetcher).toBe(obsidianFetcher);
		expect(built).toHaveLength(2); // genuinely rebuilt each call

		// Second install is a no-op that still reports success and keeps wrapping.
		expect(installObsidianFetch(ai)).toBe(true);
		const sub3 = ai.interactions.getClient();
		expect(sub3._httpClient.fetcher).toBe(obsidianFetcher);
	});

	test('returns false when the SDK lacks an interactions.getClient', () => {
		expect(installObsidianFetch({})).toBe(false);
		expect(installObsidianFetch(null)).toBe(false);
		expect(installObsidianFetch({ interactions: {} })).toBe(false);
	});

	test('returns false (no throw) when the interactions getter throws', () => {
		const ai = {
			get interactions(): unknown {
				throw new Error('internal');
			},
		};
		expect(installObsidianFetch(ai)).toBe(false);
	});

	test('leaves the default fetcher in place if a sub-client lacks _httpClient', () => {
		const getClient = vi.fn(() => ({}));
		const ai = { interactions: { getClient } };
		expect(installObsidianFetch(ai)).toBe(true);
		// Should not throw when the expected internal shape is missing.
		expect(() => ai.interactions.getClient()).not.toThrow();
	});
});
