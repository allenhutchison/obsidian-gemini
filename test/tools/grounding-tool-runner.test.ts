import type { Mock } from 'vitest';
import { runGroundingTool, GroundingToolRequest } from '../../src/tools/grounding-tool-runner';
import { createGoogleGenAI } from '../../src/api/providers/gemini/google-genai-factory';
import { getDefaultModelForRole } from '../../src/models';
import type { GroundingChunk } from '@google/genai';

// Mock the genAI factory so we control the generateContent implementation.
vi.mock('../../src/api/providers/gemini/google-genai-factory', () => ({
	createGoogleGenAI: vi.fn(),
}));

// Run the wrapped operation with zero retries so tests stay fast and deterministic.
vi.mock('../../src/utils/retry', async () => {
	const actual = await vi.importActual<any>('../../src/utils/retry');
	return {
		...actual,
		executeWithRetry: vi.fn().mockImplementation((operation, _config, options) => {
			const zeroConfig = { maxRetries: 0, initialDelayMs: 1, maxDelayMs: 1, jitter: false };
			return actual.executeWithRetry(operation, zeroConfig, options);
		}),
	};
});

/** A `chunk.web`-style accessor, matching how GoogleSearchTool reads its chunks. */
const webCitation = (chunk: GroundingChunk) => ({
	uri: chunk.web?.uri,
	title: chunk.web?.title,
	snippet: (chunk.web as { snippet?: string } | undefined)?.snippet,
});

function makeRequest(overrides: Partial<GroundingToolRequest> = {}): GroundingToolRequest {
	return {
		query: 'test query',
		groundingTool: { googleSearch: {} },
		getChunkCitation: webCitation,
		promptPrefix: 'Please search for: ',
		errorPrefix: 'Grounding failed: ',
		operationName: 'GroundingToolRunner.test',
		...overrides,
	};
}

