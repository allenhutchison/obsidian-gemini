import { requestUrl } from 'obsidian';
import { OllamaModelsService } from '../../src/services/ollama-models-service';

const mockedRequestUrl = requestUrl as unknown as jest.Mock;

const buildPlugin = () =>
	({
		logger: { log: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
		settings: { ollamaBaseUrl: 'http://localhost:11434' },
	}) as any;

describe('OllamaModelsService', () => {
	beforeEach(() => {
		mockedRequestUrl.mockReset();
	});

	it('parses /api/tags response into GeminiModel entries', async () => {
		mockedRequestUrl.mockResolvedValue({
			status: 200,
			json: {
				models: [
					{ name: 'llama3.2:3b', details: { parameter_size: '3.2B' } },
					{ name: 'qwen2.5:7b', details: { parameter_size: '7B' } },
					{ name: 'llava:13b', details: { parameter_size: '13B' } },
				],
			},
		});

		const svc = new OllamaModelsService(buildPlugin());
		const models = await svc.getModels();

		expect(models).toHaveLength(3);
		expect(models[0]).toMatchObject({
			value: 'llama3.2:3b',
			label: 'llama3.2:3b (3.2B)',
			provider: 'ollama',
			supportsTools: true,
			defaultForRoles: ['completions'], // 3b matches the small-model heuristic
		});
		// Vision detection
		expect(models[2].supportsVision).toBe(true);
		// Non-vision
		expect(models[1].supportsVision).toBe(false);
	});

	it('returns empty list when the daemon responds with an error status', async () => {
		mockedRequestUrl.mockResolvedValue({ status: 500, json: null });
		const svc = new OllamaModelsService(buildPlugin());
		const models = await svc.getModels();
		expect(models).toEqual([]);
	});

	it('caches results and only re-fetches after invalidate()', async () => {
		mockedRequestUrl.mockResolvedValue({
			status: 200,
			json: { models: [{ name: 'llama3.2' }] },
		});

		const svc = new OllamaModelsService(buildPlugin());
		await svc.getModels();
		await svc.getModels();
		expect(mockedRequestUrl).toHaveBeenCalledTimes(1);

		svc.invalidate();
		await svc.getModels();
		expect(mockedRequestUrl).toHaveBeenCalledTimes(2);
	});

	it('invalidates the cache when the base URL changes', async () => {
		const plugin = buildPlugin();
		mockedRequestUrl.mockResolvedValue({ status: 200, json: { models: [] } });

		const svc = new OllamaModelsService(plugin);
		await svc.getModels();
		expect(mockedRequestUrl).toHaveBeenCalledTimes(1);

		plugin.settings.ollamaBaseUrl = 'http://10.0.0.1:11434';
		await svc.getModels();
		expect(mockedRequestUrl).toHaveBeenCalledTimes(2);
	});
});
