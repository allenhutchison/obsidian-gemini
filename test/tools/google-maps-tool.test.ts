import type { Mock } from 'vitest';
import { GoogleMapsTool, getGoogleMapsTool } from '../../src/tools/google-maps-tool';
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

describe('GoogleMapsTool', () => {
	let tool: GoogleMapsTool;
	let mockContext: ToolExecutionContext;
	let mockGenAI: any;

	beforeEach(() => {
		vi.clearAllMocks();

		tool = new GoogleMapsTool();

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
			expect(tool.name).toBe('google_maps');
			expect(tool.category).toBe('read_only');
			expect(tool.description).toContain('Google Maps');
		});

		it('should have correct parameters schema', () => {
			expect(tool.parameters).toEqual({
				type: 'object',
				properties: {
					query: {
						type: 'string',
						description:
							'The place or location question to answer with Google Maps. Include a location for best results.',
					},
				},
				required: ['query'],
			});
		});
	});

	describe('execute', () => {
		it('should perform a maps lookup successfully', async () => {
			const mockResponse = {
				candidates: [
					{
						content: {
							parts: [
								{
									text: 'Here are some coffee shops near you...',
								},
							],
						},
						groundingMetadata: {
							googleMapsWidgetContextToken: 'token-123',
						},
					},
				],
			};

			mockGenAI.models.generateContent.mockResolvedValue(mockResponse);

			const result = await tool.execute({ query: 'coffee near me' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data).toEqual({
				query: 'coffee near me',
				answer: 'Here are some coffee shops near you...',
				originalAnswer: 'Here are some coffee shops near you...',
				citations: [],
				searchGrounding: {
					googleMapsWidgetContextToken: 'token-123',
				},
			});

			// Verify API call was made with maps grounding
			expect(mockGenAI.models.generateContent).toHaveBeenCalledWith({
				model: 'gemini-1.5-flash-002',
				config: {
					temperature: 0.7,
					maxOutputTokens: 8192,
					tools: [{ googleMaps: {} }],
				},
				contents: expect.stringContaining('coffee near me'),
			});
		});

		it('should handle a lookup without grounding metadata', async () => {
			const mockResponse = {
				candidates: [
					{
						content: {
							parts: [
								{
									text: 'Basic response without metadata',
								},
							],
						},
					},
				],
			};

			mockGenAI.models.generateContent.mockResolvedValue(mockResponse);

			const result = await tool.execute({ query: 'where is the Eiffel Tower' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data).toEqual({
				query: 'where is the Eiffel Tower',
				answer: 'Basic response without metadata',
				originalAnswer: 'Basic response without metadata',
				citations: [],
				searchGrounding: undefined,
			});
		});

		it('should return error when API key is missing', async () => {
			(mockContext.plugin as any).apiKey = '';

			const result = await tool.execute({ query: 'test' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toBe('Google API key not configured');
			expect(mockGenAI.models.generateContent).not.toHaveBeenCalled();
		});

		it('should handle API errors gracefully', async () => {
			mockGenAI.models.generateContent.mockRejectedValue(new Error('API rate limit exceeded'));

			const result = await tool.execute({ query: 'test' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toBe('Google Maps lookup failed: API rate limit exceeded');
		});

		it('should use default model when not specified', async () => {
			(mockContext.plugin as any).settings.chatModelName = undefined;

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

	describe('getGoogleMapsTool', () => {
		it('should return a GoogleMapsTool instance', () => {
			const tool = getGoogleMapsTool();
			expect(tool).toBeInstanceOf(GoogleMapsTool);
			expect(tool.name).toBe('google_maps');
		});
	});

	describe('citation extraction from maps groundingChunks', () => {
		it('should populate citations array with url, title, and snippet from maps chunks', async () => {
			const mockResponse = {
				candidates: [
					{
						content: {
							parts: [{ text: 'Maps answer text' }],
						},
						groundingMetadata: {
							groundingChunks: [
								{
									maps: {
										uri: 'https://maps.google.com/?cid=1',
										title: 'Blue Bottle Coffee',
										text: 'Great espresso and pastries',
									},
								},
								{
									maps: {
										uri: 'https://maps.google.com/?cid=2',
										title: 'Sightglass Coffee',
										text: 'Spacious roastery cafe',
									},
								},
							],
						},
					},
				],
			};

			mockGenAI.models.generateContent.mockResolvedValue(mockResponse);

			const result = await tool.execute({ query: 'coffee in SF' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data.citations).toEqual([
				{
					url: 'https://maps.google.com/?cid=1',
					title: 'Blue Bottle Coffee',
					snippet: 'Great espresso and pastries',
				},
				{
					url: 'https://maps.google.com/?cid=2',
					title: 'Sightglass Coffee',
					snippet: 'Spacious roastery cafe',
				},
			]);
		});

		it('should fallback title to uri when chunk.maps.title is undefined', async () => {
			const mockResponse = {
				candidates: [
					{
						content: {
							parts: [{ text: 'Answer text' }],
						},
						groundingMetadata: {
							groundingChunks: [
								{
									maps: {
										uri: 'https://maps.google.com/?cid=no-title',
										// title is undefined
										text: 'Some place answer',
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
			expect(result.data.citations[0].title).toBe('https://maps.google.com/?cid=no-title');
		});

		it('should use empty string for snippet when chunk.maps.text is undefined', async () => {
			const mockResponse = {
				candidates: [
					{
						content: {
							parts: [{ text: 'Answer text' }],
						},
						groundingMetadata: {
							groundingChunks: [
								{
									maps: {
										uri: 'https://maps.google.com/?cid=3',
										title: 'Place Title',
										// text is undefined
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

		it('should filter out chunks without a maps URI', async () => {
			const mockResponse = {
				candidates: [
					{
						content: {
							parts: [{ text: 'Answer' }],
						},
						groundingMetadata: {
							groundingChunks: [
								{ maps: { uri: 'https://maps.google.com/?cid=valid' } },
								{ maps: {} }, // no URI
								{ web: { uri: 'https://example.com' } }, // web chunk, not maps
							],
						},
					},
				],
			};

			mockGenAI.models.generateContent.mockResolvedValue(mockResponse);

			const result = await tool.execute({ query: 'test' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data.citations).toHaveLength(1);
			expect(result.data.citations[0].url).toBe('https://maps.google.com/?cid=valid');
		});
	});

	describe('inline citation insertion from groundingSupports', () => {
		it('should insert citations at correct endIndex positions', async () => {
			const mockResponse = {
				candidates: [
					{
						content: {
							parts: [{ text: 'Hello world' }],
						},
						groundingMetadata: {
							groundingChunks: [
								{ maps: { uri: 'https://maps.google.com/a', title: 'Place A' } },
								{ maps: { uri: 'https://maps.google.com/b', title: 'Place B' } },
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
			expect(result.data.answer).toBe('Hello [1](https://maps.google.com/a) world [2](https://maps.google.com/b)');
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
							groundingChunks: [{ maps: { uri: 'https://maps.google.com/a', title: 'Place A' } }],
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
			expect(result.data.answer).toBe('Some text here');
		});

		it('should filter out citation links when a chunk has no URI', async () => {
			const mockResponse = {
				candidates: [
					{
						content: {
							parts: [{ text: 'Hello world' }],
						},
						groundingMetadata: {
							groundingChunks: [
								{ maps: { uri: 'https://maps.google.com/a' } },
								{ maps: {} }, // chunk without URI
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
			expect(result.data.answer).toBe('Hello world [1](https://maps.google.com/a)');
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
	});

	describe('getProgressDescription', () => {
		it('should return full query when shorter than 30 chars', () => {
			const desc = tool.getProgressDescription({ query: 'pizza nearby' });
			expect(desc).toBe('Searching Maps for "pizza nearby"');
		});

		it('should truncate query longer than 30 chars with ellipsis', () => {
			const longQuery = 'best ramen restaurants in the entire bay area';
			const desc = tool.getProgressDescription({ query: longQuery });
			expect(desc).toBe(`Searching Maps for "${longQuery.substring(0, 27)}..."`);
			expect(desc).toContain('...');
		});

		it('should return generic message for empty query', () => {
			const desc = tool.getProgressDescription({ query: '' });
			expect(desc).toBe('Searching Google Maps');
		});
	});

	describe('non-Error thrown by API', () => {
		it('should stringify a non-Error thrown value via getRawErrorMessage', async () => {
			mockGenAI.models.generateContent.mockRejectedValue('string error');

			const result = await tool.execute({ query: 'test' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toBe('Google Maps lookup failed: string error');
		});
	});
});
