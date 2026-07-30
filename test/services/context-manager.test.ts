import {
	ContextManager,
	CONTEXT_SUMMARY_MARKER,
	CompactionResult,
	TokenUsageInfo,
} from '../../src/services/context-manager';
import { ModelClientFactory, ModelUseCase } from '../../src/api';

// Mock @google/genai
const mockCountTokens = vi.fn();
const mockGenerateContent = vi.fn();

vi.mock('@google/genai', () => ({
	GoogleGenAI: vi.fn().mockImplementation(function () {
		return {
			models: {
				countTokens: (...args: any[]) => mockCountTokens(...args),
				generateContent: (...args: any[]) => mockGenerateContent(...args),
			},
		};
	}),
}));

vi.mock('../../src/utils/retry', async () => {
	const actual = await vi.importActual<any>('../../src/utils/retry');
	return {
		...actual,
		executeWithRetry: vi.fn().mockImplementation((operation, _config, options) => {
			const zeroConfig = {
				maxRetries: 0,
				initialDelayMs: 1,
				maxDelayMs: 1,
				jitter: false,
			};
			return actual.executeWithRetry(operation, zeroConfig, options);
		}),
	};
});

describe('ContextManager', () => {
	let contextManager: ContextManager;
	let mockPlugin: any;
	let mockLogger: any;

	beforeEach(() => {
		mockLogger = {
			log: vi.fn(),
			debug: vi.fn(),
			error: vi.fn(),
			warn: vi.fn(),
		};

		mockPlugin = {
			apiKey: 'test-api-key',
			logger: mockLogger,
			settings: {
				provider: 'gemini',
				contextCompactionThreshold: 20,
				chatModelName: 'gemini-2.5-flash',
			},
			getModelManager: vi.fn().mockReturnValue({}),
		};

		contextManager = new ContextManager(mockPlugin, mockLogger);

		// Default mock implementations
		mockCountTokens.mockResolvedValue({ totalTokens: 1000 });
		mockGenerateContent.mockResolvedValue({
			candidates: [
				{
					content: {
						parts: [{ text: 'This is a summary of the conversation.' }],
					},
				},
			],
		});
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('updateUsageMetadata', () => {
		test('should cache usage metadata', () => {
			const metadata = {
				promptTokenCount: 5000,
				candidatesTokenCount: 1000,
				totalTokenCount: 6000,
			};

			contextManager.updateUsageMetadata(metadata);

			expect(mockLogger.log).toHaveBeenCalledWith(
				expect.stringContaining('Updated usage metadata: prompt=5000, total=6000')
			);
		});

		test('should handle null metadata without error', () => {
			contextManager.updateUsageMetadata(null as any);
			// Should not throw
		});

		test('should use high-water mark and reject lower promptTokenCount within a turn', async () => {
			contextManager.updateUsageMetadata({ promptTokenCount: 10000, totalTokenCount: 12000 });
			contextManager.updateUsageMetadata({ promptTokenCount: 5000, totalTokenCount: 6000 });

			const usage = await contextManager.getTokenUsage('gemini-2.5-flash');
			expect(usage.estimatedTokens).toBe(10000);
			expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('Skipped lower metadata'));
		});

		test('should accept equal promptTokenCount', async () => {
			contextManager.updateUsageMetadata({ promptTokenCount: 10000, totalTokenCount: 12000 });
			contextManager.updateUsageMetadata({ promptTokenCount: 10000, totalTokenCount: 13000 });

			const usage = await contextManager.getTokenUsage('gemini-2.5-flash');
			expect(usage.estimatedTokens).toBe(10000);
		});

		test('should accept lower value after beginTurn', async () => {
			contextManager.updateUsageMetadata({ promptTokenCount: 30000, totalTokenCount: 35000 });
			contextManager.beginTurn();
			contextManager.updateUsageMetadata({ promptTokenCount: 20000, totalTokenCount: 22000 });

			const usage = await contextManager.getTokenUsage('gemini-2.5-flash');
			expect(usage.estimatedTokens).toBe(20000);
		});

		test('should re-enable high-water mark after first update in new turn', async () => {
			contextManager.updateUsageMetadata({ promptTokenCount: 30000, totalTokenCount: 35000 });
			contextManager.beginTurn();
			contextManager.updateUsageMetadata({ promptTokenCount: 20000, totalTokenCount: 22000 });
			// Now high-water mark should be back in effect
			contextManager.updateUsageMetadata({ promptTokenCount: 15000, totalTokenCount: 16000 });

			const usage = await contextManager.getTokenUsage('gemini-2.5-flash');
			expect(usage.estimatedTokens).toBe(20000);
		});

		test('should preserve cachedContentTokenCount on updates', async () => {
			contextManager.updateUsageMetadata({
				promptTokenCount: 10000,
				totalTokenCount: 11000,
				cachedContentTokenCount: 8000,
			});

			const usage = await contextManager.getTokenUsage('gemini-2.5-flash');
			expect(usage.cachedTokens).toBe(8000);
		});

		test('should log cached ratio alongside prompt/total', () => {
			contextManager.updateUsageMetadata({
				promptTokenCount: 10000,
				totalTokenCount: 11000,
				cachedContentTokenCount: 8000,
			});

			expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('cached=8000 (80%)'));
		});

		test('should report zero cached tokens when field is absent', () => {
			contextManager.updateUsageMetadata({
				promptTokenCount: 5000,
				totalTokenCount: 6000,
			});

			expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('cached=0 (0%)'));
		});
	});

	describe('setUsageMetadata', () => {
		test('should force-set metadata even if lower than cached', async () => {
			contextManager.updateUsageMetadata({ promptTokenCount: 50000, totalTokenCount: 60000 });
			contextManager.setUsageMetadata({ promptTokenCount: 5000, totalTokenCount: 6000 });

			const usage = await contextManager.getTokenUsage('gemini-2.5-flash');
			expect(usage.estimatedTokens).toBe(5000);
		});
	});

	describe('getTokenUsage', () => {
		test('should return zero when no metadata cached', async () => {
			const usage: TokenUsageInfo = await contextManager.getTokenUsage('gemini-2.5-flash');

			expect(usage.estimatedTokens).toBe(0);
			expect(usage.inputTokenLimit).toBe(1_000_000); // DEFAULT_INPUT_TOKEN_LIMIT
			expect(usage.percentUsed).toBe(0);
		});

		test('should return correct values after metadata update', async () => {
			contextManager.updateUsageMetadata({
				promptTokenCount: 200_000,
				totalTokenCount: 250_000,
			});

			const usage = await contextManager.getTokenUsage('gemini-2.5-flash');

			expect(usage.estimatedTokens).toBe(200_000);
			expect(usage.percentUsed).toBe(20);
		});

		test('should use default token limit', async () => {
			contextManager.updateUsageMetadata({
				promptTokenCount: 100_000,
				totalTokenCount: 120_000,
			});

			const usage = await contextManager.getTokenUsage('gemini-2.5-flash');

			expect(usage.inputTokenLimit).toBe(1_000_000); // DEFAULT_INPUT_TOKEN_LIMIT
			expect(usage.percentUsed).toBe(10);
		});
	});

	// A flat per-provider limit is wrong for Ollama by up to three orders of
	// magnitude: local windows run 4k–1M. The old 32k constant showed a 262k model
	// as 43% full at 13.9k tokens and compacted history at 2.4% of real capacity.
	describe('getTokenUsage: Ollama context window resolution', () => {
		const OLLAMA_MODEL = 'kimi-k2.7-code:cloud';

		/** ContextManager wired to an Ollama daemon with the given probe results. */
		function buildOllamaContext(opts: { runtime?: number | null; contextWindow?: number }) {
			const getRuntimeContextLength = vi.fn().mockResolvedValue(opts.runtime ?? null);
			const getModels = vi
				.fn()
				.mockResolvedValue([
					{ value: OLLAMA_MODEL, label: OLLAMA_MODEL, provider: 'ollama', contextWindow: opts.contextWindow },
				]);
			const plugin = {
				...mockPlugin,
				settings: { ...mockPlugin.settings, provider: 'ollama' },
				getModelManager: vi.fn().mockReturnValue({
					getOllamaModelsService: () => ({ getRuntimeContextLength, getModels }),
				}),
			};
			return { ctx: new ContextManager(plugin, mockLogger), getRuntimeContextLength, getModels };
		}

		async function withOllamaModelRegistered(run: () => Promise<void>) {
			const { setGeminiModels, GEMINI_MODELS } = await import('../../src/models');
			const original = [...GEMINI_MODELS];
			setGeminiModels([{ value: OLLAMA_MODEL, label: OLLAMA_MODEL, provider: 'ollama' as const }]);
			try {
				await run();
			} finally {
				setGeminiModels(original);
			}
		}

		test('prefers the runtime allocation reported by /api/ps', async () => {
			await withOllamaModelRegistered(async () => {
				const { ctx } = buildOllamaContext({ runtime: 262_144, contextWindow: 262_144 });
				ctx.updateUsageMetadata({ promptTokenCount: 13_898, totalTokenCount: 14_000 });

				const usage = await ctx.getTokenUsage(OLLAMA_MODEL);

				expect(usage.inputTokenLimit).toBe(262_144);
				// Was reported as 43.4% against the flat 32k limit.
				expect(usage.percentUsed).toBe(5.3);
			});
		});

		// #1252: the daemon defaults to a 4k window under 24 GiB of VRAM. Trusting
		// the model's trained ceiling there would mean never compacting while
		// Ollama silently truncated the prompt.
		test('uses the small runtime allocation over the much larger trained ceiling', async () => {
			await withOllamaModelRegistered(async () => {
				const { ctx, getModels } = buildOllamaContext({ runtime: 4_096, contextWindow: 262_144 });
				ctx.updateUsageMetadata({ promptTokenCount: 2_048, totalTokenCount: 2_100 });

				const usage = await ctx.getTokenUsage(OLLAMA_MODEL);

				expect(usage.inputTokenLimit).toBe(4_096);
				expect(usage.percentUsed).toBe(50);
				// The authoritative probe answered, so the ceiling is never consulted.
				expect(getModels).not.toHaveBeenCalled();
			});
		});

		test('falls back to the trained ceiling when the model is not yet loaded', async () => {
			await withOllamaModelRegistered(async () => {
				const { ctx } = buildOllamaContext({ runtime: null, contextWindow: 131_072 });
				ctx.updateUsageMetadata({ promptTokenCount: 13_107, totalTokenCount: 14_000 });

				const usage = await ctx.getTokenUsage(OLLAMA_MODEL);

				expect(usage.inputTokenLimit).toBe(131_072);
			});
		});

		test('falls back to the provider default when the daemon is unreachable', async () => {
			await withOllamaModelRegistered(async () => {
				const { ctx } = buildOllamaContext({ runtime: null, contextWindow: undefined });
				ctx.updateUsageMetadata({ promptTokenCount: 8_000, totalTokenCount: 9_000 });

				const usage = await ctx.getTokenUsage(OLLAMA_MODEL);

				expect(usage.inputTokenLimit).toBe(32_000);
			});
		});

		test('a probe failure degrades to the provider default rather than throwing', async () => {
			await withOllamaModelRegistered(async () => {
				const plugin = {
					...mockPlugin,
					settings: { ...mockPlugin.settings, provider: 'ollama' },
					getModelManager: vi.fn().mockReturnValue({
						getOllamaModelsService: () => ({
							getRuntimeContextLength: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
							getModels: vi.fn(),
						}),
					}),
				};
				const ctx = new ContextManager(plugin, mockLogger);
				ctx.updateUsageMetadata({ promptTokenCount: 8_000, totalTokenCount: 9_000 });

				const usage = await ctx.getTokenUsage(OLLAMA_MODEL);

				expect(usage.inputTokenLimit).toBe(32_000);
			});
		});

		test('leaves Gemini models on the provider limit', async () => {
			const { ctx, getRuntimeContextLength } = buildOllamaContext({ runtime: 4_096 });
			ctx.updateUsageMetadata({ promptTokenCount: 100_000, totalTokenCount: 120_000 });

			const usage = await ctx.getTokenUsage('gemini-2.5-flash');

			expect(usage.inputTokenLimit).toBe(1_000_000);
			expect(getRuntimeContextLength).not.toHaveBeenCalled();
		});
	});

	describe('countTokens', () => {
		test('should call ai.models.countTokens with correct params', async () => {
			mockCountTokens.mockResolvedValue({ totalTokens: 5000 });

			const result = await contextManager.countTokens('gemini-2.5-flash', [
				{ role: 'user', parts: [{ text: 'Hello' }] },
			]);

			expect(result).toBe(5000);
			expect(mockCountTokens).toHaveBeenCalledWith(
				expect.objectContaining({
					model: 'gemini-2.5-flash',
					contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
				})
			);
		});

		test('should sanitize non-text parts in contents', async () => {
			mockCountTokens.mockResolvedValue({ totalTokens: 3000 });

			const result = await contextManager.countTokens('gemini-2.5-flash', [
				{
					role: 'model',
					parts: [{ functionCall: { name: 'search', args: { query: 'test' } } }],
				},
			]);

			expect(result).toBe(3000);
			// Should have converted functionCall to text
			expect(mockCountTokens).toHaveBeenCalledWith(
				expect.objectContaining({
					contents: [
						{
							role: 'model',
							parts: [{ text: expect.stringContaining('[Tool call: search') }],
						},
					],
				})
			);
		});

		test('should fall back to cached estimate on API error', async () => {
			mockCountTokens.mockRejectedValue(new Error('API error'));

			contextManager.updateUsageMetadata({ promptTokenCount: 3000, totalTokenCount: 4000 });

			const result = await contextManager.countTokens('gemini-2.5-flash', []);

			expect(result).toBe(3000);
			expect(mockLogger.error).toHaveBeenCalledWith('[ContextManager] countTokens failed:', expect.any(Error));
		});

		test('Ollama provider: estimates from char count instead of calling Gemini SDK', async () => {
			// Build a fresh ContextManager scoped to provider=ollama; the constructor
			// must not instantiate the Gemini SDK and countTokens must not call it.
			const ollamaPlugin = {
				...mockPlugin,
				apiKey: '',
				settings: { ...mockPlugin.settings, provider: 'ollama' },
			};
			const ollamaCtx = new ContextManager(ollamaPlugin, mockLogger);

			const result = await ollamaCtx.countTokens('llama3.2', [{ role: 'user', parts: [{ text: 'hello world' }] }]);

			// Heuristic is Math.ceil(JSON.stringify(sanitized).length / 4); the exact
			// value isn't important, only that it is a positive integer derived
			// locally without hitting the SDK.
			expect(result).toBeGreaterThan(0);
			expect(Number.isInteger(result)).toBe(true);
			expect(mockCountTokens).not.toHaveBeenCalled();
			expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('countTokens (estimate)'));
		});

		// #704: a session can span providers, so the counting strategy follows the
		// *model*, not a global setting.
		test('mixed routing: counts a Gemini model natively even when chat runs on Ollama', async () => {
			const { setGeminiModels, GEMINI_MODELS } = await import('../../src/models');
			const original = [...GEMINI_MODELS];
			setGeminiModels([
				{ value: 'gemini-2.5-flash', label: 'Flash' },
				{ value: 'llama3.2', label: 'Llama', provider: 'ollama' as const },
			]);

			try {
				const mixedPlugin = {
					...mockPlugin,
					settings: { ...mockPlugin.settings, provider: 'ollama', providerOverrides: { summary: 'gemini' } },
				};
				const ctx = new ContextManager(mixedPlugin, mockLogger);
				const contents = [{ role: 'user', parts: [{ text: 'hello world' }] }];

				// The Gemini-served model goes through the SDK...
				await ctx.countTokens('gemini-2.5-flash', contents);
				expect(mockCountTokens).toHaveBeenCalled();

				// ...while the Ollama-served one is still estimated locally.
				mockCountTokens.mockClear();
				await ctx.countTokens('llama3.2', contents);
				expect(mockCountTokens).not.toHaveBeenCalled();
			} finally {
				setGeminiModels(original);
			}
		});

		// Ollama tags only reach the model list once the daemon answers. Treating an
		// unrecognized model as Gemini would mean a doomed countTokens call and a
		// 1M-token context limit on a model that may only hold 8k.
		test('falls back to the chat provider for a model missing from the list', async () => {
			const { setGeminiModels, GEMINI_MODELS } = await import('../../src/models');
			const original = [...GEMINI_MODELS];
			// Daemon was down: no Ollama entries were ever registered.
			setGeminiModels([{ value: 'gemini-2.5-flash', label: 'Flash' }]);

			try {
				const ollamaPlugin = {
					...mockPlugin,
					apiKey: 'test-api-key',
					settings: { ...mockPlugin.settings, provider: 'ollama' },
				};
				const ctx = new ContextManager(ollamaPlugin, mockLogger);

				await ctx.countTokens('mistral-nemo', [{ role: 'user', parts: [{ text: 'hello world' }] }]);

				expect(mockCountTokens).not.toHaveBeenCalled();
			} finally {
				setGeminiModels(original);
			}
		});

		test('Ollama provider: calibrates the chars-per-token ratio from real usage metadata', async () => {
			const ollamaPlugin = {
				...mockPlugin,
				apiKey: '',
				settings: { ...mockPlugin.settings, provider: 'ollama' },
			};
			const ollamaCtx = new ContextManager(ollamaPlugin, mockLogger);
			const contents = [{ role: 'user', parts: [{ text: 'a'.repeat(400) }] }];

			const initialEstimate = await ollamaCtx.countTokens('llama3.2', contents);

			// Real response reports far fewer tokens than the char/4 default predicted —
			// simulating a tokenizer that's more efficient than the generic heuristic.
			ollamaCtx.updateUsageMetadata({ promptTokenCount: Math.round(initialEstimate / 2) }, 'llama3.2');

			const recalibratedEstimate = await ollamaCtx.countTokens('llama3.2', contents);
			expect(recalibratedEstimate).toBeLessThan(initialEstimate);
		});

		test('Ollama provider: calibration is per-model and does not affect other models', async () => {
			const ollamaPlugin = {
				...mockPlugin,
				apiKey: '',
				settings: { ...mockPlugin.settings, provider: 'ollama' },
			};
			const ollamaCtx = new ContextManager(ollamaPlugin, mockLogger);
			const contents = [{ role: 'user', parts: [{ text: 'a'.repeat(400) }] }];

			const baselineEstimate = await ollamaCtx.countTokens('llama3.2', contents);
			await ollamaCtx.countTokens('mistral', contents);
			ollamaCtx.updateUsageMetadata({ promptTokenCount: Math.round(baselineEstimate / 2) }, 'llama3.2');

			const otherModelEstimate = await ollamaCtx.countTokens('mistral', contents);
			expect(otherModelEstimate).toBe(baselineEstimate);
		});

		test('Ollama provider: calibration is skipped without a prior estimate or promptTokenCount', () => {
			const ollamaPlugin = {
				...mockPlugin,
				apiKey: '',
				settings: { ...mockPlugin.settings, provider: 'ollama' },
			};
			const ollamaCtx = new ContextManager(ollamaPlugin, mockLogger);

			// No prior countTokens() call for this model, and no modelName/promptTokenCount —
			// none of these should throw.
			expect(() => ollamaCtx.updateUsageMetadata({ promptTokenCount: 100 }, 'never-estimated')).not.toThrow();
			expect(() => ollamaCtx.updateUsageMetadata({ totalTokenCount: 100 }, 'llama3.2')).not.toThrow();
			expect(() => ollamaCtx.updateUsageMetadata({ promptTokenCount: 100 })).not.toThrow();
		});
	});

	describe('prepareHistory', () => {
		test('should skip compaction for short conversations', async () => {
			const history = [
				{ role: 'user', parts: [{ text: 'Hello' }] },
				{ role: 'model', parts: [{ text: 'Hi!' }] },
			];

			const result: CompactionResult = await contextManager.prepareHistory(history, 'gemini-2.5-flash');

			expect(result.wasCompacted).toBe(false);
			expect(result.compactedHistory).toBe(history);
		});

		test('should skip compaction when no cached metadata exists', async () => {
			// No updateUsageMetadata called — simulates first message in a session
			const history = Array.from({ length: 20 }, (_, i) => ({
				role: i % 2 === 0 ? 'user' : 'model',
				parts: [{ text: `Message ${i}` }],
			}));

			const result = await contextManager.prepareHistory(history, 'gemini-2.5-flash');

			expect(result.wasCompacted).toBe(false);
			expect(result.compactedHistory).toEqual(history);
			expect(result.estimatedTokens).toBe(0);
		});

		test('should skip compaction when under threshold', async () => {
			contextManager.updateUsageMetadata({
				promptTokenCount: 50_000,
				totalTokenCount: 60_000,
			});

			const history = Array.from({ length: 20 }, (_, i) => ({
				role: i % 2 === 0 ? 'user' : 'model',
				parts: [{ text: `Message ${i}` }],
			}));

			const result = await contextManager.prepareHistory(history, 'gemini-2.5-flash');

			expect(result.wasCompacted).toBe(false);
			expect(result.compactedHistory).toEqual(history);
			// Should NOT call countTokens — relies only on cached metadata
			expect(mockCountTokens).not.toHaveBeenCalled();
		});

		test('should perform compaction when over threshold', async () => {
			// 20% of 1M = 200K threshold
			contextManager.updateUsageMetadata({
				promptTokenCount: 250_000,
				totalTokenCount: 300_000,
			});

			// countTokens is called AFTER compaction to measure the result
			mockCountTokens.mockResolvedValue({ totalTokens: 50_000 });

			const history = Array.from({ length: 20 }, (_, i) => ({
				role: i % 2 === 0 ? 'user' : 'model',
				parts: [{ text: `Message ${i}` }],
			}));

			const result = await contextManager.prepareHistory(history, 'gemini-2.5-flash');

			expect(result.wasCompacted).toBe(true);
			expect(result.summaryText).toBeTruthy();
			expect(result.compactedHistory.length).toBeLessThan(history.length);
		});

		test('should compact history entries with message format (stored sessions)', async () => {
			contextManager.updateUsageMetadata({
				promptTokenCount: 250_000,
				totalTokenCount: 300_000,
			});
			mockCountTokens.mockResolvedValue({ totalTokens: 50_000 });

			// Simulate stored session format: entries use 'message' field, not 'parts'
			const history = Array.from({ length: 20 }, (_, i) => ({
				role: i % 2 === 0 ? 'user' : 'model',
				message: `Message ${i}`,
			}));

			const result = await contextManager.prepareHistory(history, 'gemini-2.5-flash');

			expect(result.wasCompacted).toBe(true);
			expect(result.summaryText).toBeTruthy();
			expect(result.compactedHistory.length).toBeLessThan(history.length);
			expect(result.compactedHistory[0].parts![0].text).toContain(CONTEXT_SUMMARY_MARKER);
			expect(result.compactedHistory[1].role).toBe('model');
			// countTokens should be called once post-compaction to measure result size
			expect(mockCountTokens).toHaveBeenCalledTimes(1);
		});

		test('should maintain valid turn structure after compaction', async () => {
			contextManager.updateUsageMetadata({
				promptTokenCount: 250_000,
				totalTokenCount: 300_000,
			});
			mockCountTokens.mockResolvedValue({ totalTokens: 50_000 });

			const history = Array.from({ length: 20 }, (_, i) => ({
				role: i % 2 === 0 ? 'user' : 'model',
				parts: [{ text: `Message ${i}` }],
			}));

			const result = await contextManager.prepareHistory(history, 'gemini-2.5-flash');

			expect(result.compactedHistory[0].role).toBe('user');
			expect(result.compactedHistory[1].role).toBe('model');
		});

		test('should use aggressive compaction when over 80% of input limit', async () => {
			// 80% of 1M = 800K
			contextManager.updateUsageMetadata({
				promptTokenCount: 850_000,
				totalTokenCount: 900_000,
			});
			mockCountTokens.mockResolvedValue({ totalTokens: 50_000 });

			const history = Array.from({ length: 20 }, (_, i) => ({
				role: i % 2 === 0 ? 'user' : 'model',
				parts: [{ text: `Message ${i}` }],
			}));

			const result = await contextManager.prepareHistory(history, 'gemini-2.5-flash');

			expect(result.wasCompacted).toBe(true);
			// Aggressive keeps fewer turns (AGGRESSIVE_RECENT_TURNS = 5)
			// So compacted history = summary + ack + ~5 recent = ~7
			expect(result.compactedHistory.length).toBeLessThanOrEqual(8);
		});

		test('phase 1 (truncation) suffices when over threshold but big tool result dominates', async () => {
			// Cached estimate is over the 200K threshold (20% of 1M). Phase 1
			// truncation sheds ~150K tokens via the chars-per-token heuristic —
			// enough to fall back under the threshold and skip the expensive
			// summarization phase entirely.
			contextManager.updateUsageMetadata({
				promptTokenCount: 220_000,
				totalTokenCount: 230_000,
			});

			// Three tool-result turns: the oldest carries the fat payload; the
			// two newer ones are kept intact by `keepRecent: 2`.
			const fatResponse = { success: true, content: 'x'.repeat(600_000) };
			const smallResponse = { success: true, files: ['a'] };
			const history = [
				{ role: 'user', parts: [{ text: 'go' }] },
				{ role: 'model', parts: [{ functionCall: { name: 'read_file', args: { path: 'big.md' } } }] },
				{ role: 'user', parts: [{ functionResponse: { name: 'read_file', response: fatResponse } }] }, // OLDEST tool result — truncate
				{ role: 'model', parts: [{ text: 'reasoning…' }] },
				{ role: 'user', parts: [{ text: 'now list' }] },
				{ role: 'model', parts: [{ functionCall: { name: 'list_files', args: {} } }] },
				{ role: 'user', parts: [{ functionResponse: { name: 'list_files', response: smallResponse } }] }, // recent — kept
				{ role: 'model', parts: [{ text: 'thinking' }] },
				{ role: 'user', parts: [{ text: 'and one more' }] },
				{ role: 'model', parts: [{ functionCall: { name: 'list_files', args: {} } }] },
				{ role: 'user', parts: [{ functionResponse: { name: 'list_files', response: smallResponse } }] }, // most recent — kept
			];

			const result = await contextManager.prepareHistory(history, 'gemini-2.5-flash');

			expect(result.wasCompacted).toBe(false);
			// Phase 1 truncated the oldest tool result.
			const oldToolResult = result.compactedHistory[2].parts![0].functionResponse!.response;
			expect((oldToolResult as any).truncated).toBe(true);
			// No summarization roundtrip — phase 1 alone was sufficient.
			expect(mockCountTokens).not.toHaveBeenCalled();

			// The lower post-truncation estimate must be persisted immediately —
			// not left to the caller — so a subsequent real (lower) API-reported
			// count isn't rejected by updateUsageMetadata's high-water mark.
			expect((await contextManager.getTokenUsage('gemini-2.5-flash')).estimatedTokens).toBe(result.estimatedTokens);
			contextManager.updateUsageMetadata({
				promptTokenCount: result.estimatedTokens,
				totalTokenCount: result.estimatedTokens,
			});
			expect((await contextManager.getTokenUsage('gemini-2.5-flash')).estimatedTokens).toBe(result.estimatedTokens);
		});

		test('does not truncate under threshold even when big tool results are present (cache preservation)', async () => {
			// Modifying older history bytes invalidates Gemini's prefix cache for
			// the rest of the prompt. So when we're still under the compaction
			// threshold, truncation must not fire — even if there's a fat old
			// tool-result payload sitting in history that we *could* shed.
			contextManager.updateUsageMetadata({
				promptTokenCount: 50_000,
				totalTokenCount: 60_000,
			});

			const fatResponse = { success: true, content: 'x'.repeat(600_000) };
			const smallResponse = { success: true, files: ['a'] };
			const history = [
				{ role: 'user', parts: [{ text: 'go' }] },
				{ role: 'model', parts: [{ functionCall: { name: 'read_file', args: { path: 'big.md' } } }] },
				{ role: 'user', parts: [{ functionResponse: { name: 'read_file', response: fatResponse } }] },
				{ role: 'model', parts: [{ text: 'reasoning…' }] },
				{ role: 'user', parts: [{ text: 'now list' }] },
				{ role: 'model', parts: [{ functionCall: { name: 'list_files', args: {} } }] },
				{ role: 'user', parts: [{ functionResponse: { name: 'list_files', response: smallResponse } }] },
				{ role: 'model', parts: [{ text: 'thinking' }] },
				{ role: 'user', parts: [{ text: 'and one more' }] },
				{ role: 'model', parts: [{ functionCall: { name: 'list_files', args: {} } }] },
				{ role: 'user', parts: [{ functionResponse: { name: 'list_files', response: smallResponse } }] },
			];

			const result = await contextManager.prepareHistory(history, 'gemini-2.5-flash');

			expect(result.wasCompacted).toBe(false);
			// Returns the input reference unchanged — cache prefix is not disturbed.
			expect(result.compactedHistory).toBe(history);
			// And specifically, the fat tool result is left whole.
			const oldToolResult = result.compactedHistory[2].parts![0].functionResponse!.response;
			expect((oldToolResult as any).truncated).toBeUndefined();
			expect((oldToolResult as any).content).toHaveLength(600_000);
		});

		test('phase 2 (summarization) fires when truncation alone is insufficient', async () => {
			// Cached estimate is far over the threshold and the bloat is *not*
			// concentrated in old tool results — most of it is genuine
			// conversation. Phase 1 truncation runs but doesn't bring us under
			// threshold; phase 2 has to run.
			contextManager.updateUsageMetadata({
				promptTokenCount: 850_000,
				totalTokenCount: 900_000,
			});
			mockCountTokens.mockResolvedValue({ totalTokens: 50_000 });

			// Plenty of text turns (no tool-result bloat to shed) so phase 1 is a no-op.
			const history = Array.from({ length: 20 }, (_, i) => ({
				role: i % 2 === 0 ? 'user' : 'model',
				parts: [{ text: `Message ${i} `.repeat(100) }],
			}));

			const result = await contextManager.prepareHistory(history, 'gemini-2.5-flash');

			expect(result.wasCompacted).toBe(true);
			expect(result.summaryText).toBeTruthy();
			// Phase 2 ran (countTokens fired post-summarization to size the result).
			expect(mockCountTokens).toHaveBeenCalled();
		});

		// Compaction must follow the *summary* routing, never the chat model's
		// provider. The original code short-circuited to a direct
		// `this.ai.models.generateContent` call whenever the chat model was a
		// Gemini one — so with chat on Gemini and summary deliberately routed to a
		// local provider, conversation content was still sent to Google (#1266
		// review). Under that code the factory was never reached, so asserting it
		// *is* reached with ModelUseCase.SUMMARY is a real regression guard.
		test('routes compaction through the summary provider, not the chat model', async () => {
			const factorySpy = vi.spyOn(ModelClientFactory, 'createFromPlugin').mockReturnValue({
				generateModelResponse: vi.fn().mockResolvedValue({ markdown: 'local summary' }),
			});

			try {
				const mixedPlugin = {
					...mockPlugin,
					settings: { ...mockPlugin.settings, provider: 'gemini', providerOverrides: { summary: 'ollama' } },
				};
				const ctx = new ContextManager(mixedPlugin, mockLogger);
				ctx.updateUsageMetadata({ promptTokenCount: 250_000, totalTokenCount: 300_000 });
				mockCountTokens.mockResolvedValue({ totalTokens: 50_000 });
				mockGenerateContent.mockClear();

				const history = Array.from({ length: 20 }, (_, i) => ({
					role: i % 2 === 0 ? 'user' : 'model',
					parts: [{ text: `Message ${i}` }],
				}));

				const result = await ctx.prepareHistory(history, 'gemini-2.5-flash');

				expect(result.wasCompacted).toBe(true);
				expect(result.summaryText).toBe('local summary');
				expect(factorySpy).toHaveBeenCalledWith(mixedPlugin, ModelUseCase.SUMMARY);
				// The Gemini SDK must not have been asked to summarize.
				expect(mockGenerateContent).not.toHaveBeenCalled();
			} finally {
				factorySpy.mockRestore();
			}
		});

		// The direct-SDK shortcut is gone for every configuration, not just the
		// overridden one, so summaryModelName governs compaction as documented.
		test('routes compaction through the factory on an all-Gemini setup too', async () => {
			const factorySpy = vi.spyOn(ModelClientFactory, 'createFromPlugin').mockReturnValue({
				generateModelResponse: vi.fn().mockResolvedValue({ markdown: 'cloud summary' }),
			});

			try {
				contextManager.updateUsageMetadata({ promptTokenCount: 250_000, totalTokenCount: 300_000 });
				mockCountTokens.mockResolvedValue({ totalTokens: 50_000 });
				mockGenerateContent.mockClear();

				const history = Array.from({ length: 20 }, (_, i) => ({
					role: i % 2 === 0 ? 'user' : 'model',
					parts: [{ text: `Message ${i}` }],
				}));

				const result = await contextManager.prepareHistory(history, 'gemini-2.5-flash');

				expect(result.summaryText).toBe('cloud summary');
				expect(factorySpy).toHaveBeenCalledWith(mockPlugin, ModelUseCase.SUMMARY);
				expect(mockGenerateContent).not.toHaveBeenCalled();
			} finally {
				factorySpy.mockRestore();
			}
		});

		test('handles empty Gemini summary result with fallback message', async () => {
			contextManager.updateUsageMetadata({
				promptTokenCount: 250_000,
				totalTokenCount: 300_000,
			});
			mockCountTokens.mockResolvedValue({ totalTokens: 50_000 });
			// Return empty summary from generateContent
			mockGenerateContent.mockResolvedValue({
				candidates: [{ content: { parts: [{ text: '' }] } }],
			});

			const history = Array.from({ length: 20 }, (_, i) => ({
				role: i % 2 === 0 ? 'user' : 'model',
				parts: [{ text: `Message ${i}` }],
			}));

			const result = await contextManager.prepareHistory(history, 'gemini-2.5-flash');

			expect(result.wasCompacted).toBe(true);
			expect(result.summaryText).toContain('could not be summarized');
			expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Summary generation returned empty result'));
		});

		test('handles Gemini summary with no candidates gracefully', async () => {
			contextManager.updateUsageMetadata({
				promptTokenCount: 250_000,
				totalTokenCount: 300_000,
			});
			mockCountTokens.mockResolvedValue({ totalTokens: 50_000 });
			// Return undefined candidates
			mockGenerateContent.mockResolvedValue({ candidates: undefined });

			const history = Array.from({ length: 20 }, (_, i) => ({
				role: i % 2 === 0 ? 'user' : 'model',
				parts: [{ text: `Message ${i}` }],
			}));

			const result = await contextManager.prepareHistory(history, 'gemini-2.5-flash');

			expect(result.wasCompacted).toBe(true);
			expect(result.summaryText).toContain('could not be summarized');
		});

		test('handles error during summarization with fallback message', async () => {
			contextManager.updateUsageMetadata({
				promptTokenCount: 250_000,
				totalTokenCount: 300_000,
			});
			mockCountTokens.mockResolvedValue({ totalTokens: 50_000 });
			// Make generateContent throw
			mockGenerateContent.mockRejectedValue(new Error('API down'));

			const history = Array.from({ length: 20 }, (_, i) => ({
				role: i % 2 === 0 ? 'user' : 'model',
				parts: [{ text: `Message ${i}` }],
			}));

			const result = await contextManager.prepareHistory(history, 'gemini-2.5-flash');

			expect(result.wasCompacted).toBe(true);
			expect(result.summaryText).toContain('could not be summarized due to an error');
			expect(mockLogger.error).toHaveBeenCalledWith(
				expect.stringContaining('Failed to generate summary'),
				expect.any(Error)
			);
		});

		describe('protectFromIndex (mid-loop compaction)', () => {
			test('clamps the split so the protected suffix (e.g. current agent-loop turns) is never summarized away', async () => {
				contextManager.updateUsageMetadata({
					promptTokenCount: 250_000,
					totalTokenCount: 300_000,
				});
				mockCountTokens.mockResolvedValue({ totalTokens: 50_000 });

				// 8 prior (completed) turns, then a 12-turn in-flight tool chain
				// carrying functionCall + thoughtSignature. Without protection the
				// default 30%-recent split (splitIndex=14) would land inside the
				// tool chain and summarize away some of its functionCall turns.
				const priorTurns = Array.from({ length: 8 }, (_, i) => ({
					role: i % 2 === 0 ? 'user' : 'model',
					parts: [{ text: `Prior turn ${i}` }],
				}));
				const loopTurns = [
					{ role: 'user', parts: [{ text: 'kick off a long tool chain' }] },
					{
						role: 'model',
						parts: [{ functionCall: { name: 'read_file', args: { path: 'a.md' } }, thoughtSignature: 'sig-a' }],
					},
					{ role: 'user', parts: [{ functionResponse: { name: 'read_file', response: { content: 'a' } } }] },
					{
						role: 'model',
						parts: [{ functionCall: { name: 'read_file', args: { path: 'b.md' } }, thoughtSignature: 'sig-b' }],
					},
					{ role: 'user', parts: [{ functionResponse: { name: 'read_file', response: { content: 'b' } } }] },
					{
						role: 'model',
						parts: [{ functionCall: { name: 'read_file', args: { path: 'c.md' } }, thoughtSignature: 'sig-c' }],
					},
					{ role: 'user', parts: [{ functionResponse: { name: 'read_file', response: { content: 'c' } } }] },
					{
						role: 'model',
						parts: [{ functionCall: { name: 'read_file', args: { path: 'd.md' } }, thoughtSignature: 'sig-d' }],
					},
					{ role: 'user', parts: [{ functionResponse: { name: 'read_file', response: { content: 'd' } } }] },
					{
						role: 'model',
						parts: [{ functionCall: { name: 'read_file', args: { path: 'e.md' } }, thoughtSignature: 'sig-e' }],
					},
					{ role: 'user', parts: [{ functionResponse: { name: 'read_file', response: { content: 'e' } } }] },
					{ role: 'model', parts: [{ text: 'done' }] },
				];
				const history = [...priorTurns, ...loopTurns];
				const protectFromIndex = priorTurns.length; // 8

				const result = await contextManager.prepareHistory(history, 'gemini-2.5-flash', { protectFromIndex });

				expect(result.wasCompacted).toBe(true);
				// summary + ack + all 12 loop turns kept verbatim.
				expect(result.compactedHistory).toHaveLength(2 + loopTurns.length);
				expect(result.compactedHistory[0].parts![0].text).toContain(CONTEXT_SUMMARY_MARKER);
				expect(result.compactedHistory.slice(2)).toEqual(loopTurns);

				// Every functionCall + thoughtSignature from the protected chain survives, in order.
				const signatures = result.compactedHistory
					.flatMap((turn) => turn.parts ?? [])
					.filter((p: any) => p.functionCall)
					.map((p: any) => p.thoughtSignature);
				expect(signatures).toEqual(['sig-a', 'sig-b', 'sig-c', 'sig-d', 'sig-e']);
			});

			test('skips summarization entirely when the protected suffix covers the whole history', async () => {
				contextManager.updateUsageMetadata({
					promptTokenCount: 250_000,
					totalTokenCount: 300_000,
				});
				mockCountTokens.mockResolvedValue({ totalTokens: 50_000 });

				// A headless caller with no prior history (initialHistory: []) — the
				// entire conversation belongs to the current loop, so there's
				// nothing older to fold into a summary.
				const history = Array.from({ length: 20 }, (_, i) => ({
					role: i % 2 === 0 ? 'user' : 'model',
					parts: [{ text: `Message ${i}` }],
				}));

				const result = await contextManager.prepareHistory(history, 'gemini-2.5-flash', { protectFromIndex: 0 });

				expect(result.wasCompacted).toBe(false);
				expect(result.compactedHistory).toEqual(history);
				expect(mockGenerateContent).not.toHaveBeenCalled();
			});
		});

		describe('Ollama calibration seeding', () => {
			// prepareHistory() is the entry point called before every outgoing
			// request. Its normal (no-compaction-needed) paths don't call
			// countTokens(), so they must still seed the pending Ollama estimate
			// themselves or calibrateOllamaRatio() never has anything to
			// calibrate against on ordinary turns (see #707 review feedback).
			function buildOllamaContext() {
				const ollamaPlugin = {
					...mockPlugin,
					apiKey: '',
					settings: { ...mockPlugin.settings, provider: 'ollama' },
				};
				return new ContextManager(ollamaPlugin, mockLogger);
			}

			// Each test computes a baseline estimate under a distinct, never-seeded
			// model name so the only thing that can seed calibration for the model
			// under test is prepareHistory() itself — not an incidental countTokens()
			// call made afterward for comparison.

			test('seeds calibration on the short-conversation short-circuit path', async () => {
				const ollamaCtx = buildOllamaContext();
				const history = [
					{ role: 'user', parts: [{ text: 'a'.repeat(400) }] },
					{ role: 'model', parts: [{ text: 'Hi!' }] },
				];

				const baselineEstimate = await ollamaCtx.countTokens('llama3.2-baseline', history);

				const result = await ollamaCtx.prepareHistory(history, 'llama3.2');
				expect(result.wasCompacted).toBe(false);

				// Real response reports far fewer tokens than the default ratio predicted.
				ollamaCtx.updateUsageMetadata({ promptTokenCount: Math.round(baselineEstimate / 2) }, 'llama3.2');
				const recalibratedEstimate = await ollamaCtx.countTokens('llama3.2', history);
				expect(recalibratedEstimate).toBeLessThan(baselineEstimate);
			});

			test('seeds calibration on the under-threshold no-op path', async () => {
				const ollamaCtx = buildOllamaContext();
				const history = Array.from({ length: 20 }, (_, i) => ({
					role: i % 2 === 0 ? 'user' : 'model',
					parts: [{ text: `Message ${i} `.repeat(20) }],
				}));

				const baselineEstimate = await ollamaCtx.countTokens('llama3.2-baseline', history);

				// Establish cached usage below threshold so prepareHistory takes the
				// no-op path (no compaction, no countTokens() call of its own) — the
				// only thing that can seed calibration for 'llama3.2' here is
				// prepareHistory() itself.
				ollamaCtx.updateUsageMetadata({ promptTokenCount: 1000, totalTokenCount: 1000 }, 'llama3.2');
				const result = await ollamaCtx.prepareHistory(history, 'llama3.2');
				expect(result.wasCompacted).toBe(false);

				// Real response reports far fewer tokens than the default ratio predicted.
				ollamaCtx.updateUsageMetadata({ promptTokenCount: Math.round(baselineEstimate / 4) }, 'llama3.2');
				const recalibratedEstimate = await ollamaCtx.countTokens('llama3.2', history);
				expect(recalibratedEstimate).toBeLessThan(baselineEstimate);
			});
		});
	});

	describe('reset', () => {
		test('should clear cached usage metadata', async () => {
			contextManager.updateUsageMetadata({
				promptTokenCount: 100_000,
				totalTokenCount: 120_000,
			});

			contextManager.reset();

			const usage = await contextManager.getTokenUsage('gemini-2.5-flash');
			expect(usage.estimatedTokens).toBe(0);
		});
	});

	describe('CONTEXT_SUMMARY_MARKER', () => {
		test('should be a recognizable string', () => {
			expect(CONTEXT_SUMMARY_MARKER).toBe('[Context Summary]');
		});
	});
});
