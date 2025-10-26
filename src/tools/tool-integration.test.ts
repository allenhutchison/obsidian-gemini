import { ToolExecutionEngine } from './execution-engine';
import { ToolRegistry } from './tool-registry';
import { ReadFileTool, WriteFileTool, SearchFilesTool, DeleteFileTool, ListFilesTool } from './vault-tools';
import { GoogleSearchTool } from './google-search-tool';
import { WebFetchTool } from './web-fetch-tool';
import { SessionType, ToolCategory } from '../types/agent';
import { TFile } from 'obsidian';

// Mock dependencies
jest.mock('obsidian', () => ({
	...jest.requireActual('../../__mocks__/obsidian.js'),
	Notice: jest.fn(),
	normalizePath: jest.fn((path: string) => path),
	TFile: class TFile {
		path: string = '';
		name: string = '';
		basename: string = '';
		stat = { size: 0, mtime: Date.now(), ctime: Date.now() };
	}
}));

jest.mock('@google/genai');

// Mock ScribeFile and ScribeDataView
jest.mock('../files', () => ({
	ScribeFile: jest.fn().mockImplementation(() => ({
		getUniqueLinks: jest.fn().mockReturnValue(new Set()),
		getLinkText: jest.fn((file: any) => `[[${file.name || file.path}]]`)
	}))
}));

jest.mock('../files/dataview-utils', () => ({
	ScribeDataView: jest.fn().mockImplementation(() => ({
		getBacklinks: jest.fn().mockResolvedValue(new Set())
	}))
}));

