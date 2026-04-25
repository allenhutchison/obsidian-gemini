import { ToolExecutionEngine } from '../../src/tools/execution-engine';
import { ToolRegistry } from '../../src/tools/tool-registry';
import { ReadFileTool, WriteFileTool, SearchFilesTool, DeleteFileTool, ListFilesTool } from '../../src/tools/vault';
import { GoogleSearchTool } from '../../src/tools/google-search-tool';
import { WebFetchTool } from '../../src/tools/web-fetch-tool';
import { SessionType, ToolCategory } from '../../src/types/agent';
import { IConfirmationProvider } from '../../src/tools/types';
import { TFile } from 'obsidian';

// Sessions in these tests bypass confirmation via `bypassConfirmationFor` /
// `requireConfirmation: []`, so the provider is never consulted — a deny stub
// is fine. Tests that need to test the confirmation branch build their own.
const denyProvider: IConfirmationProvider = {
	showConfirmationInChat: vi.fn().mockResolvedValue({ confirmed: false, allowWithoutConfirmation: false }),
	isToolAllowedWithoutConfirmation: vi.fn().mockReturnValue(false),
	allowToolWithoutConfirmation: vi.fn(),
};

// Mock gemini-utils (needed by file-classification, imported by vault-tools)
vi.mock('@allenhutchison/gemini-utils', () => ({
	EXTENSION_TO_MIME: { '.md': 'text/markdown', '.txt': 'text/plain' },
	TEXT_FALLBACK_EXTENSIONS: new Set(['.ts', '.js', '.json']),
}));

// Mock dependencies
vi.mock('obsidian', async () => ({
	...(await vi.importActual<any>('../../__mocks__/obsidian.js')),
	Notice: vi.fn(),
	normalizePath: vi.fn((path: string) => path),
	TFile: class TFile {
		path: string = '';
		name: string = '';
		basename: string = '';
		stat = { size: 0, mtime: Date.now(), ctime: Date.now() };
	},
}));

vi.mock('@google/genai');

// Mock ScribeFile
vi.mock('../../src/files', () => ({
	ScribeFile: vi.fn().mockImplementation(function () {
		return {
			getUniqueLinks: vi.fn().mockReturnValue(new Set()),
			getLinkText: vi.fn((file: any) => `[[${file.name || file.path}]]`),
			getBacklinks: vi.fn().mockReturnValue(new Set()),
		};
	}),
}));

