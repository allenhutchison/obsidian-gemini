import { RagSearchTool, getRagTools } from '../../src/tools/rag-search-tool';
import { ToolExecutionContext } from '../../src/tools/types';

describe('RagSearchTool', () => {
	let tool: RagSearchTool;
	let mockContext: ToolExecutionContext;

	beforeEach(() => {
		jest.clearAllMocks();
		tool = new RagSearchTool();

		// Mock context with RAG indexing disabled by default
		mockContext = {
			plugin: {
				settings: {
					apiKey: 'test-api-key',
					chatModelName: 'gemini-1.5-flash-002',
					ragIndexing: {
						enabled: false,
					},
				},
				ragIndexing: null,
				logger: {
					log: jest.fn(),
					debug: jest.fn(),
					error: jest.fn(),
					warn: jest.fn(),
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
			expect(tool.name).toBe('vault_semantic_search');
			expect(tool.displayName).toBe('Semantic Vault Search');
			expect(tool.category).toBe('read_only');
			expect(tool.description).toContain('semantic search');
			expect(tool.description).toContain('filter by folder path or tags');
		});

		it('should have correct parameters schema', () => {
			expect(tool.parameters).toEqual({
				type: 'object',
				properties: {
					query: {
						type: 'string',
						description: 'The search query. Can be a question, topic, or concept to search for.',
					},
					maxResults: {
						type: 'number',
						description: 'Maximum number of results to return (default: 5, max: 20)',
					},
					folder: {
						type: 'string',
						description: 'Limit search to files in this folder path (e.g., "projects" or "projects/2024")',
					},
					tags: {
						type: 'array',
						items: { type: 'string' },
						description: 'Filter by tags. Multiple tags use OR logic (matches any tag).',
					},
				},
				required: ['query'],
			});
		});
	});

	describe('escapeFilterValue', () => {
		// Access private method for testing
		const escapeValue = (value: string) => {
			return (tool as any).escapeFilterValue(value);
		};

		it('should return unchanged string when no special characters', () => {
			expect(escapeValue('projects')).toBe('projects');
			expect(escapeValue('folder/subfolder')).toBe('folder/subfolder');
			expect(escapeValue('my-tag')).toBe('my-tag');
		});

		it('should escape double quotes', () => {
			expect(escapeValue('test"value')).toBe('test\\"value');
			expect(escapeValue('"quoted"')).toBe('\\"quoted\\"');
		});

		it('should escape backslashes', () => {
			expect(escapeValue('path\\to\\folder')).toBe('path\\\\to\\\\folder');
			expect(escapeValue('single\\')).toBe('single\\\\');
		});

		it('should escape backslashes before quotes (correct order)', () => {
			// Backslash followed by quote should become \\" not \"
			expect(escapeValue('test\\"value')).toBe('test\\\\\\"value');
		});

		it('should handle malicious injection payloads', () => {
			// Attempt to break out of quoted string and inject OR condition
			expect(escapeValue('projects" OR folder="hack')).toBe('projects\\" OR folder=\\"hack');
			// Attempt to inject with backslash escape
			expect(escapeValue('projects\\" OR folder="hack')).toBe('projects\\\\\\" OR folder=\\"hack');
		});
	});

	describe('buildMetadataFilter', () => {
		// Access private method for testing
		const buildFilter = (folder?: string, tags?: string[]) => {
			return (tool as any).buildMetadataFilter(folder, tags);
		};

		it('should return undefined when no filters are provided', () => {
			expect(buildFilter()).toBeUndefined();
			expect(buildFilter(undefined, undefined)).toBeUndefined();
			expect(buildFilter('', [])).toBeUndefined();
		});

		it('should build filter for folder only', () => {
			expect(buildFilter('projects')).toBe('folder="projects"');
			expect(buildFilter('projects/2024')).toBe('folder="projects/2024"');
		});

		it('should trim whitespace from folder', () => {
			expect(buildFilter('  projects  ')).toBe('folder="projects"');
		});

		it('should ignore empty folder strings', () => {
			expect(buildFilter('')).toBeUndefined();
			expect(buildFilter('   ')).toBeUndefined();
		});

		it('should build filter for single tag', () => {
			expect(buildFilter(undefined, ['architecture'])).toBe('tags="architecture"');
		});

		it('should build filter for multiple tags with OR logic', () => {
			expect(buildFilter(undefined, ['architecture', 'design'])).toBe('(tags="architecture" OR tags="design")');
			expect(buildFilter(undefined, ['a', 'b', 'c'])).toBe('(tags="a" OR tags="b" OR tags="c")');
		});

		it('should trim whitespace from tags', () => {
			expect(buildFilter(undefined, ['  architecture  '])).toBe('tags="architecture"');
			expect(buildFilter(undefined, ['  a  ', '  b  '])).toBe('(tags="a" OR tags="b")');
		});

		it('should filter out empty tags', () => {
			expect(buildFilter(undefined, ['', 'architecture', ''])).toBe('tags="architecture"');
			expect(buildFilter(undefined, ['', '', ''])).toBeUndefined();
			expect(buildFilter(undefined, ['  ', 'design', '  '])).toBe('tags="design"');
		});

		it('should combine folder and tags with AND', () => {
			expect(buildFilter('projects', ['architecture'])).toBe('folder="projects" AND tags="architecture"');
		});

		it('should combine folder and multiple tags correctly', () => {
			expect(buildFilter('projects', ['architecture', 'design'])).toBe(
				'folder="projects" AND (tags="architecture" OR tags="design")'
			);
		});

		it('should handle folder with empty tags array', () => {
			expect(buildFilter('projects', [])).toBe('folder="projects"');
		});

		it('should handle empty folder with valid tags', () => {
			expect(buildFilter('', ['architecture'])).toBe('tags="architecture"');
		});

		it('should escape quotes in folder to prevent injection', () => {
			// Malicious folder trying to inject additional conditions
			expect(buildFilter('projects" OR folder="hack')).toBe('folder="projects\\" OR folder=\\"hack"');
		});

		it('should escape quotes in tags to prevent injection', () => {
			// Malicious tag trying to inject additional conditions
			expect(buildFilter(undefined, ['tag" OR tags="hack'])).toBe('tags="tag\\" OR tags=\\"hack"');
		});

		it('should escape backslashes in folder', () => {
			expect(buildFilter('path\\to\\folder')).toBe('folder="path\\\\to\\\\folder"');
		});

		it('should escape backslashes in tags', () => {
			expect(buildFilter(undefined, ['tag\\with\\backslash'])).toBe('tags="tag\\\\with\\\\backslash"');
		});

		it('should handle combined injection attempt with folder and tags', () => {
			expect(buildFilter('projects" OR 1=1 --', ['tag" OR 1=1 --'])).toBe(
				'folder="projects\\" OR 1=1 --" AND tags="tag\\" OR 1=1 --"'
			);
		});
	});

	describe('getProgressDescription', () => {
		it('should return progress description with query', () => {
			expect(tool.getProgressDescription({ query: 'test query' })).toBe('Searching vault for "test query"');
		});

		it('should truncate long queries', () => {
			const longQuery = 'a'.repeat(60);
			const description = tool.getProgressDescription({ query: longQuery });
			expect(description).toBe('Searching vault for "' + 'a'.repeat(47) + '..."');
		});
	});

	describe('execute validation', () => {
		it('should return error when query is empty', async () => {
			const result = await tool.execute({ query: '' }, mockContext);
			expect(result.success).toBe(false);
			expect(result.error).toBe('Query is required and must be a non-empty string');
		});

		it('should return error when query is whitespace only', async () => {
			const result = await tool.execute({ query: '   ' }, mockContext);
			expect(result.success).toBe(false);
			expect(result.error).toBe('Query is required and must be a non-empty string');
		});

		it('should return error when RAG indexing is disabled', async () => {
			const result = await tool.execute({ query: 'test' }, mockContext);
			expect(result.success).toBe(false);
			expect(result.error).toBe('RAG indexing is not enabled. Enable it in settings to use semantic search.');
		});

		it('should return error when RAG service is not ready', async () => {
			mockContext.plugin.settings.ragIndexing.enabled = true;
			mockContext.plugin.ragIndexing = {
				isReady: () => false,
				getStoreName: () => null,
				getClient: () => null,
			};

			const result = await tool.execute({ query: 'test' }, mockContext);
			expect(result.success).toBe(false);
			expect(result.error).toBe('RAG indexing service is not ready. Please wait for initialization to complete.');
		});

		it('should return error when no store is configured', async () => {
			mockContext.plugin.settings.ragIndexing.enabled = true;
			mockContext.plugin.ragIndexing = {
				isReady: () => true,
				getStoreName: () => null,
				getClient: () => null,
			};

			const result = await tool.execute({ query: 'test' }, mockContext);
			expect(result.success).toBe(false);
			expect(result.error).toBe('No File Search Store configured. Please reindex your vault.');
		});

		it('should return error when API client is not available', async () => {
			mockContext.plugin.settings.ragIndexing.enabled = true;
			mockContext.plugin.ragIndexing = {
				isReady: () => true,
				getStoreName: () => 'test-store',
				getClient: () => null,
			};

			const result = await tool.execute({ query: 'test' }, mockContext);
			expect(result.success).toBe(false);
			expect(result.error).toBe('RAG API client not available. Please wait for service initialization.');
		});
	});

	describe('execute with filters', () => {
		let mockAi: any;

		beforeEach(() => {
			mockAi = {
				models: {
					generateContent: jest.fn(),
				},
			};

			mockContext.plugin.settings.ragIndexing.enabled = true;
			mockContext.plugin.ragIndexing = {
				isReady: () => true,
				getStoreName: () => 'test-store',
				getClient: () => mockAi,
			};
		});

		it('should execute search without filters', async () => {
			mockAi.models.generateContent.mockResolvedValue({
				text: 'Search results',
				candidates: [{ groundingMetadata: { groundingChunks: [] } }],
			});

			await tool.execute({ query: 'test' }, mockContext);

			expect(mockAi.models.generateContent).toHaveBeenCalledWith({
				model: 'gemini-1.5-flash-002',
				contents: expect.stringContaining('test'),
				config: {
					tools: [
						{
							fileSearch: {
								fileSearchStoreNames: ['test-store'],
							},
						},
					],
				},
			});
		});

		it('should execute search with folder filter', async () => {
			mockAi.models.generateContent.mockResolvedValue({
				text: 'Search results',
				candidates: [{ groundingMetadata: { groundingChunks: [] } }],
			});

			await tool.execute({ query: 'test', folder: 'projects' }, mockContext);

			expect(mockAi.models.generateContent).toHaveBeenCalledWith({
				model: 'gemini-1.5-flash-002',
				contents: expect.stringContaining('test'),
				config: {
					tools: [
						{
							fileSearch: {
								fileSearchStoreNames: ['test-store'],
								metadataFilter: 'folder="projects"',
							},
						},
					],
				},
			});
		});

		it('should execute search with tags filter', async () => {
			mockAi.models.generateContent.mockResolvedValue({
				text: 'Search results',
				candidates: [{ groundingMetadata: { groundingChunks: [] } }],
			});

			await tool.execute({ query: 'test', tags: ['architecture', 'design'] }, mockContext);

			expect(mockAi.models.generateContent).toHaveBeenCalledWith({
				model: 'gemini-1.5-flash-002',
				contents: expect.stringContaining('test'),
				config: {
					tools: [
						{
							fileSearch: {
								fileSearchStoreNames: ['test-store'],
								metadataFilter: '(tags="architecture" OR tags="design")',
							},
						},
					],
				},
			});
		});

		it('should execute search with folder and tags filters', async () => {
			mockAi.models.generateContent.mockResolvedValue({
				text: 'Search results',
				candidates: [{ groundingMetadata: { groundingChunks: [] } }],
			});

			await tool.execute({ query: 'test', folder: 'projects', tags: ['architecture'] }, mockContext);

			expect(mockAi.models.generateContent).toHaveBeenCalledWith({
				model: 'gemini-1.5-flash-002',
				contents: expect.stringContaining('test'),
				config: {
					tools: [
						{
							fileSearch: {
								fileSearchStoreNames: ['test-store'],
								metadataFilter: 'folder="projects" AND tags="architecture"',
							},
						},
					],
				},
			});
		});

		it('should handle API errors gracefully', async () => {
			mockAi.models.generateContent.mockRejectedValue(new Error('API error'));

			const result = await tool.execute({ query: 'test' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toBe('Search failed: API error');
		});

		it('should parse grounding chunks from response', async () => {
			mockAi.models.generateContent.mockResolvedValue({
				text: 'Summary of findings',
				candidates: [
					{
						groundingMetadata: {
							groundingChunks: [
								{
									retrievedContext: {
										title: 'notes/test.md',
										text: 'Relevant excerpt from the note',
									},
								},
							],
						},
					},
				],
			});

			const result = await tool.execute({ query: 'test' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data).toEqual({
				query: 'test',
				summary: 'Summary of findings',
				results: [
					{
						path: 'notes/test.md',
						excerpt: 'Relevant excerpt from the note',
					},
				],
				totalMatches: 1,
				message: 'Found 1 relevant passages',
			});
		});

		it('should extract path from uri when title is missing', async () => {
			mockAi.models.generateContent.mockResolvedValue({
				text: 'Summary',
				candidates: [
					{
						groundingMetadata: {
							groundingChunks: [
								{
									retrievedContext: {
										uri: 'fileSearchStores/abc123/files/document.md',
										text: 'Content from the document',
									},
								},
							],
						},
					},
				],
			});

			const result = await tool.execute({ query: 'test' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data.results[0].path).toBe('document.md');
		});

		it('should extract path from uri with files segment', async () => {
			mockAi.models.generateContent.mockResolvedValue({
				text: 'Summary',
				candidates: [
					{
						groundingMetadata: {
							groundingChunks: [
								{
									retrievedContext: {
										uri: 'fileSearchStores/abc123/files/document.md',
										text: 'Content',
									},
								},
							],
						},
					},
				],
			});

			const result = await tool.execute({ query: 'test' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data.results[0].path).toBe('document.md');
		});

		it('should omit path when API only provides fileSearchStore', async () => {
			// This is the actual behavior of Google's File Search API grounding response
			mockAi.models.generateContent.mockResolvedValue({
				text: 'Summary',
				candidates: [
					{
						groundingMetadata: {
							groundingChunks: [
								{
									retrievedContext: {
										text: 'Content without path info',
										fileSearchStore: 'fileSearchStores/store-name',
									},
								},
							],
						},
					},
				],
			});

			const result = await tool.execute({ query: 'test' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data.results[0].path).toBeUndefined();
			expect(result.data.results[0].excerpt).toBe('Content without path info');
		});
	});

	describe('extractPathFromContext', () => {
		// Access private method for testing
		const extractPath = (context: { uri?: string; title?: string }) => {
			return (tool as any).extractPathFromContext(context);
		};

		it('should return title when available', () => {
			expect(extractPath({ title: 'notes/test.md' })).toBe('notes/test.md');
			expect(extractPath({ title: 'test.md', uri: 'some/uri' })).toBe('test.md');
		});

		it('should return whitespace-only title as-is', () => {
			// Whitespace-only title is truthy, so it gets returned
			expect(extractPath({ title: '   ' })).toBe('   ');
		});

		it('should extract filename from uri when title is missing', () => {
			expect(extractPath({ uri: 'stores/abc/files/document.md' })).toBe('document.md');
			expect(extractPath({ uri: 'path/to/file.txt' })).toBe('file.txt');
		});

		it('should not treat dotfiles as having extensions', () => {
			// .hidden is a dotfile, not a file with extension
			expect(extractPath({ uri: 'path/to/.hidden' })).toBe('path/to/.hidden');
			// .gitignore should be treated as dotfile, not as file with .gitignore extension
			expect(extractPath({ uri: 'path/to/.gitignore' })).toBe('path/to/.gitignore');
		});

		it('should return full uri for opaque file IDs without extension', () => {
			// When the URI contains /files/ segment but the ID has no extension
			expect(extractPath({ uri: 'fileSearchStores/abc/files/opaque-id' })).toBe('fileSearchStores/abc/files/opaque-id');
		});

		it('should return undefined for store-only uri', () => {
			// Google's grounding response often only includes fileSearchStore, not a useful uri
			expect(extractPath({ uri: 'fileSearchStores/store-name' })).toBeUndefined();
		});

		it('should return undefined when neither title nor uri is present', () => {
			expect(extractPath({})).toBeUndefined();
			expect(extractPath({ title: '', uri: '' })).toBeUndefined();
		});
	});

	describe('getRagTools', () => {
		it('should return array with RagSearchTool instance', () => {
			const tools = getRagTools();
			expect(tools).toHaveLength(1);
			expect(tools[0]).toBeInstanceOf(RagSearchTool);
			expect(tools[0].name).toBe('vault_semantic_search');
		});
	});
});
