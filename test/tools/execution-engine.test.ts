import { ToolExecutionEngine } from '../../src/tools/execution-engine';
import { ToolRegistry } from '../../src/tools/tool-registry';
import { ReadFileTool, ListFilesTool, WriteFileTool } from '../../src/tools/vault';
import { ToolCategory } from '../../src/types/agent';
import { ToolClassification } from '../../src/types/tool-policy';
import { IConfirmationProvider } from '../../src/tools/types';
import { TFile } from 'obsidian';

// Deny-by-default provider used when a test never reaches the confirmation branch.
// Tests that do reach confirmation build their own stub inline.
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

// Mock Obsidian
vi.mock('obsidian', async () => ({
	...(await vi.importActual<any>('../../__mocks__/obsidian.js')),
	Notice: class Notice {
		hide = vi.fn();
	},
	normalizePath: vi.fn((path: string) => path),
	TFile: class TFile {
		path: string = '';
		name: string = '';
		stat = { size: 0, mtime: Date.now(), ctime: Date.now() };
	},
	TFolder: class TFolder {
		path: string = '';
		name: string = '';
		children: any[] = [];
	},
}));

describe('ToolExecutionEngine - Confirmation Requirements', () => {
	let plugin: any;
	let registry: ToolRegistry;
	let engine: ToolExecutionEngine;

	beforeEach(() => {
		// Mock plugin
		plugin = {
			settings: {
				loopDetectionThreshold: 3,
				loopDetectionTimeWindowSeconds: 60,
			},
			app: {
				vault: {
					getAbstractFileByPath: vi.fn(),
					read: vi.fn().mockResolvedValue('file content'),
					getMarkdownFiles: vi.fn().mockReturnValue([]),
					getFiles: vi.fn().mockReturnValue([]),
					getRoot: vi.fn().mockReturnValue({ children: [] }),
				},
				metadataCache: {
					getFirstLinkpathDest: vi.fn().mockReturnValue(null),
				},
			},
			agentView: null,
		};

		// Create registry and engine
		registry = new ToolRegistry(plugin);
		engine = new ToolExecutionEngine(plugin, registry);

		// Register tools
		registry.registerTool(new ReadFileTool());
		registry.registerTool(new ListFilesTool());
		registry.registerTool(new WriteFileTool());
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('should not require confirmation for READ_ONLY tools', async () => {
		const context = {
			plugin,
			session: {
				id: 'test-session',
				type: 'agent-session',
				context: {
					contextFiles: [],
					contextDepth: 2,
					enabledTools: [ToolCategory.READ_ONLY],
					requireConfirmation: [], // No confirmations required
				},
			},
		} as any;

		// Test read_file - should not require confirmation
		const readResult = await engine.executeTool(
			{
				name: 'read_file',
				arguments: { path: 'test.md' },
			},
			context,
			denyProvider
		);

		// Tool should execute without confirmation — returns success with exists: false
		expect(readResult.success).toBe(true);
		expect(readResult.data.exists).toBe(false);

		// Test list_files - should not require confirmation
		const listResult = await engine.executeTool(
			{
				name: 'list_files',
				arguments: { path: '' },
			},
			context,
			denyProvider
		);

		expect(listResult.success).toBe(true);
		expect(listResult.data).toBeDefined();
	});

	it('should require confirmation for VAULT_OPERATIONS tools when configured', async () => {
		const context = {
			plugin,
			session: {
				id: 'test-session',
				type: 'agent-session',
				context: {
					contextFiles: [],
					contextDepth: 2,
					enabledTools: [ToolCategory.VAULT_OPERATIONS],
					requireConfirmation: ['modify_files'], // Require confirmation for file modifications
				},
			},
		} as any;

		// Mock agentView with in-chat confirmation that declines
		const mockAgentView = {
			showConfirmationInChat: vi.fn().mockResolvedValue({
				confirmed: false,
				allowWithoutConfirmation: false,
			}),
			isToolAllowedWithoutConfirmation: vi.fn().mockReturnValue(false),
			allowToolWithoutConfirmation: vi.fn(),
		};

		// Test write_file - should require confirmation
		const writeResult = await engine.executeTool(
			{
				name: 'write_file',
				arguments: { path: 'test.md', content: 'new content' },
			},
			context,
			mockAgentView
		);

		expect(writeResult.success).toBe(false);
		expect(writeResult.error).toBe('User declined tool execution');
		expect(mockAgentView.showConfirmationInChat).toHaveBeenCalled();
	});

	it('should use edited content from confirmation when user edits in diff view', async () => {
		const context = {
			plugin,
			session: {
				id: 'test-session',
				type: 'agent-session',
				context: {
					contextFiles: [],
					contextDepth: 2,
					enabledTools: [ToolCategory.VAULT_OPERATIONS],
					requireConfirmation: ['modify_files'],
				},
			},
		} as any;

		// Mock agentView that approves with edited content
		const mockAgentView = {
			showConfirmationInChat: vi.fn().mockResolvedValue({
				confirmed: true,
				allowWithoutConfirmation: false,
				finalContent: 'user edited content',
				userEdited: true,
			}),
			isToolAllowedWithoutConfirmation: vi.fn().mockReturnValue(false),
			allowToolWithoutConfirmation: vi.fn(),
			updateProgress: vi.fn(),
		};

		// Mock vault to allow the write to succeed - use TFile instance for instanceof check
		const mockFile = new TFile();
		(mockFile as any).path = 'test.md';
		(mockFile as any).name = 'test.md';
		(mockFile as any).stat = { size: 100, mtime: Date.now(), ctime: Date.now() };
		plugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);
		plugin.app.vault.modify = vi.fn().mockResolvedValue(undefined);

		const writeResult = await engine.executeTool(
			{
				name: 'write_file',
				arguments: { path: 'test.md', content: 'original AI content' },
			},
			context,
			mockAgentView
		);

		expect(writeResult.success).toBe(true);
		// The write should use the user-edited content, not the original AI content
		expect(plugin.app.vault.modify).toHaveBeenCalledWith(
			expect.objectContaining({ path: 'test.md' }),
			'user edited content'
		);
		expect(writeResult.data.userEdited).toBe(true);
	});
});

describe('ToolExecutionEngine - Error Handling', () => {
	let plugin: any;
	let registry: ToolRegistry;
	let engine: ToolExecutionEngine;

	beforeEach(() => {
		// Mock plugin
		plugin = {
			settings: {
				loopDetectionThreshold: 3,
				loopDetectionTimeWindowSeconds: 60,
			},
			app: {
				vault: {
					getAbstractFileByPath: vi.fn(),
					read: vi.fn().mockResolvedValue('file content'),
					getMarkdownFiles: vi.fn().mockReturnValue([]),
					getFiles: vi.fn().mockReturnValue([]),
					getRoot: vi.fn().mockReturnValue({ children: [] }),
				},
				metadataCache: {
					getFirstLinkpathDest: vi.fn().mockReturnValue(null),
				},
			},
			agentView: null,
		};

		// Create registry and engine
		registry = new ToolRegistry(plugin);
		engine = new ToolExecutionEngine(plugin, registry);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('should handle non-existent tool gracefully', async () => {
		const context = {
			plugin,
			session: {
				id: 'test-session',
				type: 'agent-session',
				context: {
					contextFiles: [],
					contextDepth: 2,
					enabledTools: [ToolCategory.READ_ONLY],
					requireConfirmation: [],
				},
			},
		} as any;

		const result = await engine.executeTool(
			{
				name: 'non_existent_tool',
				arguments: {},
			},
			context,
			denyProvider
		);

		expect(result.success).toBe(false);
		expect(result.error).toBe('Tool non_existent_tool not found');
	});

	it('should handle tool not in enabled category', async () => {
		const context = {
			plugin,
			session: {
				id: 'test-session',
				type: 'agent-session',
				context: {
					contextFiles: [],
					contextDepth: 2,
					enabledTools: [ToolCategory.READ_ONLY], // Only READ_ONLY enabled
					requireConfirmation: [],
				},
			},
		} as any;

		// Register a VAULT_OPERATIONS tool
		registry.registerTool(new WriteFileTool());

		const result = await engine.executeTool(
			{
				name: 'write_file',
				arguments: { path: 'test.md', content: 'content' },
			},
			context,
			denyProvider
		);

		expect(result.success).toBe(false);
		expect(result.error).toBe('Tool write_file is not enabled for this session');
	});

	it('should handle tool execution throwing an error', async () => {
		const context = {
			plugin,
			session: {
				id: 'test-session',
				type: 'agent-session',
				context: {
					contextFiles: [],
					contextDepth: 2,
					enabledTools: [ToolCategory.READ_ONLY],
					requireConfirmation: [],
				},
			},
		} as any;

		// Register a tool that throws
		const errorTool = {
			name: 'error_tool',
			description: 'A tool that always throws',
			category: ToolCategory.READ_ONLY,
			classification: ToolClassification.READ,
			parameters: {
				type: 'object' as const,
				properties: {},
				required: [],
			},
			execute: vi.fn().mockRejectedValue(new Error('Tool execution failed')),
		};
		registry.registerTool(errorTool);

		const result = await engine.executeTool(
			{
				name: 'error_tool',
				arguments: {},
			},
			context,
			denyProvider
		);

		expect(result.success).toBe(false);
		expect(result.error).toBe('Tool execution failed');
	});

	it('should handle invalid tool arguments', async () => {
		const context = {
			plugin,
			session: {
				id: 'test-session',
				type: 'agent-session',
				context: {
					contextFiles: [],
					contextDepth: 2,
					enabledTools: [ToolCategory.READ_ONLY],
					requireConfirmation: [],
				},
			},
		} as any;

		registry.registerTool(new ReadFileTool());

		// Missing required 'path' argument
		const result = await engine.executeTool(
			{
				name: 'read_file',
				arguments: {},
			},
			context,
			denyProvider
		);

		expect(result.success).toBe(false);
		expect(result.error).toContain('Invalid parameters');
	});

	it('should handle multiple tool calls with proper error isolation', async () => {
		const context = {
			plugin,
			session: {
				id: 'test-session',
				type: 'agent-session',
				context: {
					contextFiles: [],
					contextDepth: 2,
					enabledTools: [ToolCategory.READ_ONLY],
					requireConfirmation: [],
				},
			},
		} as any;

		registry.registerTool(new ListFilesTool());

		// Execute multiple tool calls
		const results = await engine.executeToolCalls(
			[
				{ name: 'list_files', arguments: { path: '' } }, // Should succeed
				{ name: 'non_existent', arguments: {} }, // Should fail
				{ name: 'list_files', arguments: { path: 'folder' } }, // Should succeed
			],
			context,
			denyProvider
		);

		// Should only have 2 results because execution stops on error by default
		expect(results).toHaveLength(2);
		expect(results[0].success).toBe(true);
		expect(results[1].success).toBe(false);
		expect(results[1].error).toBe('Tool non_existent not found');
	});
});

describe('ToolExecutionEngine - Loop Detection', () => {
	let plugin: any;
	let registry: ToolRegistry;
	let engine: ToolExecutionEngine;

	// A minimal always-succeeds READ tool — avoids hauling in the real
	// vault-tool dependency surface just to exercise the loop detector.
	const noopTool = {
		name: 'noop',
		description: 'noop',
		category: ToolCategory.READ_ONLY,
		classification: ToolClassification.READ,
		parameters: { type: 'object' as const, properties: {}, required: [] },
		execute: vi.fn().mockResolvedValue({ success: true, data: {} }),
	};

	beforeEach(() => {
		plugin = {
			settings: {
				loopDetectionEnabled: true,
				loopDetectionThreshold: 3,
				loopDetectionTimeWindowSeconds: 60,
			},
			logger: { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
			agentEventBus: { emit: vi.fn().mockResolvedValue(undefined) },
		};

		registry = new ToolRegistry(plugin);
		engine = new ToolExecutionEngine(plugin, registry);
		registry.registerTool(noopTool as any);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('blocks further identical calls with loopDetected: true and emits toolLoopDetected', async () => {
		const context = {
			plugin,
			session: {
				id: 'loop-session',
				type: 'agent-session',
				context: {
					contextFiles: [],
					contextDepth: 2,
					enabledTools: [ToolCategory.READ_ONLY],
					requireConfirmation: [],
				},
			},
		} as any;

		const call = { name: 'noop', arguments: {} };

		// Threshold is 3 — getLoopInfo is consulted *before* recordExecution, so
		// the first 3 attempts pass (record counts: 0, 1, 2) and the 4th trips
		// because 3 >= threshold.
		const results = [];
		for (let i = 0; i < 4; i++) {
			results.push(await engine.executeTool(call, context, denyProvider));
		}

		expect(results.slice(0, 3).every((r) => r.success)).toBe(true);
		expect(results.slice(0, 3).some((r) => r.loopDetected)).toBe(false);

		const blocked = results[3];
		expect(blocked.success).toBe(false);
		expect(blocked.loopDetected).toBe(true);
		expect(blocked.error).toMatch(/loop detected/i);

		expect(plugin.agentEventBus.emit).toHaveBeenCalledTimes(1);
		expect(plugin.agentEventBus.emit).toHaveBeenCalledWith(
			'toolLoopDetected',
			expect.objectContaining({
				toolName: 'noop',
				args: {},
				identicalCallCount: 3,
			})
		);
	});

	it('does not set loopDetected when detection is disabled', async () => {
		plugin.settings.loopDetectionEnabled = false;

		const context = {
			plugin,
			session: {
				id: 'no-detection-session',
				type: 'agent-session',
				context: {
					contextFiles: [],
					contextDepth: 2,
					enabledTools: [ToolCategory.READ_ONLY],
					requireConfirmation: [],
				},
			},
		} as any;

		const call = { name: 'noop', arguments: {} };
		for (let i = 0; i < 5; i++) {
			const result = await engine.executeTool(call, context, denyProvider);
			expect(result.success).toBe(true);
			expect(result.loopDetected).toBeUndefined();
		}
		expect(plugin.agentEventBus.emit).not.toHaveBeenCalled();
	});
});