describe('Tool Integration Tests', () => {
	let plugin: any;
	let registry: ToolRegistry;
	let engine: ToolExecutionEngine;

	beforeEach(() => {
		// Mock plugin with realistic structure
		plugin = {
			apiKey: 'test-api-key',
			settings: {
				historyFolder: 'gemini-scribe',
				searchGrounding: true,
				searchGroundingThreshold: 0.7,
				loopDetectionThreshold: 3,
				loopDetectionTimeWindowSeconds: 60,
			},
			app: {
				vault: {
					getAbstractFileByPath: vi.fn(),
					getMarkdownFiles: vi.fn().mockReturnValue([]),
					getFiles: vi.fn().mockReturnValue([]),
					read: vi.fn(),
					create: vi.fn(),
					modify: vi.fn(),
					delete: vi.fn(),
					processFrontMatter: vi.fn(),
					getRoot: vi.fn().mockReturnValue({
						children: [],
						path: '/',
					}),
				},
				metadataCache: {
					getFileCache: vi.fn(),
					getFirstLinkpathDest: vi.fn().mockReturnValue(null),
				},
			},
			gfile: {
				getUniqueLinks: vi.fn().mockReturnValue(new Set()),
				getLinkText: vi.fn((file: any) => `[[${file.name || file.path}]]`),
				getBacklinks: vi.fn().mockReturnValue(new Set()),
			},
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
						bypassConfirmationFor: ['modify_files'],
					},
				},
			} as any;

			// Mock search results
			const mockFiles = [createMockFile('project/todo.md', 'todo'), createMockFile('project/done.md', 'done')];
			plugin.app.vault.getFiles.mockReturnValue(mockFiles);

			// Mock file content
			plugin.app.vault.read.mockResolvedValue('# TODO\n- [ ] Task 1\n- [x] Task 2');

			// 1. Search for files
			const searchResult = await engine.executeTool(
				{
					name: 'find_files_by_name',
					arguments: { pattern: 'todo' },
				},
				context,
				denyProvider
			);

			expect(searchResult.success).toBe(true);
			expect(searchResult.data.matches).toHaveLength(1);

			// 2. Read the found file - need to mock it exists
			plugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFiles[0]);
			const readResult = await engine.executeTool(
				{
					name: 'read_file',
					arguments: { path: 'project/todo.md' },
				},
				context,
				denyProvider
			);

			expect(readResult.success).toBe(true);
			expect(readResult.data.content).toContain('TODO');

			// 3. Write updated content
			plugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFiles[0]);
			const writeResult = await engine.executeTool(
				{
					name: 'write_file',
					arguments: {
						path: 'project/todo.md',
						content: '# TODO\n- [ ] Task 1\n- [x] Task 2\n- [ ] Task 3',
					},
				},
				context,
				denyProvider
			);

			expect(writeResult.success).toBe(true);
			expect(plugin.app.vault.modify).toHaveBeenCalledWith(mockFiles[0], expect.stringContaining('Task 3'));
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
						bypassConfirmationFor: ['manage_properties'],
					},
				},
			} as any;

			// Mock file structure
			const mockFolder = {
				path: 'notes',
				children: [
					createMockFile('notes/meeting.md', 'meeting'),
					createMockFile('notes/todo.md', 'todo'),
					{ path: 'notes/subfolder', children: [] },
				],
			};
			plugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFolder);

			// Mock root folder for empty path
			plugin.app.vault.getRoot = vi.fn().mockReturnValue(mockFolder);

			// 1. List files in root
			const listResult = await engine.executeTool(
				{
					name: 'list_files',
					arguments: { path: '' },
				},
				context,
				denyProvider
			);

			expect(listResult.success).toBe(true);
			expect(listResult.data.files).toBeInstanceOf(Array);

			// 2. List files in subfolder
			const subfolderResult = await engine.executeTool(
				{
					name: 'list_files',
					arguments: { path: 'notes' },
				},
				context,
				denyProvider
			);

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
						requireConfirmation: [],
					},
				},
			} as any;

			// The google search tool is disabled without proper API key
			// We need to mock the tool to bypass API key check
			const searchTool = registry.getTool('google_search');
			if (searchTool) {
				searchTool.execute = vi.fn().mockResolvedValue({
					success: true,
					data: {
						query: 'obsidian plugins',
						answer: 'Search results for Obsidian plugins',
						originalAnswer: 'Search results for Obsidian plugins',
						citations: [],
					},
				});
			}

			// 1. Search the web
			const searchResult = await engine.executeTool(
				{
					name: 'google_search',
					arguments: { query: 'obsidian plugins' },
				},
				context,
				denyProvider
			);

			expect(searchResult.success).toBe(true);
			expect(searchResult.data.answer).toContain('Search results');

			// 2. Fetch specific URL
			// Mock fetch response
			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				text: async () => '<html><body><h1>Obsidian Plugins</h1></body></html>',
				headers: new Headers({ 'content-type': 'text/html' }),
			});

			const fetchResult = await engine.executeTool(
				{
					name: 'fetch_url',
					arguments: {
						url: 'https://obsidian.md/plugins',
						prompt: 'Extract the main heading',
					},
				},
				context,
				denyProvider
			);

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
						requireConfirmation: [],
					},
				},
			} as any;

			// Try to execute write operation
			const writeResult = await engine.executeTool(
				{
					name: 'write_file',
					arguments: { path: 'test.md', content: 'content' },
				},
				context,
				denyProvider
			);

			expect(writeResult.success).toBe(false);
			expect(writeResult.error).toContain('not enabled');

			// Read operation should work
			plugin.app.vault.getAbstractFileByPath.mockReturnValue(createMockFile('test.md', 'test'));
			plugin.app.vault.read.mockResolvedValue('file content');

			const readResult = await engine.executeTool(
				{
					name: 'read_file',
					arguments: { path: 'test.md' },
				},
				context,
				denyProvider
			);

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
						bypassConfirmationFor: ['modify_files', 'delete_files'],
					},
				},
			} as any;

			// Try operations on one system path only
			const systemPath = 'gemini-scribe/config.md';

			// Write should fail
			const writeResult = await engine.executeTool(
				{
					name: 'write_file',
					arguments: { path: systemPath, content: 'hacked' },
				},
				context,
				denyProvider
			);
			expect(writeResult.success).toBe(false);
			expect(writeResult.error).toContain('protected');

			// Delete should fail
			const deleteResult = await engine.executeTool(
				{
					name: 'delete_file',
					arguments: { path: systemPath },
				},
				context,
				denyProvider
			);
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
						bypassConfirmationFor: ['modify_files'],
					},
				},
			} as any;

			// Execute multiple tools with one failure
			const toolCalls = [
				{ name: 'find_files_by_name', arguments: { pattern: 'test' } },
				{ name: 'read_file', arguments: { path: 'nonexistent.md' } }, // Will fail
				{ name: 'list_files', arguments: { path: '' } },
			];

			// Mock getRoot for list_files
			plugin.app.vault.getRoot = vi.fn().mockReturnValue({
				children: [],
				path: '/',
			});

			// Execute tools sequentially
			const results = [];
			for (const call of toolCalls) {
				const result = await engine.executeTool(call, context, denyProvider);
				results.push(result);
			}

			expect(results).toHaveLength(3);
			expect(results[0].success).toBe(true); // Search should succeed
			expect(results[1].success).toBe(true); // Read returns success with exists: false
			expect(results[1].data.exists).toBe(false);
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
	(file as any).extension = 'md';
	return file;
}
