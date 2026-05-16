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

	describe('Permission Boundaries', () => {
		it('should respect tool restrictions expressed as a READ_ONLY feature policy', async () => {
			const context = {
				plugin,
				session: {
					id: 'test-session',
					type: SessionType.AGENT_SESSION,
					context: {
						contextFiles: [],
						requireConfirmation: [],
					},
				},
				// READ_ONLY preset maps WRITE/DESTRUCTIVE/EXTERNAL to DENY, so
				// write_file is filtered out of getEnabledTools while read_file
				// stays available.
				featureToolPolicy: { preset: 'read_only' },
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
