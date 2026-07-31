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
			return Promise.resolve({ status: 200, json: showResponse(body.model) });
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

		it('falls back to VISION_NAME_HINTS when /api/show returns 200 but neither capabilities nor template', async () => {
			mockEndpoints([{ name: 'llava:13b' }, { name: 'llama3.2:latest' }], () => ({}));
			const svc = new OllamaModelsService(buildPlugin());
			const models = await svc.getModels();
			expect(models[0].supportsVision).toBe(true); // llava → name hint wins
			expect(models[1].supportsVision).toBe(false); // llama3.2 → not in hints
		});

		it('capabilities array wins over a conflicting template keyword', async () => {
			mockEndpoints([{ name: 'mymodel:latest' }], () => ({
				capabilities: ['completion'],
				template: 'This model accepts image input for visual understanding',
			}));
			const svc = new OllamaModelsService(buildPlugin());
			const models = await svc.getModels();
			// capabilities (no vision entry) wins; template keyword is not consulted
			expect(models[0].supportsVision).toBe(false);
		});

		it('empty capabilities array is authoritative — does not fall through to name hints', async () => {
			mockEndpoints([{ name: 'llava:13b' }], () => ({ capabilities: [] }));
			const svc = new OllamaModelsService(buildPlugin());
			const models = await svc.getModels();
			// empty array short-circuits the name-hint tier
			expect(models[0].supportsVision).toBe(false);
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

	describe('completions-role name-hint boundaries (#1242)', () => {
		const roles = async (names: string[]): Promise<Record<string, string[] | undefined>> => {
			mockEndpoints(
				names.map((name) => ({ name })),
				() => ({ capabilities: ['completion'] })
			);
			const svc = new OllamaModelsService(buildPlugin());
			const models = await svc.getModels();
			return Object.fromEntries(models.map((m) => [m.value, m.defaultForRoles]));
		};

		it('biases genuine small models toward completions', async () => {
			const result = await roles(['qwen2.5:0.5b', 'qwen2.5:1.5b', 'gemma:1b', 'llama3.2:3b']);
			expect(result['qwen2.5:0.5b']).toEqual(['completions']);
			expect(result['qwen2.5:1.5b']).toEqual(['completions']);
			expect(result['gemma:1b']).toEqual(['completions']);
			expect(result['llama3.2:3b']).toEqual(['completions']);
		});

		it('does not bias larger models whose size digits merely contain a small-model substring', async () => {
			// The digit-aware boundaries must survive the lookbehind→consuming-group
			// rewrite: `13b`/`11b`/`23b` must not match `3b`/`1b`.
			const result = await roles(['llava:13b', 'model:11b', 'model:23b']);
			expect(result['llava:13b']).toBeUndefined();
			expect(result['model:11b']).toBeUndefined();
			expect(result['model:23b']).toBeUndefined();
		});
	});

	describe('context window', () => {
		it('reads the trained window from the architecture-prefixed model_info key', async () => {
			mockEndpoints([{ name: 'gpt-oss:120b-cloud' }, { name: 'gemma4:12b-mlx' }], (name) =>
				name === 'gpt-oss:120b-cloud'
					? { capabilities: ['completion'], model_info: { 'gptoss.context_length': 131_072 } }
					: { capabilities: ['completion'], model_info: { 'gemma3.context_length': 262_144 } }
			);

			const svc = new OllamaModelsService(buildPlugin());
			const models = await svc.getModels();

			// The key is architecture-prefixed, so it has to be matched by suffix.
			expect(models[0].contextWindow).toBe(131_072);
			expect(models[1].contextWindow).toBe(262_144);
		});

		it('omits the window when /api/show reports no usable value', async () => {
			mockEndpoints(
				[{ name: 'a' }, { name: 'b' }, { name: 'c' }],
				(name) =>
					({
						a: { capabilities: ['completion'] },
						b: { capabilities: ['completion'], model_info: { 'llama.embedding_length': 4096 } },
						c: { capabilities: ['completion'], model_info: { 'llama.context_length': 0 } },
					})[name]
			);

			const svc = new OllamaModelsService(buildPlugin());
			const models = await svc.getModels();

			// No model_info at all, no context_length key, and a zero value: none
			// should masquerade as a real window.
			expect(models.map((m) => m.contextWindow)).toEqual([undefined, undefined, undefined]);
		});
	});

	describe('getRuntimeContextLength', () => {
		/** Mock /api/ps alongside the endpoints getModels needs. */
		function mockPs(psModels: any[] | null, status = 200) {
			mockedRequestUrl.mockImplementation((opts: { url: string }) => {
				if (opts.url.endsWith('/api/ps')) {
					return Promise.resolve({ status, json: psModels ? { models: psModels } : {} });
				}
				return Promise.resolve({ status: 200, json: { models: [] } });
			});
		}

		it('returns the allocation the daemon actually made for a loaded model', async () => {
			mockPs([{ name: 'gemma4:12b-mlx', model: 'gemma4:12b-mlx', context_length: 262_144 }]);
			const svc = new OllamaModelsService(buildPlugin());

			await expect(svc.getRuntimeContextLength('gemma4:12b-mlx')).resolves.toBe(262_144);
		});

		// #1252: the daemon's VRAM-based default can be a small fraction of what
		// the weights support, and only /api/ps knows which one is in force.
		it('reports a small allocation for a model whose weights support far more', async () => {
			mockPs([{ name: 'gemma4:12b-mlx', context_length: 4_096 }]);
			const svc = new OllamaModelsService(buildPlugin());

			await expect(svc.getRuntimeContextLength('gemma4:12b-mlx')).resolves.toBe(4_096);
		});

		it('returns null when the model is not currently loaded', async () => {
			mockPs([{ name: 'some-other-model', context_length: 8_192 }]);
			const svc = new OllamaModelsService(buildPlugin());

			await expect(svc.getRuntimeContextLength('gemma4:12b-mlx')).resolves.toBeNull();
		});

		it('returns null when the daemon is unreachable or errors', async () => {
			mockPs(null, 500);
			const svc = new OllamaModelsService(buildPlugin());
			await expect(svc.getRuntimeContextLength('gemma4:12b-mlx')).resolves.toBeNull();

			svc.invalidate();
			mockedRequestUrl.mockRejectedValue(new Error('ECONNREFUSED'));
			await expect(svc.getRuntimeContextLength('gemma4:12b-mlx')).resolves.toBeNull();
		});

		// A single turn resolves the context limit up to three times (token-usage
		// indicator + both compaction thresholds); the allocation can't change
		// between them, so they should collapse into one probe.
		describe('caching', () => {
			const psCalls = () =>
				mockedRequestUrl.mock.calls.filter((c: any[]) => String(c[0]?.url).endsWith('/api/ps')).length;

			it('probes once for repeated lookups of the same model', async () => {
				mockPs([{ name: 'gemma4:12b-mlx', context_length: 262_144 }]);
				const svc = new OllamaModelsService(buildPlugin());

				const results = [
					await svc.getRuntimeContextLength('gemma4:12b-mlx'),
					await svc.getRuntimeContextLength('gemma4:12b-mlx'),
					await svc.getRuntimeContextLength('gemma4:12b-mlx'),
				];

				expect(results).toEqual([262_144, 262_144, 262_144]);
				expect(psCalls()).toBe(1);
			});

			// A down daemon is the case that most needs caching — otherwise every
			// turn pays the connection timeout three times over.
			it('caches a probe failure rather than retrying it within the turn', async () => {
				mockedRequestUrl.mockRejectedValue(new Error('ECONNREFUSED'));
				const svc = new OllamaModelsService(buildPlugin());

				await expect(svc.getRuntimeContextLength('gemma4:12b-mlx')).resolves.toBeNull();
				await expect(svc.getRuntimeContextLength('gemma4:12b-mlx')).resolves.toBeNull();

				expect(psCalls()).toBe(1);
			});

			it('does not serve one model’s allocation for another', async () => {
				mockPs([
					{ name: 'gemma4:12b-mlx', context_length: 262_144 },
					{ name: 'gpt-oss:120b-cloud', context_length: 131_072 },
				]);
				const svc = new OllamaModelsService(buildPlugin());

				await expect(svc.getRuntimeContextLength('gemma4:12b-mlx')).resolves.toBe(262_144);
				await expect(svc.getRuntimeContextLength('gpt-oss:120b-cloud')).resolves.toBe(131_072);
			});

			// Pointing at a different daemon must not serve the previous one's
			// allocation, and this probe can run without getModels() noticing.
			it('does not serve a previous daemon’s allocation after the base URL changes', async () => {
				const plugin = buildPlugin();
				mockPs([{ name: 'gemma4:12b-mlx', context_length: 262_144 }]);
				const svc = new OllamaModelsService(plugin);
				await expect(svc.getRuntimeContextLength('gemma4:12b-mlx')).resolves.toBe(262_144);

				plugin.settings.ollamaBaseUrl = 'http://10.0.0.1:11434';
				mockPs([{ name: 'gemma4:12b-mlx', context_length: 4_096 }]);
				await expect(svc.getRuntimeContextLength('gemma4:12b-mlx')).resolves.toBe(4_096);
			});

			it('re-probes after invalidate()', async () => {
				mockPs([{ name: 'gemma4:12b-mlx', context_length: 262_144 }]);
				const svc = new OllamaModelsService(buildPlugin());
				await svc.getRuntimeContextLength('gemma4:12b-mlx');

				svc.invalidate();
				await svc.getRuntimeContextLength('gemma4:12b-mlx');

				expect(psCalls()).toBe(2);
			});

			// The result cache only helps after a probe resolves. Callers can overlap
			// — the UI's token indicator refreshing while a turn's prepareHistory
			// runs — so concurrent misses must share one request, not fan out.
			it('coalesces concurrent lookups into a single probe', async () => {
				let release: (v: any) => void = () => {};
				const gate = new Promise((r) => (release = r));
				mockedRequestUrl.mockImplementation(async (opts: { url: string }) => {
					if (opts.url.endsWith('/api/ps')) {
						await gate;
						return { status: 200, json: { models: [{ name: 'gemma4:12b-mlx', context_length: 262_144 }] } };
					}
					return { status: 200, json: { models: [] } };
				});
				const svc = new OllamaModelsService(buildPlugin());

				const all = Promise.all([
					svc.getRuntimeContextLength('gemma4:12b-mlx'),
					svc.getRuntimeContextLength('gemma4:12b-mlx'),
					svc.getRuntimeContextLength('gemma4:12b-mlx'),
				]);
				release(null);

				expect(await all).toEqual([262_144, 262_144, 262_144]);
				expect(psCalls()).toBe(1);
			});

			it('starts a fresh probe once an in-flight one has settled', async () => {
				mockPs([{ name: 'gemma4:12b-mlx', context_length: 262_144 }]);
				const svc = new OllamaModelsService(buildPlugin());

				await Promise.all([
					svc.getRuntimeContextLength('gemma4:12b-mlx'),
					svc.getRuntimeContextLength('gemma4:12b-mlx'),
				]);
				svc.invalidate();
				await svc.getRuntimeContextLength('gemma4:12b-mlx');

				// One coalesced probe, then one after the cache was dropped — the
				// in-flight entry must not linger past settle.
				expect(psCalls()).toBe(2);
			});

			// invalidate() has to be authoritative: a probe already in flight when it
			// runs must not land afterwards and re-seed the cache it just cleared.
			it('does not let a probe started before invalidate() re-seed the cache', async () => {
				let release: (v: any) => void = () => {};
				const gate = new Promise((r) => (release = r));
				mockedRequestUrl.mockImplementation(async (opts: { url: string }) => {
					if (opts.url.endsWith('/api/ps')) {
						await gate;
						return { status: 200, json: { models: [{ name: 'gemma4:12b-mlx', context_length: 262_144 }] } };
					}
					return { status: 200, json: { models: [] } };
				});
				const svc = new OllamaModelsService(buildPlugin());

				const stale = svc.getRuntimeContextLength('gemma4:12b-mlx');
				svc.invalidate();
				release(null);

				// The generation guard suppresses the cache write, not the result: the
				// caller that started the probe still gets its answer.
				expect(await stale).toBe(262_144);

				// But the next lookup must go back to the daemon rather than read an
				// entry re-seeded after invalidate().
				await svc.getRuntimeContextLength('gemma4:12b-mlx');
				expect(psCalls()).toBe(2);
			});
		});
	});
});
