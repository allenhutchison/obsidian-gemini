import type { Mock } from 'vitest';
import { requestUrl } from 'obsidian';
import { OpenAIModelsService } from '../../src/services/openai-models-service';

const mockedRequestUrl = requestUrl as unknown as Mock;

const buildPlugin = (overrides?: Record<string, any>) =>
	({
		logger: { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
		settings: { openaiBaseUrl: 'https://api.openai.com/v1' },
		openaiApiKey: 'sk-test-key',
		...overrides,
	}) as any;

function mockModelList(ids: string[]) {
	mockedRequestUrl.mockResolvedValue({ status: 200, json: { data: ids.map((id) => ({ id })) } });
}

describe('OpenAIModelsService', () => {
	beforeEach(() => {
		mockedRequestUrl.mockReset();
	});

	it('parses /models response into GeminiModel entries with curated metadata', async () => {
		mockModelList(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']);

		const svc = new OpenAIModelsService(buildPlugin());
		const models = await svc.getModels();

		expect(models).toHaveLength(3);
		expect(models[0]).toMatchObject({
			value: 'gpt-5.6-sol',
			provider: 'openai',
			supportsTools: true,
			supportsVision: true,
			contextWindow: 922_000,
			defaultForRoles: ['chat'],
		});
		expect(models[1]).toMatchObject({ value: 'gpt-5.6-terra', defaultForRoles: ['summary'] });
		expect(models[2]).toMatchObject({ value: 'gpt-5.6-luna', defaultForRoles: ['completions'] });
	});

	it('applies conservative defaults to a model id with no curated metadata', async () => {
		mockModelList(['some-custom-local-model']);
		// Unknown ids only survive the filter on a non-hosted (compatible) endpoint.
		const svc = new OpenAIModelsService(buildPlugin({ settings: { openaiBaseUrl: 'http://localhost:1234/v1' } }));
		const models = await svc.getModels();

		expect(models).toEqual([
			expect.objectContaining({
				value: 'some-custom-local-model',
				provider: 'openai',
				supportsTools: true,
				supportsVision: false,
				contextWindow: 128_000,
			}),
		]);
	});

	it('sends the resolved API key as a Bearer token', async () => {
		mockModelList(['gpt-5.6-sol']);
		const plugin = buildPlugin({ openaiApiKey: 'sk-secret' });

		await new OpenAIModelsService(plugin).getModels();

		expect(mockedRequestUrl).toHaveBeenCalledWith(
			expect.objectContaining({ headers: { Authorization: 'Bearer sk-secret' } })
		);
	});

	describe('model filtering', () => {
		it('keeps only the supported GPT-5.6 models on api.openai.com', async () => {
			mockModelList([
				'gpt-5.6-sol',
				'gpt-5.6-terra',
				'gpt-5.6-luna',
				'gpt-5.1',
				'gpt-4o',
				'text-embedding-3-large',
				'whisper-1',
				'dall-e-3',
			]);

			const svc = new OpenAIModelsService(buildPlugin());
			const models = await svc.getModels();

			expect(models.map((m) => m.value)).toEqual(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']);
		});

		it('does not filter model ids on a custom (non-api.openai.com) base URL', async () => {
			mockModelList(['local-embedding-model', 'my-custom-chat-model']);
			const plugin = buildPlugin({ settings: { openaiBaseUrl: 'http://localhost:1234/v1' } });

			const svc = new OpenAIModelsService(plugin);
			const models = await svc.getModels();

			expect(models.map((m) => m.value).sort()).toEqual(['local-embedding-model', 'my-custom-chat-model']);
		});
	});

	it('returns empty list when the endpoint responds with an error status', async () => {
		mockedRequestUrl.mockResolvedValue({ status: 401, json: null });
		const svc = new OpenAIModelsService(buildPlugin());
		const models = await svc.getModels();
		expect(models).toEqual([]);
	});

	it('caches results and only re-fetches after invalidate()', async () => {
		mockModelList(['gpt-5.6-sol']);

		const svc = new OpenAIModelsService(buildPlugin());
		await svc.getModels();
		await svc.getModels();
		expect(mockedRequestUrl).toHaveBeenCalledTimes(1);

		svc.invalidate();
		await svc.getModels();
		expect(mockedRequestUrl).toHaveBeenCalledTimes(2);
	});

	it('invalidates the cache when the base URL changes', async () => {
		const plugin = buildPlugin();
		mockModelList([]);

		const svc = new OpenAIModelsService(plugin);
		await svc.getModels();
		expect(mockedRequestUrl).toHaveBeenCalledTimes(1);

		plugin.settings.openaiBaseUrl = 'http://localhost:1234/v1';
		await svc.getModels();
		expect(mockedRequestUrl).toHaveBeenCalledTimes(2);
	});

	it('invalidates the cache when the API key changes', async () => {
		const plugin = buildPlugin({ openaiApiKey: 'sk-first' });
		mockModelList([]);

		const svc = new OpenAIModelsService(plugin);
		await svc.getModels();
		expect(mockedRequestUrl).toHaveBeenCalledTimes(1);

		plugin.openaiApiKey = 'sk-second';
		await svc.getModels();
		expect(mockedRequestUrl).toHaveBeenCalledTimes(2);
	});

	it('does not return stale models from a previous base URL after a failed refresh', async () => {
		const plugin = buildPlugin({ settings: { openaiBaseUrl: 'http://first-server:1234/v1' } });

		mockModelList(['old-only-model', 'shared-model']);
		const svc = new OpenAIModelsService(plugin);
		const initial = await svc.getModels();
		expect(initial).toHaveLength(2);

		plugin.settings.openaiBaseUrl = 'http://localhost:1234/v1';
		mockedRequestUrl.mockRejectedValueOnce(new Error('ECONNREFUSED'));
		const afterFailure = await svc.getModels();

		expect(afterFailure).toEqual([]);
	});
});
