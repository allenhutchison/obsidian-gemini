import {
	ContextManager,
	CONTEXT_SUMMARY_MARKER,
	CompactionResult,
	TokenUsageInfo,
} from '../../src/services/context-manager';

// Mock @google/genai
const mockCountTokens = jest.fn();
const mockGenerateContent = jest.fn();

jest.mock('@google/genai', () => ({
	GoogleGenAI: jest.fn().mockImplementation(() => ({
		models: {
			countTokens: (...args: any[]) => mockCountTokens(...args),
			generateContent: (...args: any[]) => mockGenerateContent(...args),
		},
	})),
}));

describe('ContextManager', () => {
	let contextManager: ContextManager;
	let mockPlugin: any;
	let mockLogger: any;

	beforeEach(() => {
		mockLogger = {
			log: jest.fn(),
			debug: jest.fn(),
			error: jest.fn(),
			warn: jest.fn(),
		};

		mockPlugin = {
			apiKey: 'test-api-key',
			logger: mockLogger,
			settings: {
				contextCompactionThreshold: 20,
				chatModelName: 'gemini-2.5-flash',
			},
			getModelManager: jest.fn().mockReturnValue({}),
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
		jest.clearAllMocks();
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
			expect(result.compactedHistory[0].parts[0].text).toContain(CONTEXT_SUMMARY_MARKER);
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
