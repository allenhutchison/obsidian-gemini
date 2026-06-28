import type { Mock } from 'vitest';
import { requestUrl } from 'obsidian';
import { OllamaModelsService } from '../../src/services/ollama-models-service';

const mockedRequestUrl = requestUrl as unknown as Mock;

const buildPlugin = () =>
	({
		logger: { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
		settings: { ollamaBaseUrl: 'http://localhost:11434' },
	}) as any;

/** Mock requestUrl so /api/tags and /api/show can return different payloads. */
function mockEndpoints(tagsModels: any[], showResponse: (name: string) => any) {
	mockedRequestUrl.mockImplementation((opts: { url: string; body?: string }) => {
		if (opts.url.endsWith('/api/show')) {
			const body = JSON.parse(opts.body ?? '{}');
			return Promise.resolve({ status: 200, json: showResponse(body.name) });
		}
		return Promise.resolve({ status: 200, json: { models: tagsModels } });
	});
}

describe('OllamaModelsService', () => {
	beforeEach(() => {
		mockedRequestUrl.mockReset();
	});

	it('parses /api/tags response into GeminiModel entries', async () => {
		mockEndpoints(
			[
				{ name: 'llama3.2:3b', details: { parameter_size: '3.2B' } },
				{ name: 'qwen2.5:7b', details: { parameter_size: '7B' } },
				{ name: 'llava:13b', details: { parameter_size: '13B' } },
			],
			// llava reports vision via capabilities; others do not
			(name) => (name === 'llava:13b' ? { capabilities: ['completion', 'vision'] } : { capabilities: ['completion'] })
		);

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
		mockEndpoints([{ name: 'llama3.2' }], () => ({ capabilities: ['completion'] }));

		const svc = new OllamaModelsService(buildPlugin());
		await svc.getModels();
		await svc.getModels();
		// 1 /api/tags + 1 /api/show for llama3.2 = 2 calls; second getModels() hits cache
		expect(mockedRequestUrl).toHaveBeenCalledTimes(2);

		svc.invalidate();
		await svc.getModels();
		// another 1 /api/tags + 1 /api/show = 4 total
		expect(mockedRequestUrl).toHaveBeenCalledTimes(4);
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
		mockEndpoints([{ name: 'old-only-model' }, { name: 'shared-model' }], () => ({ capabilities: [] }));
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

	describe('vision capability detection', () => {
		it('uses capabilities array as primary signal — vision present', async () => {
			mockEndpoints([{ name: 'mymodel:latest' }], () => ({ capabilities: ['completion', 'vision'] }));
			const svc = new OllamaModelsService(buildPlugin());
			const models = await svc.getModels();
			expect(models[0].supportsVision).toBe(true);
		});

		it('uses capabilities array as primary signal — no vision entry', async () => {
			mockEndpoints([{ name: 'mymodel:latest' }], () => ({ capabilities: ['completion', 'tools'] }));
			const svc = new OllamaModelsService(buildPlugin());
			const models = await svc.getModels();
			expect(models[0].supportsVision).toBe(false);
		});

		it('falls back to template regex when capabilities field is absent — keyword present', async () => {
			mockEndpoints([{ name: 'mymodel:latest' }], () => ({
				template: 'This model accepts image input for visual understanding',
			}));
			const svc = new OllamaModelsService(buildPlugin());
			const models = await svc.getModels();
			expect(models[0].supportsVision).toBe(true);
		});

		it('falls back to template regex when capabilities field is absent — no keyword', async () => {
			mockEndpoints([{ name: 'mymodel:latest' }], () => ({
				template: 'A language model for text generation only',
			}));
			const svc = new OllamaModelsService(buildPlugin());
			const models = await svc.getModels();
			expect(models[0].supportsVision).toBe(false);
		});

		it('falls back to VISION_NAME_HINTS when /api/show probe fails', async () => {
			mockedRequestUrl.mockImplementation((opts: { url: string }) => {
				if (opts.url.endsWith('/api/show')) {
					return Promise.reject(new Error('ECONNREFUSED'));
				}
				return Promise.resolve({
					status: 200,
					json: { models: [{ name: 'llava:13b' }, { name: 'llama3.2:latest' }] },
				});
			});
			const svc = new OllamaModelsService(buildPlugin());
			const models = await svc.getModels();
			expect(models[0].supportsVision).toBe(true); // llava → VISION_NAME_HINTS
			expect(models[1].supportsVision).toBe(false); // llama3.2 → not in hints
		});

		it('falls back to VISION_NAME_HINTS when /api/show returns non-200', async () => {
			mockedRequestUrl.mockImplementation((opts: { url: string }) => {
				if (opts.url.endsWith('/api/show')) {
					return Promise.resolve({ status: 404, json: {} });
				}
				return Promise.resolve({
					status: 200,
					json: { models: [{ name: 'moondream:latest' }, { name: 'llama3.2:latest' }] },
				});
			});
			const svc = new OllamaModelsService(buildPlugin());
			const models = await svc.getModels();
			expect(models[0].supportsVision).toBe(true); // moondream → VISION_NAME_HINTS
			expect(models[1].supportsVision).toBe(false);
		});

		it('caches /api/show responses — each model probed only once per listing cycle', async () => {
			let showCallCount = 0;
			mockedRequestUrl.mockImplementation((opts: { url: string; body?: string }) => {
				if (opts.url.endsWith('/api/show')) {
					showCallCount++;
					return Promise.resolve({ status: 200, json: { capabilities: ['completion'] } });
				}
				return Promise.resolve({ status: 200, json: { models: [{ name: 'mymodel:latest' }] } });
			});
			const svc = new OllamaModelsService(buildPlugin());
			await svc.getModels();
			await svc.getModels(); // cache hit — model list and show cache both warm
			expect(showCallCount).toBe(1);
		});

		it('clears the /api/show cache on invalidate so probes re-run after refresh', async () => {
			let showCallCount = 0;
			mockedRequestUrl.mockImplementation((opts: { url: string; body?: string }) => {
				if (opts.url.endsWith('/api/show')) {
					showCallCount++;
					return Promise.resolve({ status: 200, json: { capabilities: ['completion'] } });
				}
				return Promise.resolve({ status: 200, json: { models: [{ name: 'mymodel:latest' }] } });
			});
			const svc = new OllamaModelsService(buildPlugin());
			await svc.getModels();
			expect(showCallCount).toBe(1);
			svc.invalidate();
			await svc.getModels();
			expect(showCallCount).toBe(2); // fresh probe after invalidate
		});
	});
});