describe('Tool Integration Tests', () => {
	let plugin: any;
	let registry: ToolRegistry;
	let engine: ToolExecutionEngine;

	beforeEach(() => {
		// Mock plugin with realistic structure
		plugin = {
			settings: {
				apiKey: 'test-api-key',
				historyFolder: 'gemini-scribe',
				searchGrounding: true,
				searchGroundingThreshold: 0.7,
				loopDetectionThreshold: 3,
				loopDetectionTimeWindowSeconds: 60
			},
			app: {
				vault: {
					getAbstractFileByPath: jest.fn(),
					getMarkdownFiles: jest.fn().mockReturnValue([]),
					read: jest.fn(),
					create: jest.fn(),
					modify: jest.fn(),
					delete: jest.fn(),
					processFrontMatter: jest.fn(),
					getRoot: jest.fn().mockReturnValue({
						children: [],
						path: '/'
					})
				},
				metadataCache: {
					getFileCache: jest.fn(),
					getFirstLinkpathDest: jest.fn().mockReturnValue(null)
				}
			},
			gfile: {
				getUniqueLinks: jest.fn().mockReturnValue(new Set()),
				getLinkText: jest.fn((file: any) => `[[${file.name || file.path}]]`)
			}
		};

		// Create registry and register all tools
		registry = new ToolRegistry(plugin);
		registry.registerTool(new ReadFileTool());
		registry.registerTool(new WriteFileTool());
		registry.registerTool(new SearchFilesTool());
		registry.registerTool(new ListFilesTool());
		registry.registerTool(new DeleteFileTool());
		registry.registerTool(new GoogleSearchTool());
		registry.registerTool(new WebFetchTool());

		engine = new ToolExecutionEngine(plugin, registry);
	});

	describe('Multi-Tool Workflows', () => {
		it.skip('should handle search -> read -> write workflow', async () => {
			const context = {
				plugin,
				session: {
					id: 'test-session',
					type: SessionType.AGENT_SESSION,
					context: {
						contextFiles: [],
						contextDepth: 2,
						enabledTools: [ToolCategory.READ_ONLY, ToolCategory.VAULT_OPERATIONS],
						requireConfirmation: [],
						bypassConfirmationFor: ['modify_files']
					}
				}
			} as any;

			// Mock search results
			const mockFiles = [
				createMockFile('project/todo.md', 'todo'),
				createMockFile('project/done.md', 'done')
			];
			plugin.app.vault.getMarkdownFiles.mockReturnValue(mockFiles);

			// Mock file content
			plugin.app.vault.read.mockResolvedValue('# TODO\n- [ ] Task 1\n- [x] Task 2');

			// 1. Search for files
			const searchResult = await engine.executeTool({
				name: 'search_files',
				arguments: { pattern: 'todo' }
			}, context);

			expect(searchResult.success).toBe(true);
			expect(searchResult.data.matches).toHaveLength(1);

			// 2. Read the found file - need to mock it exists
			plugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFiles[0]);
			const readResult = await engine.executeTool({
				name: 'read_file',
				arguments: { path: 'project/todo.md' }
			}, context);

			expect(readResult.success).toBe(true);
			expect(readResult.data.content).toContain('TODO');

			// 3. Write updated content
			plugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFiles[0]);
			const writeResult = await engine.executeTool({
				name: 'write_file',
				arguments: { 
					path: 'project/todo.md',
					content: '# TODO\n- [ ] Task 1\n- [x] Task 2\n- [ ] Task 3'
				}
			}, context);

			expect(writeResult.success).toBe(true);
			expect(plugin.app.vault.modify).toHaveBeenCalledWith(
				mockFiles[0],
				expect.stringContaining('Task 3')
			);
		});

		it.skip('should handle list files workflow', async () => {
			const context = {
				plugin,
				session: {
					id: 'test-session',
					type: SessionType.AGENT_SESSION,
					context: {
						contextFiles: [],
						enabledTools: [ToolCategory.VAULT_OPERATIONS],
						requireConfirmation: [],
						bypassConfirmationFor: ['manage_properties']
					}
				}
			} as any;

			// Mock file structure
			const mockFolder = {
				path: 'notes',
				children: [
					createMockFile('notes/meeting.md', 'meeting'),
					createMockFile('notes/todo.md', 'todo'),
					{ path: 'notes/subfolder', children: [] }
				]
			};
			plugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFolder);

			// Mock root folder for empty path
			plugin.app.vault.getRoot = jest.fn().mockReturnValue(mockFolder);
			
			// 1. List files in root
			const listResult = await engine.executeTool({
				name: 'list_files',
				arguments: { path: '' }
			}, context);

			expect(listResult.success).toBe(true);
			expect(listResult.data.files).toBeInstanceOf(Array);

			// 2. List files in subfolder
			const subfolderResult = await engine.executeTool({
				name: 'list_files',
				arguments: { path: 'notes' }
			}, context);

			expect(subfolderResult.success).toBe(true);
		});
	});

	describe('Web Tools Integration', () => {
		it.skip('should handle web search and fetch workflow', async () => {
			const context = {
				plugin,
				session: {
					id: 'test-session',
					type: SessionType.AGENT_SESSION,
					context: {
						contextFiles: [],
						enabledTools: [ToolCategory.READ_ONLY],
						requireConfirmation: []
					}
				}
			} as any;

			// The google search tool is disabled without proper API key
			// We need to mock the tool to bypass API key check
			const searchTool = registry.getTool('google_search');
			if (searchTool) {
				searchTool.execute = jest.fn().mockResolvedValue({
					success: true,
					data: {
						query: 'obsidian plugins',
						answer: 'Search results for Obsidian plugins',
						originalAnswer: 'Search results for Obsidian plugins',
						citations: []
					}
				});
			}

			// 1. Search the web
			const searchResult = await engine.executeTool({
				name: 'google_search',
				arguments: { query: 'obsidian plugins' }
			}, context);

			expect(searchResult.success).toBe(true);
			expect(searchResult.data.answer).toContain('Search results');

			// 2. Fetch specific URL
			// Mock fetch response
			global.fetch = jest.fn().mockResolvedValue({
				ok: true,
				text: async () => '<html><body><h1>Obsidian Plugins</h1></body></html>',
				headers: new Headers({ 'content-type': 'text/html' })
			});

			const fetchResult = await engine.executeTool({
				name: 'fetch_url',
				arguments: { 
					url: 'https://obsidian.md/plugins',
					prompt: 'Extract the main heading'
				}
			}, context);

			expect(fetchResult.success).toBe(true);
			// Result depends on mock implementation
		});
	});

	describe('Permission Boundaries', () => {
		it('should respect tool category restrictions', async () => {
			const context = {
				plugin,
				session: {
					id: 'test-session',
					type: SessionType.AGENT_SESSION,
					context: {
						contextFiles: [],
						enabledTools: [ToolCategory.READ_ONLY], // Only read operations
						requireConfirmation: []
					}
				}
			} as any;

			// Try to execute write operation
			const writeResult = await engine.executeTool({
				name: 'write_file',
				arguments: { path: 'test.md', content: 'content' }
			}, context);

			expect(writeResult.success).toBe(false);
			expect(writeResult.error).toContain('not enabled');

			// Read operation should work
			plugin.app.vault.getAbstractFileByPath.mockReturnValue(createMockFile('test.md', 'test'));
			plugin.app.vault.read.mockResolvedValue('file content');

			const readResult = await engine.executeTool({
				name: 'read_file',
				arguments: { path: 'test.md' }
			}, context);

			expect(readResult.success).toBe(true);
		});

		it.skip('should protect system folders across all tools', async () => {
			const context = {
				plugin,
				session: {
					id: 'test-session',
					type: SessionType.AGENT_SESSION,
					context: {
						contextFiles: [],
						enabledTools: [ToolCategory.VAULT_OPERATIONS],
						requireConfirmation: [],
						bypassConfirmationFor: ['modify_files', 'delete_files']
					}
				}
			} as any;

			// Try operations on one system path only
			const systemPath = 'gemini-scribe/config.md';
			
			// Write should fail
			const writeResult = await engine.executeTool({
				name: 'write_file',
				arguments: { path: systemPath, content: 'hacked' }
			}, context);
			expect(writeResult.success).toBe(false);
			expect(writeResult.error).toContain('protected');

			// Delete should fail
			const deleteResult = await engine.executeTool({
				name: 'delete_file',
				arguments: { path: systemPath }
			}, context);
			expect(deleteResult.success).toBe(false);
			expect(deleteResult.error).toContain('protected');
		});
	});

	describe('Error Recovery', () => {
		it('should handle partial failures in multi-tool execution', async () => {
			const context = {
				plugin,
				session: {
					id: 'test-session',
					type: SessionType.AGENT_SESSION,
					context: {
						contextFiles: [],
						enabledTools: [ToolCategory.READ_ONLY, ToolCategory.VAULT_OPERATIONS],
						requireConfirmation: [],
						bypassConfirmationFor: ['modify_files']
					}
				}
			} as any;

			// Execute multiple tools with one failure
			const toolCalls = [
				{ name: 'search_files', arguments: { pattern: 'test' } },
				{ name: 'read_file', arguments: { path: 'nonexistent.md' } }, // Will fail
				{ name: 'list_files', arguments: { path: '' } }
			];

			// Mock getRoot for list_files
			plugin.app.vault.getRoot = jest.fn().mockReturnValue({ 
				children: [],
				path: '/'
			});
			
			// Execute tools sequentially
			const results = [];
			for (const call of toolCalls) {
				const result = await engine.executeTool(call, context);
				results.push(result);
			}

			expect(results).toHaveLength(3);
			expect(results[0].success).toBe(true); // Search should succeed
			expect(results[1].success).toBe(false); // Read should fail
			expect(results[2].success).toBe(true); // List should succeed
		});
	});
});

// Helper function to create mock files
function createMockFile(path: string, basename: string): TFile {
	const file = new TFile();
	file.path = path;
	file.name = `${basename}.md`;
	file.basename = basename;
	return file;
}