describe('runGroundingTool', () => {
	let mockPlugin: any;
	let mockGenAI: any;

	beforeEach(() => {
		vi.clearAllMocks();

		mockGenAI = {
			models: {
				generateContent: vi.fn(),
			},
		};
		(createGoogleGenAI as Mock).mockReturnValue(mockGenAI);

		mockPlugin = {
			apiKey: 'test-api-key',
			settings: {
				chatModelName: 'gemini-1.5-flash-002',
				temperature: 0.7,
			},
			logger: {
				warn: vi.fn(),
				log: vi.fn(),
				error: vi.fn(),
				debug: vi.fn(),
			},
		};
	});

	describe('API-key guard', () => {
		it('returns an error and does not call the API when no key is configured', async () => {
			mockPlugin.apiKey = '';

			const result = await runGroundingTool(mockPlugin, makeRequest());

			expect(result.success).toBe(false);
			expect(result.error).toBe('Google API key not configured');
			expect(mockGenAI.models.generateContent).not.toHaveBeenCalled();
		});
	});

	describe('request construction', () => {
		it('passes the grounding tool, model, and prefixed prompt through to generateContent', async () => {
			mockGenAI.models.generateContent.mockResolvedValue({
				candidates: [{ content: { parts: [{ text: 'answer' }] } }],
			});

			await runGroundingTool(mockPlugin, makeRequest({ query: 'coffee', promptPrefix: 'Find: ' }));

			expect(mockGenAI.models.generateContent).toHaveBeenCalledWith({
				model: 'gemini-1.5-flash-002',
				config: {
					temperature: 0.7,
					maxOutputTokens: 8192,
					tools: [{ googleSearch: {} }],
				},
				contents: 'Find: coffee',
			});
		});

		it('falls back to the default chat model when none is configured', async () => {
			mockPlugin.settings.chatModelName = undefined;
			mockGenAI.models.generateContent.mockResolvedValue({
				candidates: [{ content: { parts: [{ text: 'answer' }] } }],
			});

			await runGroundingTool(mockPlugin, makeRequest());

			expect(mockGenAI.models.generateContent).toHaveBeenCalledWith(
				expect.objectContaining({ model: getDefaultModelForRole('chat') })
			);
		});

		it('substitutes the default chat model when the chat model is interactions-only', async () => {
			// Grounding runs on generateContent, which rejects interactions-only
			// models with a 400 — the runner must not send them.
			mockPlugin.settings.chatModelName = 'gemini-omni-flash-preview';
			mockGenAI.models.generateContent.mockResolvedValue({
				candidates: [{ content: { parts: [{ text: 'answer' }] } }],
			});

			await runGroundingTool(mockPlugin, makeRequest());

			expect(mockGenAI.models.generateContent).toHaveBeenCalledWith(
				expect.objectContaining({ model: getDefaultModelForRole('chat') })
			);
		});
	});

	describe('text extraction', () => {
		it('concatenates text from candidate parts', async () => {
			mockGenAI.models.generateContent.mockResolvedValue({
				candidates: [{ content: { parts: [{ text: 'Hello ' }, { text: 'world' }] } }],
			});

			const result = await runGroundingTool(mockPlugin, makeRequest());

			expect(result.success).toBe(true);
			expect(result.data.originalAnswer).toBe('Hello world');
			expect(result.data.answer).toBe('Hello world');
			expect(result.data.citations).toEqual([]);
			expect(result.data.searchGrounding).toBeUndefined();
		});

		it('falls back to result.text when candidates are missing', async () => {
			mockGenAI.models.generateContent.mockResolvedValue({ text: 'Fallback text' });

			const result = await runGroundingTool(mockPlugin, makeRequest());

			expect(result.success).toBe(true);
			expect(result.data.originalAnswer).toBe('Fallback text');
			expect(result.data.answer).toBe('Fallback text');
		});

		it('routes a throwing result.text getter into the outer catch', async () => {
			mockGenAI.models.generateContent.mockResolvedValue({
				get text() {
					throw new Error('Cannot access text');
				},
			});

			const result = await runGroundingTool(mockPlugin, makeRequest({ errorPrefix: 'Grounding failed: ' }));

			expect(result.success).toBe(false);
			expect(result.error).toBe('Grounding failed: Cannot access text');
		});
	});

	describe('citation extraction', () => {
		it('maps chunks to citations with title/snippet fallbacks and filters chunks without a URI', async () => {
			mockGenAI.models.generateContent.mockResolvedValue({
				candidates: [
					{
						content: { parts: [{ text: 'answer' }] },
						groundingMetadata: {
							groundingChunks: [
								{ web: { uri: 'https://a.com', title: 'A', snippet: 'Snippet A' } },
								{ web: { uri: 'https://b.com' } }, // no title/snippet → fallbacks
								{ web: {} }, // no URI → filtered
								{ notWeb: 'x' }, // no web property → filtered
							],
						},
					},
				],
			});

			const result = await runGroundingTool(mockPlugin, makeRequest());

			expect(result.success).toBe(true);
			expect(result.data.citations).toEqual([
				{ url: 'https://a.com', title: 'A', snippet: 'Snippet A' },
				{ url: 'https://b.com', title: 'https://b.com', snippet: '' },
			]);
		});

		it('reads citations through a maps-style accessor', async () => {
			mockGenAI.models.generateContent.mockResolvedValue({
				candidates: [
					{
						content: { parts: [{ text: 'answer' }] },
						groundingMetadata: {
							groundingChunks: [{ maps: { uri: 'https://maps/1', title: 'Place', text: 'Review text' } }],
						},
					},
				],
			});

			const mapsCitation = (chunk: GroundingChunk) => ({
				uri: chunk.maps?.uri,
				title: chunk.maps?.title,
				snippet: chunk.maps?.text,
			});

			const result = await runGroundingTool(mockPlugin, makeRequest({ getChunkCitation: mapsCitation }));

			expect(result.data.citations).toEqual([{ url: 'https://maps/1', title: 'Place', snippet: 'Review text' }]);
		});
	});

	describe('inline citation splicing', () => {
		it('inserts links at endIndex positions in descending order without shifting offsets', async () => {
			// "Hello world" (11 chars). Support at endIndex 5 → chunk 0, at 11 → chunk 1.
			mockGenAI.models.generateContent.mockResolvedValue({
				candidates: [
					{
						content: { parts: [{ text: 'Hello world' }] },
						groundingMetadata: {
							groundingChunks: [
								{ web: { uri: 'https://a.com', title: 'A' } },
								{ web: { uri: 'https://b.com', title: 'B' } },
							],
							groundingSupports: [
								{ segment: { endIndex: 5 }, groundingChunkIndices: [0] },
								{ segment: { endIndex: 11 }, groundingChunkIndices: [1] },
							],
						},
					},
				],
			});

			const result = await runGroundingTool(mockPlugin, makeRequest());

			expect(result.data.answer).toBe('Hello [1](https://a.com) world [2](https://b.com)');
			expect(result.data.originalAnswer).toBe('Hello world');
		});

		it('skips supports with a missing endIndex or empty groundingChunkIndices', async () => {
			mockGenAI.models.generateContent.mockResolvedValue({
				candidates: [
					{
						content: { parts: [{ text: 'Some text' }] },
						groundingMetadata: {
							groundingChunks: [{ web: { uri: 'https://a.com' } }],
							groundingSupports: [
								{ segment: {}, groundingChunkIndices: [0] }, // no endIndex
								{ segment: { endIndex: 9 } }, // no indices
								{ segment: { endIndex: 9 }, groundingChunkIndices: [] }, // empty indices
							],
						},
					},
				],
			});

			const result = await runGroundingTool(mockPlugin, makeRequest());

			expect(result.data.answer).toBe('Some text');
		});

		it('filters out citation links for chunk indices without a URI', async () => {
			mockGenAI.models.generateContent.mockResolvedValue({
				candidates: [
					{
						content: { parts: [{ text: 'Hello world' }] },
						groundingMetadata: {
							groundingChunks: [{ web: { uri: 'https://a.com' } }, { web: {} }],
							groundingSupports: [{ segment: { endIndex: 11 }, groundingChunkIndices: [0, 1] }],
						},
					},
				],
			});

			const result = await runGroundingTool(mockPlugin, makeRequest());

			expect(result.data.answer).toBe('Hello world [1](https://a.com)');
		});

		it('leaves text untouched when there are chunks but no supports', async () => {
			mockGenAI.models.generateContent.mockResolvedValue({
				candidates: [
					{
						content: { parts: [{ text: 'Just text' }] },
						groundingMetadata: {
							groundingChunks: [{ web: { uri: 'https://a.com', title: 'A' } }],
						},
					},
				],
			});

			const result = await runGroundingTool(mockPlugin, makeRequest());

			expect(result.data.answer).toBe('Just text');
			expect(result.data.citations).toEqual([{ url: 'https://a.com', title: 'A', snippet: '' }]);
		});
	});

	describe('error handling', () => {
		it('prefixes an Error message with errorPrefix via getRawErrorMessage', async () => {
			mockGenAI.models.generateContent.mockRejectedValue(new Error('API rate limit exceeded'));

			const result = await runGroundingTool(mockPlugin, makeRequest({ errorPrefix: 'Google search failed: ' }));

			expect(result.success).toBe(false);
			expect(result.error).toBe('Google search failed: API rate limit exceeded');
		});

		it('stringifies a non-Error thrown value via getRawErrorMessage', async () => {
			mockGenAI.models.generateContent.mockRejectedValue('boom');

			const result = await runGroundingTool(mockPlugin, makeRequest({ errorPrefix: 'Google Maps lookup failed: ' }));

			expect(result.success).toBe(false);
			expect(result.error).toBe('Google Maps lookup failed: boom');
		});
	});
});
