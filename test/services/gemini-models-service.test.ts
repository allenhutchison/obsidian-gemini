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

	it('does not let a fetch started before invalidate() overwrite a newer persisted list', async () => {
		let releaseOld!: (value: unknown) => void;
		mockedRequestUrl
			.mockImplementationOnce(() => new Promise((resolve) => (releaseOld = resolve)))
			.mockResolvedValueOnce(listResponse(['gemini-new-flash']));
		const plugin = buildPlugin();
		const svc = new GeminiModelsService(plugin);

		const stale = svc.getModels();
		svc.invalidate();
		await svc.getModels();
		releaseOld(listResponse(['gemini-old-flash']));
		await stale;

		expect(plugin.settings.remoteModelCache.models.map((m: { value: string }) => m.value)).toEqual([
			'gemini-new-flash',
		]);
	});

	it('serves the built-in list without a key, and makes no request', async () => {
		const svc = new GeminiModelsService(buildPlugin(''));

		expect(await svc.getModels()).toEqual(DEFAULT_GEMINI_MODELS);
		expect(mockedRequestUrl).not.toHaveBeenCalled();
		expect(svc.lastProbe).toBeNull();
	});

	it('serves the last persisted list for the same key when ListModels fails', async () => {
		const plugin = buildPlugin('k');
		mockedRequestUrl.mockResolvedValueOnce(listResponse(['gemini-3.8-flash']));
		await new GeminiModelsService(plugin).getModels();

		mockedRequestUrl.mockResolvedValue({ status: 500, json: {} });
		const svc = new GeminiModelsService(plugin);
		expect((await svc.getModels()).map((m) => m.value)).toEqual(['gemini-3.8-flash']);
		expect(svc.lastProbe).toBe('unreachable');
	});

	it('does not serve a list persisted for another key or base URL', async () => {
		const plugin = buildPlugin('key-a');
		mockedRequestUrl.mockResolvedValueOnce(listResponse(['gemini-3.8-flash']));
		await new GeminiModelsService(plugin).getModels();
		expect(plugin.settings.remoteModelCache.endpoint).not.toContain('key-a');

		mockedRequestUrl.mockResolvedValue({ status: 500, json: {} });
		plugin.apiKey = 'key-b';
		expect(await new GeminiModelsService(plugin).getModels()).toEqual(DEFAULT_GEMINI_MODELS);

		plugin.apiKey = 'key-a';
		plugin.settings.customBaseUrl = 'https://proxy.example';
		expect(await new GeminiModelsService(plugin).getModels()).toEqual(DEFAULT_GEMINI_MODELS);
	});

	it('uses a list persisted without an endpoint only while no key is set', async () => {
		const cached = [{ value: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' }];
		mockedRequestUrl.mockResolvedValue({ status: 500, json: {} });

		const keyless = new GeminiModelsService(buildPlugin('', { remoteModelCache: { models: cached, timestamp: 1 } }));
		expect(await keyless.getModels()).toEqual(cached);

		const keyed = new GeminiModelsService(buildPlugin('k', { remoteModelCache: { models: cached, timestamp: 1 } }));
		expect(await keyed.getModels()).toEqual(DEFAULT_GEMINI_MODELS);
	});

	it('treats a repeated page token as a failure', async () => {
		mockedRequestUrl.mockResolvedValue(listResponse(['gemini-3.8-flash'], 'same-token'));
		const svc = new GeminiModelsService(buildPlugin());

		expect(await svc.getModels()).toEqual(DEFAULT_GEMINI_MODELS);
		expect(svc.lastProbe).toBe('unreachable');
	});

	it('treats a list that never stops paging as a failure', async () => {
		let page = 0;
		mockedRequestUrl.mockImplementation(async () => listResponse(['gemini-3.8-flash'], `token-${page++}`));
		const plugin = buildPlugin();
		const svc = new GeminiModelsService(plugin);

		expect(await svc.getModels()).toEqual(DEFAULT_GEMINI_MODELS);
		expect(svc.lastProbe).toBe('unreachable');
		expect(plugin.saveData).not.toHaveBeenCalled();
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
