import { GoogleSearchTool, getGoogleSearchTool } from '../../src/tools/google-search-tool';
import { ToolExecutionContext } from '../../src/tools/types';
import { GoogleGenAI } from '@google/genai';
import { getDefaultModelForRole } from '../../src/models';

// Mock Google Gen AI
jest.mock('@google/genai', () => ({
	GoogleGenAI: jest.fn()
}));

describe('GoogleSearchTool', () => {
	let tool: GoogleSearchTool;
	let mockContext: ToolExecutionContext;
	let mockModel: any;
	let mockGenAI: any;

	beforeEach(() => {
		jest.clearAllMocks();
		
		tool = new GoogleSearchTool();
		
		// Mock genAI methods
		mockGenAI = {
			models: {
				generateContent: jest.fn()
			}
		};
		
		// Mock GoogleGenAI constructor
		(GoogleGenAI as jest.Mock).mockImplementation(() => mockGenAI);
		
		// Mock context
		mockContext = {
			plugin: {
				settings: {
					apiKey: 'test-api-key',
					chatModelName: 'gemini-1.5-flash-002',
					temperature: 0.7
				}
			},
			session: {
				id: 'test-session',
				type: 'agent-session',
				context: {
					contextFiles: [],
					contextDepth: 2,
					enabledTools: [],
					requireConfirmation: []
				}
			}
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
						description: 'The search query to send to Google'
					}
				},
				required: ['query']
			});
		});
	});

	describe('execute', () => {
		it('should perform search successfully', async () => {
			const mockResponse = {
				candidates: [{
					content: {
						parts: [{
							text: 'Here are the search results for your query...'
						}]
					},
					groundingMetadata: {
						webSearchQueries: ['test query'],
						groundingAttributions: [
							{ uri: 'https://example.com', content: 'Example content' }
						]
					}
				}]
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
					groundingAttributions: [
						{ uri: 'https://example.com', content: 'Example content' }
					]
				}
			});

			// Verify API call was made with search grounding
			expect(mockGenAI.models.generateContent).toHaveBeenCalledWith({
				model: 'gemini-1.5-flash-002',
				config: {
					temperature: 0.7,
					maxOutputTokens: 8192,
					tools: [{ googleSearch: {} }]
				},
				contents: expect.stringContaining('test query')
			});
		});

		it('should handle search without grounding metadata', async () => {
			const mockResponse = {
				candidates: [{
					content: {
						parts: [{
							text: 'Basic search response without metadata'
						}]
					}
				}]
			};
			
			mockGenAI.models.generateContent.mockResolvedValue(mockResponse);

			const result = await tool.execute({ query: 'another query' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data).toEqual({
				query: 'another query',
				answer: 'Basic search response without metadata',
				originalAnswer: 'Basic search response without metadata',
				citations: [],
				searchGrounding: undefined
			});
		});

		it('should return error when API key is missing', async () => {
			mockContext.plugin.settings.apiKey = '';

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
				candidates: [{
					content: {
						parts: [{
							text: 'Response with default model'
						}]
					}
				}]
			};
			
			mockGenAI.models.generateContent.mockResolvedValue(mockResponse);

			await tool.execute({ query: 'test' }, mockContext);

			expect(mockGenAI.models.generateContent).toHaveBeenCalledWith(
				expect.objectContaining({
					model: getDefaultModelForRole('chat')
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
});