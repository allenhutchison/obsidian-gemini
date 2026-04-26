import type { Mock } from 'vitest';
import { requestUrl } from 'obsidian';
import { OllamaModelsService } from '../../src/services/ollama-models-service';

const mockedRequestUrl = requestUrl as unknown as Mock;

const buildPlugin = () =>
	({
		logger: { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
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

	it('does not return stale models from a previous base URL after a failed refresh', async () => {
		const plugin = buildPlugin();

		// First daemon: warm the cache with two models
		mockedRequestUrl.mockResolvedValueOnce({
			status: 200,
			json: { models: [{ name: 'old-only-model' }, { name: 'shared-model' }] },
		});
		const svc = new OllamaModelsService(plugin);
		const initial = await svc.getModels();
		expect(initial).toHaveLength(2);

		// Switch to a new daemon that refuses the connection
		plugin.settings.ollamaBaseUrl = 'http://10.0.0.1:11434';
		mockedRequestUrl.mockRejectedValueOnce(new Error('ECONNREFUSED'));
		const afterFailure = await svc.getModels();

		// Must not surface the previous daemon's models as choices for the new one
		expect(afterFailure).toEqual([]);
	});
});
