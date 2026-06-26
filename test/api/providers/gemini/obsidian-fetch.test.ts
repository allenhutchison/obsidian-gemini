import { describe, test, expect, vi, beforeEach } from 'vitest';

// Control Obsidian's requestUrl precisely for these tests.
const { requestUrlMock } = vi.hoisted(() => ({ requestUrlMock: vi.fn() }));
vi.mock('obsidian', () => ({ requestUrl: requestUrlMock }));

import { obsidianFetch, installObsidianFetch } from '../../../../src/api/providers/gemini/obsidian-fetch';

describe('obsidianFetch', () => {
	beforeEach(() => {
		requestUrlMock.mockReset();
		requestUrlMock.mockResolvedValue({
			status: 200,
			headers: { 'content-type': 'application/json' },
			arrayBuffer: new TextEncoder().encode(JSON.stringify({ ok: true })).buffer,
		});
	});

	test('proxies a POST through requestUrl and returns a real Response', async () => {
		const res = await obsidianFetch('https://example.com/v1beta/interactions', {
			method: 'post',
			headers: { 'x-goog-api-key': 'k', 'content-type': 'application/json' },
			body: JSON.stringify({ model: 'gemini-3.5-flash' }),
		});

		expect(requestUrlMock).toHaveBeenCalledTimes(1);
		const param = requestUrlMock.mock.calls[0][0];
		expect(param.url).toBe('https://example.com/v1beta/interactions');
		expect(param.method).toBe('POST'); // upper-cased
		expect(param.headers['x-goog-api-key']).toBe('k');
		expect(param.body).toBe(JSON.stringify({ model: 'gemini-3.5-flash' }));
		expect(param.throw).toBe(false); // let the SDK map HTTP errors itself

		expect(res).toBeInstanceOf(Response);
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ ok: true });
	});

	test('normalizes a Headers instance into a plain record', async () => {
		const headers = new Headers();
		headers.set('authorization', 'Bearer t');
		await obsidianFetch(new URL('https://example.com/x'), { headers });

		const param = requestUrlMock.mock.calls[0][0];
		expect(param.headers.authorization).toBe('Bearer t');
		expect(param.url).toBe('https://example.com/x');
	});

	test('non-2xx responses are returned (not thrown) for the SDK to handle', async () => {
		requestUrlMock.mockResolvedValue({
			status: 429,
			headers: {},
			arrayBuffer: new TextEncoder().encode('rate limited').buffer,
		});
		const res = await obsidianFetch('https://example.com/x', { method: 'GET' });
		expect(res.status).toBe(429);
		expect(res.ok).toBe(false);
	});
});

describe('installObsidianFetch', () => {
	test('patches the Next-Gen client fetch and is idempotent', () => {
		const client: { fetch?: unknown; __obsidianFetch?: boolean } = { fetch: window.fetch };
		const ai = { getNextGenClient: () => client };

		expect(installObsidianFetch(ai)).toBe(true);
		expect(client.fetch).toBe(obsidianFetch);
		expect(client.__obsidianFetch).toBe(true);

		// Second call is a no-op that still reports success.
		const prev = client.fetch;
		expect(installObsidianFetch(ai)).toBe(true);
		expect(client.fetch).toBe(prev);
	});

	test('returns false when the SDK lacks getNextGenClient', () => {
		expect(installObsidianFetch({})).toBe(false);
		expect(installObsidianFetch(null)).toBe(false);
	});

	test('returns false (no throw) when getNextGenClient throws', () => {
		const ai = {
			getNextGenClient: () => {
				throw new Error('internal');
			},
		};
		expect(installObsidianFetch(ai)).toBe(false);
	});
});
