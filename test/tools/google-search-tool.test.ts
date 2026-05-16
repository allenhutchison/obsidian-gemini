import type { Mock } from 'vitest';
import { GoogleSearchTool, getGoogleSearchTool } from '../../src/tools/google-search-tool';
import { ToolExecutionContext } from '../../src/tools/types';
import { GoogleGenAI } from '@google/genai';
import { getDefaultModelForRole } from '../../src/models';

// Mock Google Gen AI
vi.mock('@google/genai', () => ({
	GoogleGenAI: vi.fn(),
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

describe('GoogleSearchTool', () => {
	let tool: GoogleSearchTool;
	let mockContext: ToolExecutionContext;
	let mockGenAI: any;

	beforeEach(() => {
		vi.clearAllMocks();

		tool = new GoogleSearchTool();

		// Mock genAI methods
		mockGenAI = {
			models: {
				generateContent: vi.fn(),
			},
		};

		// Mock GoogleGenAI constructor
		(GoogleGenAI as Mock).mockImplementation(function () {
			return mockGenAI;
		});

		// Mock context
		mockContext = {
			plugin: {
				apiKey: 'test-api-key',
				settings: {
					chatModelName: 'gemini-1.5-flash-002',
					temperature: 0.7,
				},
			},
			session: {
				id: 'test-session',
				type: 'agent-session',
				context: {
					contextFiles: [],
					contextDepth: 2,
					enabledTools: [],
					requireConfirmation: [],
				},
			},
		} as any;
	});

	describe('basic properties', () => {
		it('should have correct name and category', () => {
			expect(tool.name).toBe('google_search');
			expect(tool.category).toBe('read_only');
			expect(tool.description).toContain('Search Google');
		});

		it('should have correct parameters schema', () => {
			expect(tool.parameters).toEqual({
				type: 'object',
				properties: {
					query: {
						type: 'string',
						description: 'The search query to send to Google',
					},
				},
				required: ['query'],
			});
		});
	});

	describe('execute', () => {
		it('should perform search successfully', async () => {
			const mockResponse = {
				candidates: [
					{
						content: {
							parts: [
								{
									text: 'Here are the search results for your query...',
								},
							],
						},
						groundingMetadata: {
							webSearchQueries: ['test query'],
							groundingAttributions: [{ uri: 'https://example.com', content: 'Example content' }],
						},
					},
				],
			};

			mockGenAI.models.generateContent.mockResolvedValue(mockResponse);

			const result = await tool.execute({ query: 'test query' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data).toEqual({
				query: 'test query',
				answer: 'Here are the search results for your query...',
				originalAnswer: 'Here are the search results for your query...',
				citations: [],
				searchGrounding: {
					webSearchQueries: ['test query'],
					groundingAttributions: [{ uri: 'https://example.com', content: 'Example content' }],
				},
			});

			// Verify API call was made with search grounding
			expect(mockGenAI.models.generateContent).toHaveBeenCalledWith({
				model: 'gemini-1.5-flash-002',
				config: {
					temperature: 0.7,
					maxOutputTokens: 8192,
					tools: [{ googleSearch: {} }],
				},
				contents: expect.stringContaining('test query'),
			});
		});

		it('should handle search without grounding metadata', async () => {
			const mockResponse = {
				candidates: [
					{
						content: {
							parts: [
								{
									text: 'Basic search response without metadata',
								},
							],
						},
					},
				],
			};

			mockGenAI.models.generateContent.mockResolvedValue(mockResponse);

			const result = await tool.execute({ query: 'another query' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data).toEqual({
				query: 'another query',
				answer: 'Basic search response without metadata',
				originalAnswer: 'Basic search response without metadata',
				citations: [],
				searchGrounding: undefined,
			});
		});

		it('should return error when API key is missing', async () => {
			mockContext.plugin.apiKey = '';

			const result = await tool.execute({ query: 'test' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toBe('Google API key not configured');
			expect(mockGenAI.models.generateContent).not.toHaveBeenCalled();
		});

		it('should handle API errors gracefully', async () => {
			mockGenAI.models.generateContent.mockRejectedValue(new Error('API rate limit exceeded'));

			const result = await tool.execute({ query: 'test' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toBe('Google search failed: API rate limit exceeded');
		});

		it('should use default model when not specified', async () => {
			mockContext.plugin.settings.chatModelName = undefined;

			const mockResponse = {
				candidates: [
					{
						content: {
							parts: [
								{
									text: 'Response with default model',
								},
							],
						},
					},
				],
			};

			mockGenAI.models.generateContent.mockResolvedValue(mockResponse);

			await tool.execute({ query: 'test' }, mockContext);

			expect(mockGenAI.models.generateContent).toHaveBeenCalledWith(
				expect.objectContaining({
					model: getDefaultModelForRole('chat'),
				})
			);
		});
	});

	describe('getGoogleSearchTool', () => {
		it('should return a GoogleSearchTool instance', () => {
			const tool = getGoogleSearchTool();
			expect(tool).toBeInstanceOf(GoogleSearchTool);
			expect(tool.name).toBe('google_search');
		});
	});

	describe('citation extraction from groundingChunks', () => {
		it('should populate citations array with url, title, and snippet', async () => {
			const mockResponse = {
				candidates: [
					{
						content: {
							parts: [{ text: 'Search answer text' }],
						},
						groundingMetadata: {
							groundingChunks: [
								{
									web: {
										uri: 'https://example.com/page1',
										title: 'Example Page 1',
										snippet: 'Snippet for page 1',
									},
								},
								{
									web: {
										uri: 'https://example.com/page2',
										title: 'Example Page 2',
										snippet: 'Snippet for page 2',
									},
								},
							],
						},
					},
				],
			};

			mockGenAI.models.generateContent.mockResolvedValue(mockResponse);

			const result = await tool.execute({ query: 'test' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data.citations).toEqual([
				{ url: 'https://example.com/page1', title: 'Example Page 1', snippet: 'Snippet for page 1' },
				{ url: 'https://example.com/page2', title: 'Example Page 2', snippet: 'Snippet for page 2' },
			]);
		});

		it('should fallback title to uri when chunk.web.title is undefined', async () => {
			const mockResponse = {
				candidates: [
					{
						content: {
							parts: [{ text: 'Answer text' }],
						},
						groundingMetadata: {
							groundingChunks: [
								{
									web: {
										uri: 'https://example.com/no-title',
										// title is undefined
										snippet: 'Some snippet',
									},
								},
							],
						},
					},
				],
			};

			mockGenAI.models.generateContent.mockResolvedValue(mockResponse);

			const result = await tool.execute({ query: 'test' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data.citations[0].title).toBe('https://example.com/no-title');
		});

		it('should use empty string for snippet when chunk.web.snippet is undefined', async () => {
			const mockResponse = {
				candidates: [
					{
						content: {
							parts: [{ text: 'Answer text' }],
						},
						groundingMetadata: {
							groundingChunks: [
								{
									web: {
										uri: 'https://example.com/page',
										title: 'Page Title',
										// snippet is undefined
									},
								},
							],
						},
					},
				],
			};

			mockGenAI.models.generateContent.mockResolvedValue(mockResponse);

			const result = await tool.execute({ query: 'test' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data.citations[0].snippet).toBe('');
		});

		it('should filter out chunks without web URI', async () => {
			const mockResponse = {
				candidates: [
					{
						content: {
							parts: [{ text: 'Answer' }],
						},
						groundingMetadata: {
							groundingChunks: [
								{ web: { uri: 'https://example.com/valid' } },
								{ web: {} }, // no URI
								{ notWeb: 'something' }, // no web property
							],
						},
					},
				],
			};

			mockGenAI.models.generateContent.mockResolvedValue(mockResponse);

			const result = await tool.execute({ query: 'test' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data.citations).toHaveLength(1);
			expect(result.data.citations[0].url).toBe('https://example.com/valid');
		});
	});

	describe('inline citation insertion from groundingSupports', () => {
		it('should insert citations at correct endIndex positions', async () => {
			// "Hello world" = 11 chars. Insert citation at index 5 ("Hello") and 11 ("Hello world")
			// Processing in descending order: index 11 first, then 5.
			const mockResponse = {
				candidates: [
					{
						content: {
							parts: [{ text: 'Hello world' }],
						},
						groundingMetadata: {
							groundingChunks: [
								{ web: { uri: 'https://a.com', title: 'Source A' } },
								{ web: { uri: 'https://b.com', title: 'Source B' } },
							],
							groundingSupports: [
								{
									segment: { endIndex: 5 },
									groundingChunkIndices: [0],
								},
								{
									segment: { endIndex: 11 },
									groundingChunkIndices: [1],
								},
							],
						},
					},
				],
			};

			mockGenAI.models.generateContent.mockResolvedValue(mockResponse);

			const result = await tool.execute({ query: 'test' }, mockContext);

			expect(result.success).toBe(true);
			// Citations inserted from end: "Hello world" → at 11: " [2](https://b.com)" → at 5: " [1](https://a.com)"
			expect(result.data.answer).toBe('Hello [1](https://a.com) world [2](https://b.com)');
			expect(result.data.originalAnswer).toBe('Hello world');
		});

		it('should skip supports with missing endIndex', async () => {
			const mockResponse = {
				candidates: [
					{
						content: {
							parts: [{ text: 'Some text here' }],
						},
						groundingMetadata: {
							groundingChunks: [{ web: { uri: 'https://a.com', title: 'Source A' } }],
							groundingSupports: [
								{
									segment: {}, // no endIndex
									groundingChunkIndices: [0],
								},
								{
									// no segment at all
									groundingChunkIndices: [0],
								},
							],
						},
					},
				],
			};

			mockGenAI.models.generateContent.mockResolvedValue(mockResponse);

			const result = await tool.execute({ query: 'test' }, mockContext);

			expect(result.success).toBe(true);
			// No inline citations should be inserted
			expect(result.data.answer).toBe('Some text here');
		});

		it('should skip supports with missing groundingChunkIndices', async () => {
			const mockResponse = {
				candidates: [
					{
						content: {
							parts: [{ text: 'Some text' }],
						},
						groundingMetadata: {
							groundingChunks: [{ web: { uri: 'https://a.com', title: 'Source A' } }],
							groundingSupports: [
								{
									segment: { endIndex: 9 },
									// no groundingChunkIndices
								},
								{
									segment: { endIndex: 9 },
									groundingChunkIndices: [], // empty array
								},
							],
						},
					},
				],
			};

			mockGenAI.models.generateContent.mockResolvedValue(mockResponse);

			const result = await tool.execute({ query: 'test' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data.answer).toBe('Some text');
		});

		it('should filter out citation links when chunk has no URI', async () => {
			const mockResponse = {
				candidates: [
					{
						content: {
							parts: [{ text: 'Hello world' }],
						},
						groundingMetadata: {
							groundingChunks: [
								{ web: { uri: 'https://a.com' } },
								{ web: {} }, // chunk without URI
							],
							groundingSupports: [
								{
									segment: { endIndex: 11 },
									groundingChunkIndices: [0, 1], // index 1 has no URI
								},
							],
						},
					},
				],
			};

			mockGenAI.models.generateContent.mockResolvedValue(mockResponse);

			const result = await tool.execute({ query: 'test' }, mockContext);

			expect(result.success).toBe(true);
			// Only chunk 0 should produce a citation link; chunk 1 (no URI) is filtered
			expect(result.data.answer).toBe('Hello world [1](https://a.com)');
		});
	});

	describe('result.text fallback path', () => {
		it('should extract text from result.text when candidates is missing', async () => {
			const mockResponse = {
				// no candidates
				text: 'Fallback text from result.text',
			};

			mockGenAI.models.generateContent.mockResolvedValue(mockResponse);

			const result = await tool.execute({ query: 'test' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data.originalAnswer).toBe('Fallback text from result.text');
			expect(result.data.answer).toBe('Fallback text from result.text');
		});

		it('should catch and log error when result.text getter throws inside fallback', async () => {
			// The `if (result.text)` check on line 80 of the source evaluates the getter.
			// If it doesn't throw there but throws inside the try block, the inner
			// catch handles it. However, when the getter always throws, the conditional
			// itself triggers the outer catch (line 149), resulting in success: false.
			const mockResponse = {
				// no candidates
				get text() {
					throw new Error('Cannot access text');
				},
			};

			mockGenAI.models.generateContent.mockResolvedValue(mockResponse);

			const result = await tool.execute({ query: 'test' }, mockContext);

			// The getter throw is caught by the outer try/catch
			expect(result.success).toBe(false);
			expect(result.error).toBe('Google search failed: Cannot access text');
		});
	});

	describe('getProgressDescription', () => {
		it('should return full query when shorter than 30 chars', () => {
			const desc = tool.getProgressDescription({ query: 'short query' });
			expect(desc).toBe('Searching Google for "short query"');
		});

		it('should truncate query longer than 30 chars with ellipsis', () => {
			const longQuery = 'this is a very long query that exceeds the limit';
			const desc = tool.getProgressDescription({ query: longQuery });
			// First 27 chars + '...'
			expect(desc).toBe(`Searching Google for "${longQuery.substring(0, 27)}..."`);
			expect(desc).toContain('...');
		});

		it('should return generic message for empty query', () => {
			const desc = tool.getProgressDescription({ query: '' });
			expect(desc).toBe('Searching Google');
		});

		it('should return generic message for undefined query', () => {
			const desc = tool.getProgressDescription({ query: undefined } as any);
			expect(desc).toBe('Searching Google');
		});
	});

	describe('non-Error thrown by API', () => {
		it('should include Unknown error for non-Error thrown', async () => {
			mockGenAI.models.generateContent.mockRejectedValue('string error');

			const result = await tool.execute({ query: 'test' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toBe('Google search failed: Unknown error');
		});

		it('should include Unknown error for number thrown', async () => {
			mockGenAI.models.generateContent.mockRejectedValue(42);

			const result = await tool.execute({ query: 'test' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toBe('Google search failed: Unknown error');
		});
	});
});
