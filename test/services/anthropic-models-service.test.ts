import type { Mock } from 'vitest';
import { requestUrl } from 'obsidian';
import { AnthropicModelsService } from '../../src/services/anthropic-models-service';

const mockedRequestUrl = requestUrl as unknown as Mock;

const buildPlugin = (apiKey = 'sk-ant-test') =>
	({
		logger: { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
		settings: {},
		anthropicApiKey: apiKey,
	}) as any;

const CATALOG = ['claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5', 'claude-opus-4-8', 'claude-haiku-4-5'];

describe('AnthropicModelsService', () => {
	beforeEach(() => {
		mockedRequestUrl.mockReset();
	});

	it('narrows the curated list to what /v1/models offers, taking its names and context windows', async () => {
		mockedRequestUrl.mockResolvedValue({
			status: 200,
			json: {
				data: [
					{ id: 'claude-opus-5', display_name: 'Claude Opus 5', max_input_tokens: 1_000_000 },
					{ id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5', max_input_tokens: 200_000 },
					{ id: 'claude-3-haiku-20240307', display_name: 'Claude Haiku 3' },
				],
			},
		});

		const svc = new AnthropicModelsService(buildPlugin());
		const models = await svc.getModels();

		expect(models).toEqual([
			{
				value: 'claude-opus-5',
				label: 'Claude Opus 5',
				provider: 'anthropic',
				supportsVision: true,
				contextWindow: 1_000_000,
				defaultForRoles: ['chat', 'rewrite'],
			},
			{
				value: 'claude-haiku-4-5',
				label: 'Claude Haiku 4.5',
				provider: 'anthropic',
				supportsVision: true,
				contextWindow: 200_000,
				defaultForRoles: ['completions'],
			},
		]);
		expect(svc.lastProbe).toBe('reachable');
		expect(mockedRequestUrl.mock.calls[0][0]).toMatchObject({
			url: 'https://api.anthropic.com/v1/models?limit=1000',
			headers: { 'x-api-key': 'sk-ant-test', 'anthropic-version': '2023-06-01' },
			throw: false,
		});
	});

	it('matches an alias to its dated snapshot id, and only to a dated one', async () => {
		// Shape returned by the live endpoint: Haiku 4.5 is listed only by snapshot.
		mockedRequestUrl.mockResolvedValue({
			status: 200,
			json: {
				data: [
					{ id: 'claude-fable-5-1' },
					{ id: 'claude-opus-5' },
					{ id: 'claude-sonnet-5' },
					{ id: 'claude-opus-4-8' },
					{ id: 'claude-haiku-4-5-20251001', display_name: 'Claude Haiku 4.5' },
					{ id: 'claude-opus-5-preview' },
				],
			},
		});
		const models = await new AnthropicModelsService(buildPlugin()).getModels();

		expect(models.map((m) => m.value)).toEqual(CATALOG);
		expect(models.find((m) => m.value === 'claude-haiku-4-5')).toMatchObject({
			label: 'Claude Haiku 4.5',
			defaultForRoles: ['completions'],
		});
	});

	it('does not treat a non-date suffix as a snapshot of the alias', async () => {
		mockedRequestUrl.mockResolvedValue({ status: 200, json: { data: [{ id: 'claude-opus-5-preview' }] } });
		expect(await new AnthropicModelsService(buildPlugin()).getModels()).toEqual([]);
	});

	it('serves the curated list without a request when no key is configured', async () => {
		const svc = new AnthropicModelsService(buildPlugin(''));
		const models = await svc.getModels();

		expect(mockedRequestUrl).not.toHaveBeenCalled();
		expect(models.map((m) => m.value)).toEqual(CATALOG);
		expect(svc.lastProbe).toBeNull();
	});

	it('falls back to the curated list and reports unreachable when the request fails', async () => {
		mockedRequestUrl.mockResolvedValue({ status: 401, json: {} });
		const svc = new AnthropicModelsService(buildPlugin());

		expect((await svc.getModels()).map((m) => m.value)).toEqual(CATALOG);
		expect(svc.lastProbe).toBe('unreachable');
	});

	it('caches per key and re-fetches when forced or after invalidate()', async () => {
		mockedRequestUrl.mockResolvedValue({ status: 200, json: { data: [{ id: 'claude-opus-5' }] } });
		const plugin = buildPlugin();
		const svc = new AnthropicModelsService(plugin);

		await svc.getModels();
		await svc.getModels();
		expect(mockedRequestUrl).toHaveBeenCalledTimes(1);

		plugin.anthropicApiKey = 'sk-ant-other';
		await svc.getModels();
		expect(mockedRequestUrl).toHaveBeenCalledTimes(2);

		await svc.getModels(true);
		expect(mockedRequestUrl).toHaveBeenCalledTimes(3);

		svc.invalidate();
		expect(svc.lastProbe).toBeNull();
		await svc.getModels();
		expect(mockedRequestUrl).toHaveBeenCalledTimes(4);
	});

	it('keeps serving the last good list for the same key when a refresh fails', async () => {
		mockedRequestUrl.mockResolvedValueOnce({ status: 200, json: { data: [{ id: 'claude-sonnet-5' }] } });
		const svc = new AnthropicModelsService(buildPlugin());
		await svc.getModels();

		mockedRequestUrl.mockRejectedValueOnce(new Error('offline'));
		expect((await svc.getModels(true)).map((m) => m.value)).toEqual(['claude-sonnet-5']);
	});
});
