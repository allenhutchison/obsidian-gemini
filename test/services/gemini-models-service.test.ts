import type { Mock } from 'vitest';
import { requestUrl } from 'obsidian';
import { GeminiModelsService } from '../../src/services/gemini-models-service';
import { DEFAULT_GEMINI_MODELS } from '../../src/models';

const mockedRequestUrl = requestUrl as unknown as Mock;

const buildPlugin = (apiKey = 'gemini-key', settings: Record<string, unknown> = {}) =>
	({
		logger: { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
		settings: { ...settings },
		apiKey,
		saveData: vi.fn(async () => {}),
	}) as any;

const listResponse = (ids: string[], nextPageToken?: string) => ({
	status: 200,
	json: {
		models: ids.map((id) => ({ name: `models/${id}`, supportedGenerationMethods: ['generateContent'] })),
		...(nextPageToken && { nextPageToken }),
	},
});

describe('GeminiModelsService', () => {
	beforeEach(() => {
		mockedRequestUrl.mockReset();
	});

	it('discovers models from ListModels with the API key', async () => {
		mockedRequestUrl.mockResolvedValue(listResponse(['gemini-flash-latest', 'gemini-3.8-flash', 'text-embedding-004']));
		const svc = new GeminiModelsService(buildPlugin());

		const models = await svc.getModels();

		expect(models.map((m) => m.value)).toEqual(['gemini-flash-latest', 'gemini-3.8-flash']);
		expect(svc.lastProbe).toBe('reachable');
		expect(mockedRequestUrl.mock.calls[0][0]).toMatchObject({
			url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
			headers: { 'x-goog-api-key': 'gemini-key' },
			throw: false,
		});
	});

	it('follows page tokens', async () => {
		mockedRequestUrl
			.mockResolvedValueOnce(listResponse(['gemini-flash-latest'], 'page-2'))
			.mockResolvedValueOnce(listResponse(['gemini-3.8-flash']));
		const models = await new GeminiModelsService(buildPlugin()).getModels();

		expect(models.map((m) => m.value)).toEqual(['gemini-flash-latest', 'gemini-3.8-flash']);
		expect(mockedRequestUrl.mock.calls[1][0].url).toContain('pageToken=page-2');
	});

	it('honours the custom base URL', async () => {
		mockedRequestUrl.mockResolvedValue(listResponse(['gemini-flash-latest']));
		await new GeminiModelsService(buildPlugin('k', { customBaseUrl: 'https://proxy.example/' })).getModels();

		expect(mockedRequestUrl.mock.calls[0][0].url).toBe('https://proxy.example/v1beta/models?pageSize=1000');
	});

	it('persists a changed list, and skips the write when it is unchanged', async () => {
		mockedRequestUrl.mockResolvedValue(listResponse(['gemini-flash-latest']));
		const plugin = buildPlugin();
		const svc = new GeminiModelsService(plugin);

		await svc.getModels();
		expect(plugin.settings.remoteModelCache.models.map((m: { value: string }) => m.value)).toEqual([
			'gemini-flash-latest',
		]);
		expect(plugin.saveData).toHaveBeenCalledTimes(1);

		await svc.getModels(true);
		expect(plugin.saveData).toHaveBeenCalledTimes(1);
	});

	it('serves the built-in list without a key, and makes no request', async () => {
		const svc = new GeminiModelsService(buildPlugin(''));

		expect(await svc.getModels()).toEqual(DEFAULT_GEMINI_MODELS);
		expect(mockedRequestUrl).not.toHaveBeenCalled();
		expect(svc.lastProbe).toBeNull();
	});

	it('serves the last persisted list when ListModels fails', async () => {
		mockedRequestUrl.mockResolvedValue({ status: 500, json: {} });
		const cached = [{ value: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' }];
		const svc = new GeminiModelsService(buildPlugin('k', { remoteModelCache: { models: cached, timestamp: 1 } }));

		expect(await svc.getModels()).toEqual(cached);
		expect(svc.lastProbe).toBe('unreachable');
	});

	it('serves the built-in list when ListModels fails and nothing was persisted', async () => {
		mockedRequestUrl.mockRejectedValue(new Error('ECONNREFUSED'));
		const svc = new GeminiModelsService(buildPlugin());

		expect(await svc.getModels()).toEqual(DEFAULT_GEMINI_MODELS);
		expect(svc.lastProbe).toBe('unreachable');
	});

	it('treats a list with no usable models as a failure', async () => {
		mockedRequestUrl.mockResolvedValue(listResponse(['text-embedding-004']));
		const svc = new GeminiModelsService(buildPlugin());

		expect(await svc.getModels()).toEqual(DEFAULT_GEMINI_MODELS);
		expect(svc.lastProbe).toBe('unreachable');
	});

	it('does not fetch while offline', async () => {
		const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
		try {
			const svc = new GeminiModelsService(buildPlugin());
			expect(await svc.getModels()).toEqual(DEFAULT_GEMINI_MODELS);
			expect(mockedRequestUrl).not.toHaveBeenCalled();
		} finally {
			spy.mockRestore();
		}
	});
});
