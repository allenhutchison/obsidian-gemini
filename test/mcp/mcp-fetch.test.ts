import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { MCP_FETCH_TIMEOUT_MS } from '../../src/mcp/mcp-constants';

const { mockRequestUrl } = vi.hoisted(() => ({ mockRequestUrl: vi.fn() }));

vi.mock('obsidian', () => ({
	requestUrl: mockRequestUrl,
}));

// Import after the mock so obsidianFetch picks up the mocked requestUrl.
import { obsidianFetch } from '../../src/mcp/mcp-fetch';

describe('obsidianFetch', () => {
	beforeEach(() => {
		mockRequestUrl.mockReset();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	test('returns a Response when requestUrl resolves', async () => {
		mockRequestUrl.mockResolvedValueOnce({
			status: 200,
			text: 'ok',
			headers: { 'content-type': 'text/plain' },
		});

		const res = await obsidianFetch('https://example.com/');
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('ok');
	});

	test('rejects with TypeError carrying "timed out" message when requestUrl never settles', async () => {
		mockRequestUrl.mockImplementationOnce(() => new Promise(() => {}));

		const settled = obsidianFetch('https://example.com/');
		const typeAssertion = expect(settled).rejects.toBeInstanceOf(TypeError);
		await vi.advanceTimersByTimeAsync(MCP_FETCH_TIMEOUT_MS + 50);
		await typeAssertion;
		await expect(settled).rejects.toThrow(/timed out/);
	});

	test('passes through requestUrl rejections as TypeErrors', async () => {
		mockRequestUrl.mockRejectedValueOnce(new Error('ENOTFOUND example.com'));

		await expect(obsidianFetch('https://example.com/')).rejects.toThrow(TypeError);
	});

	test('short-circuits when the caller signal is already aborted', async () => {
		const controller = new AbortController();
		controller.abort();

		await expect(obsidianFetch('https://example.com/', { signal: controller.signal })).rejects.toThrow(TypeError);
		expect(mockRequestUrl).not.toHaveBeenCalled();
	});

	test('rejects when the caller signal aborts mid-flight', async () => {
		const controller = new AbortController();
		mockRequestUrl.mockImplementationOnce(() => new Promise(() => {}));

		const settled = obsidianFetch('https://example.com/', { signal: controller.signal });
		const assertion = expect(settled).rejects.toThrow(/aborted/);
		controller.abort();
		await assertion;
	});
});
