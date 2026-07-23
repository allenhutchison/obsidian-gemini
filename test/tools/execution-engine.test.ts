import { ToolExecutionEngine } from '../../src/tools/execution-engine';
import { ToolRegistry } from '../../src/tools/tool-registry';
import { ReadFileTool, ListFilesTool, WriteFileTool } from '../../src/tools/vault';
import { getExtendedVaultTools } from '../../src/tools/vault-tools-extended';
import { ToolCategory } from '../../src/types/agent';
import { ToolClassification } from '../../src/types/tool-policy';
import { IConfirmationProvider, Tool } from '../../src/tools/types';
import { TFile } from 'obsidian';

// Deny-by-default provider used when a test never reaches the confirmation branch.
// Tests that do reach confirmation build their own stub inline.
const denyProvider: IConfirmationProvider = {
	showConfirmationInChat: vi.fn().mockResolvedValue({ confirmed: false, allowWithoutConfirmation: false }),
	isToolAllowedWithoutConfirmation: vi.fn().mockReturnValue(false),
	allowToolWithoutConfirmation: vi.fn(),
};

// Mock gemini-utils (needed by file-classification, imported by vault-tools)
vi.mock('@allenhutchison/gemini-utils/mime', () => ({
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

	it('should reject tools the feature policy maps to DENY', async () => {
		// Under the unified-policy model the registry no longer filters by
		// ToolCategory — disabling a tool is expressed as a DENY permission
		// via the feature-level policy (or the global policy).
		const context = {
			plugin,
			session: {
				id: 'test-session',
				type: 'agent-session',
				context: {
					contextFiles: [],
					contextDepth: 2,
					requireConfirmation: [],
				},
			},
			featureToolPolicy: {
				overrides: { write_file: 'deny' as any },
			},
		} as any;

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
		registry.registerTool(noopTool);
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

describe('ToolExecutionEngine - executeToolCalls with stopOnToolError=false', () => {
	let plugin: any;
	let registry: ToolRegistry;
	let engine: ToolExecutionEngine;

	const succeedTool = {
		name: 'succeed_tool',
		description: 'Always succeeds',
		category: ToolCategory.READ_ONLY,
		classification: ToolClassification.READ,
		parameters: { type: 'object' as const, properties: {}, required: [] },
		execute: vi.fn().mockResolvedValue({ success: true, data: { ok: true } }),
	};

	const failTool = {
		name: 'fail_tool',
		description: 'Always fails',
		category: ToolCategory.READ_ONLY,
		classification: ToolClassification.READ,
		parameters: { type: 'object' as const, properties: {}, required: [] },
		execute: vi.fn().mockResolvedValue({ success: false, error: 'deliberate failure' }),
	};

	beforeEach(() => {
		plugin = {
			settings: {
				stopOnToolError: false,
				loopDetectionThreshold: 3,
				loopDetectionTimeWindowSeconds: 60,
			},
			logger: { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
		};

		registry = new ToolRegistry(plugin);
		engine = new ToolExecutionEngine(plugin, registry);
		registry.registerTool(succeedTool);
		registry.registerTool(failTool);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('continues executing all tool calls when stopOnToolError is false', async () => {
		const context = {
			plugin,
			session: {
				id: 'continue-session',
				type: 'agent-session',
				context: {
					contextFiles: [],
					contextDepth: 2,
					enabledTools: [ToolCategory.READ_ONLY],
					requireConfirmation: [],
				},
			},
		} as any;

		const results = await engine.executeToolCalls(
			[
				{ name: 'succeed_tool', arguments: {} },
				{ name: 'fail_tool', arguments: {} },
				{ name: 'succeed_tool', arguments: {} },
			],
			context,
			denyProvider
		);

		expect(results).toHaveLength(3);
		expect(results[0].success).toBe(true);
		expect(results[1].success).toBe(false);
		expect(results[1].error).toBe('deliberate failure');
		expect(results[2].success).toBe(true);
	});
});

describe('ToolExecutionEngine - diff/confirm hook dispatch', () => {
	// The per-tool diff/re-apply logic now lives on each tool (WriteFileTool,
	// AppendContentTool, CreateSkillTool, EditSkillTool) behind the optional
	// Tool.buildDiffContext / Tool.applyConfirmedEdit hooks — those are covered
	// in the per-tool test files. Here we only assert the engine dispatches to
	// those hooks polymorphically, with a no-diff fallback when a tool omits them.
	let plugin: any;
	let registry: ToolRegistry;
	let engine: ToolExecutionEngine;

	beforeEach(() => {
		plugin = {
			settings: {
				loopDetectionThreshold: 3,
				loopDetectionTimeWindowSeconds: 60,
				historyFolder: 'gemini-scribe',
			},
			app: {
				vault: {
					getAbstractFileByPath: vi.fn(),
					read: vi.fn(),
					getMarkdownFiles: vi.fn().mockReturnValue([]),
					getFiles: vi.fn().mockReturnValue([]),
					getRoot: vi.fn().mockReturnValue({ children: [] }),
				},
				metadataCache: {
					getFirstLinkpathDest: vi.fn().mockReturnValue(null),
				},
			},
			logger: { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
		};

		registry = new ToolRegistry(plugin);
		engine = new ToolExecutionEngine(plugin, registry);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	const context = () =>
		({
			plugin,
			session: {
				id: 'hook-session',
				type: 'agent-session',
				context: {
					contextFiles: [],
					contextDepth: 2,
					enabledTools: [ToolCategory.VAULT_OPERATIONS],
					requireConfirmation: ['modify_files'],
				},
			},
		}) as any;

	function makeWriteTool(overrides: Partial<Tool> = {}): Tool {
		return {
			name: 'fake_write',
			category: ToolCategory.VAULT_OPERATIONS,
			classification: ToolClassification.WRITE,
			description: 'fake write tool',
			requiresConfirmation: true,
			parameters: {
				type: 'object' as const,
				properties: { content: { type: 'string' as const, description: 'content' } },
				required: [],
			},
			execute: vi.fn().mockResolvedValue({ success: true, data: {} }),
			...overrides,
		};
	}

	function provider(result: any): IConfirmationProvider {
		return {
			showConfirmationInChat: vi.fn().mockResolvedValue(result),
			isToolAllowedWithoutConfirmation: vi.fn().mockReturnValue(false),
			allowToolWithoutConfirmation: vi.fn(),
			updateProgress: vi.fn(),
		};
	}

	it("passes the tool's buildDiffContext result to the confirmation provider", async () => {
		const diff = { filePath: 'x.md', originalContent: 'a', proposedContent: 'b', isNewFile: false };
		const buildDiffContext = vi.fn().mockResolvedValue(diff);
		const tool = makeWriteTool({ buildDiffContext });
		registry.registerTool(tool);

		const p = provider({ confirmed: false, allowWithoutConfirmation: false });
		const ctx = context();
		await engine.executeTool({ name: 'fake_write', arguments: { content: 'b' } }, ctx, p);

		expect(buildDiffContext).toHaveBeenCalledWith({ content: 'b' }, ctx);
		expect(p.showConfirmationInChat).toHaveBeenCalledWith(tool, { content: 'b' }, expect.any(String), diff);
	});

	it('passes undefined diffContext when the tool has no buildDiffContext hook', async () => {
		const tool = makeWriteTool();
		registry.registerTool(tool);

		const p = provider({ confirmed: false, allowWithoutConfirmation: false });
		await engine.executeTool({ name: 'fake_write', arguments: { content: 'b' } }, context(), p);

		expect(p.showConfirmationInChat).toHaveBeenCalledWith(tool, { content: 'b' }, expect.any(String), undefined);
	});

	it('invokes applyConfirmedEdit with the confirmation result and the edit reaches execute()', async () => {
		const applyConfirmedEdit = vi.fn((params: any, result: any) => {
			params.content = result.finalContent;
		});
		const execute = vi.fn().mockResolvedValue({ success: true, data: {} });
		const tool = makeWriteTool({ applyConfirmedEdit, execute });
		registry.registerTool(tool);

		const p = provider({
			confirmed: true,
			allowWithoutConfirmation: false,
			finalContent: 'edited',
			userEdited: true,
		});
		await engine.executeTool({ name: 'fake_write', arguments: { content: 'original' } }, context(), p);

		expect(applyConfirmedEdit).toHaveBeenCalledWith(
			expect.objectContaining({ content: 'edited' }),
			expect.objectContaining({ finalContent: 'edited', userEdited: true })
		);
		// The mutation the hook made must reach execute()
		expect(execute.mock.calls[0][0].content).toBe('edited');
	});

	it('does not invoke applyConfirmedEdit when the confirmation returned no finalContent', async () => {
		const applyConfirmedEdit = vi.fn();
		const tool = makeWriteTool({ applyConfirmedEdit });
		registry.registerTool(tool);

		const p = provider({ confirmed: true, allowWithoutConfirmation: false });
		await engine.executeTool({ name: 'fake_write', arguments: { content: 'original' } }, context(), p);

		expect(applyConfirmedEdit).not.toHaveBeenCalled();
	});
});

describe('ToolExecutionEngine - formatToolResult', () => {
	let plugin: any;
	let registry: ToolRegistry;
	let engine: ToolExecutionEngine;

	beforeEach(() => {
		plugin = {
			settings: {
				loopDetectionThreshold: 3,
				loopDetectionTimeWindowSeconds: 60,
			},
			logger: { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
		};

		registry = new ToolRegistry(plugin);
		engine = new ToolExecutionEngine(plugin, registry);
	});

	it('formats a successful result with data', () => {
		const execution = {
			toolName: 'read_file',
			parameters: { path: 'test.md' },
			result: { success: true, data: { content: 'hello' } },
			timestamp: new Date(),
		} as any;

		const formatted = engine.formatToolResult(execution);

		expect(formatted).toContain('### Tool Execution: read_file');
		expect(formatted).toContain('✓ Success');
		expect(formatted).toContain('**Result:**');
		expect(formatted).toContain('"content": "hello"');
		expect(formatted).not.toContain('**Error:**');
	});

	it('formats a failed result with error', () => {
		const execution = {
			toolName: 'write_file',
			parameters: { path: 'test.md', content: 'x' },
			result: { success: false, error: 'Permission denied' },
			timestamp: new Date(),
		} as any;

		const formatted = engine.formatToolResult(execution);

		expect(formatted).toContain('### Tool Execution: write_file');
		expect(formatted).toContain('✗ Failed');
		expect(formatted).toContain('**Error:** Permission denied');
		expect(formatted).not.toContain('**Result:**');
	});
});

describe('ToolExecutionEngine - getAvailableToolsDescription', () => {
	let plugin: any;
	let registry: ToolRegistry;
	let engine: ToolExecutionEngine;

	beforeEach(() => {
		plugin = {
			settings: {
				loopDetectionThreshold: 3,
				loopDetectionTimeWindowSeconds: 60,
			},
			logger: { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
		};

		registry = new ToolRegistry(plugin);
		engine = new ToolExecutionEngine(plugin, registry);
	});

	it('returns "No tools" message when no tools are enabled', () => {
		const context = {
			plugin,
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
			featureToolPolicy: {
				overrides: {},
			},
		} as any;

		const desc = engine.getAvailableToolsDescription(context);

		expect(desc).toBe('No tools are currently available.');
	});

	it('includes parameter descriptions for tools with parameters', () => {
		const toolWithParams = {
			name: 'test_tool',
			description: 'A test tool',
			category: ToolCategory.READ_ONLY,
			classification: ToolClassification.READ,
			parameters: {
				type: 'object' as const,
				properties: {
					path: { type: 'string' as const, description: 'File path to read' },
					depth: { type: 'number' as const, description: 'Depth level' },
				},
				required: ['path'],
			},
			execute: vi.fn().mockResolvedValue({ success: true }),
		};
		registry.registerTool(toolWithParams);

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

		const desc = engine.getAvailableToolsDescription(context);

		expect(desc).toContain('## Available Tools');
		expect(desc).toContain('### test_tool');
		expect(desc).toContain('A test tool');
		expect(desc).toContain('**Parameters:**');
		expect(desc).toContain('`path` (string) (required): File path to read');
		expect(desc).toContain('`depth` (number): Depth level');
	});
});

describe('ToolExecutionEngine - Execution History Management', () => {
	let plugin: any;
	let registry: ToolRegistry;
	let engine: ToolExecutionEngine;

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
				loopDetectionThreshold: 99,
				loopDetectionTimeWindowSeconds: 60,
			},
			logger: { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
		};

		registry = new ToolRegistry(plugin);
		engine = new ToolExecutionEngine(plugin, registry);
		registry.registerTool(noopTool);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('returns empty array for unknown session', () => {
		expect(engine.getExecutionHistory('unknown-session')).toEqual([]);
	});

	it('records execution history and retrieves it', async () => {
		const context = {
			plugin,
			session: {
				id: 'history-session',
				type: 'agent-session',
				context: {
					contextFiles: [],
					contextDepth: 2,
					enabledTools: [ToolCategory.READ_ONLY],
					requireConfirmation: [],
				},
			},
		} as any;

		await engine.executeTool({ name: 'noop', arguments: {} }, context, denyProvider);
		await engine.executeTool({ name: 'noop', arguments: {} }, context, denyProvider);

		const history = engine.getExecutionHistory('history-session');
		expect(history).toHaveLength(2);
		expect(history[0].toolName).toBe('noop');
		expect(history[0].result.success).toBe(true);
		expect(history[0].timestamp).toBeInstanceOf(Date);
	});

	it('clears execution history for a session', async () => {
		const context = {
			plugin,
			session: {
				id: 'clear-session',
				type: 'agent-session',
				context: {
					contextFiles: [],
					contextDepth: 2,
					enabledTools: [ToolCategory.READ_ONLY],
					requireConfirmation: [],
				},
			},
		} as any;

		await engine.executeTool({ name: 'noop', arguments: {} }, context, denyProvider);
		expect(engine.getExecutionHistory('clear-session')).toHaveLength(1);

		engine.clearExecutionHistory('clear-session');
		expect(engine.getExecutionHistory('clear-session')).toEqual([]);
	});
});

describe('ToolExecutionEngine - Loop Detection Event Bus Emit Error', () => {
	let plugin: any;
	let registry: ToolRegistry;
	let engine: ToolExecutionEngine;

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
			agentEventBus: {
				emit: vi.fn().mockImplementation(() => {
					throw new Error('emit exploded');
				}),
			},
		};

		registry = new ToolRegistry(plugin);
		engine = new ToolExecutionEngine(plugin, registry);
		registry.registerTool(noopTool);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('still returns loopDetected result even when agentEventBus.emit throws', async () => {
		const context = {
			plugin,
			session: {
				id: 'emit-error-session',
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

		// First 3 calls pass, 4th triggers loop
		for (let i = 0; i < 3; i++) {
			await engine.executeTool(call, context, denyProvider);
		}

		const result = await engine.executeTool(call, context, denyProvider);

		expect(result.success).toBe(false);
		expect(result.loopDetected).toBe(true);
		expect(plugin.logger.error).toHaveBeenCalledWith('Failed to emit toolLoopDetected event:', expect.any(Error));
	});
});

describe('ToolExecutionEngine - Confirmation Flow', () => {
	let plugin: any;
	let registry: ToolRegistry;
	let engine: ToolExecutionEngine;

	beforeEach(() => {
		plugin = {
			settings: {
				loopDetectionThreshold: 3,
				loopDetectionTimeWindowSeconds: 60,
				historyFolder: 'gemini-scribe',
			},
			app: {
				vault: {
					getAbstractFileByPath: vi.fn(),
					read: vi.fn().mockResolvedValue('file content'),
					modify: vi.fn().mockResolvedValue(undefined),
					create: vi.fn().mockResolvedValue(undefined),
					getMarkdownFiles: vi.fn().mockReturnValue([]),
					getFiles: vi.fn().mockReturnValue([]),
					getRoot: vi.fn().mockReturnValue({ children: [] }),
				},
				metadataCache: {
					getFirstLinkpathDest: vi.fn().mockReturnValue(null),
				},
			},
			logger: { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
		};

		registry = new ToolRegistry(plugin);
		engine = new ToolExecutionEngine(plugin, registry);
		registry.registerTool(new WriteFileTool());
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('calls allowToolWithoutConfirmation when user confirms AND sets allowWithoutConfirmation=true', async () => {
		const context = {
			plugin,
			session: {
				id: 'allow-session',
				type: 'agent-session',
				context: {
					contextFiles: [],
					contextDepth: 2,
					enabledTools: [ToolCategory.VAULT_OPERATIONS],
					requireConfirmation: ['modify_files'],
				},
			},
		} as any;

		const mockFile = new TFile();
		(mockFile as any).path = 'test.md';
		(mockFile as any).name = 'test.md';
		(mockFile as any).stat = { size: 100, mtime: Date.now(), ctime: Date.now() };
		plugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);

		const confirmProvider: IConfirmationProvider = {
			showConfirmationInChat: vi.fn().mockResolvedValue({
				confirmed: true,
				allowWithoutConfirmation: true,
			}),
			isToolAllowedWithoutConfirmation: vi.fn().mockReturnValue(false),
			allowToolWithoutConfirmation: vi.fn(),
			updateProgress: vi.fn(),
		};

		await engine.executeTool(
			{ name: 'write_file', arguments: { path: 'test.md', content: 'content' } },
			context,
			confirmProvider
		);

		expect(confirmProvider.allowToolWithoutConfirmation).toHaveBeenCalledWith('write_file');
	});

	it('flips append_content to a full overwrite when the user edits the diff', async () => {
		// The append→overwrite flip now lives in AppendContentTool.applyConfirmedEdit;
		// register the real tool so the engine exercises that hook end-to-end.
		const appendTool = getExtendedVaultTools().find((tt) => tt.name === 'append_content')!;
		registry.registerTool(appendTool);

		const context = {
			plugin,
			session: {
				id: 'append-edit-session',
				type: 'agent-session',
				context: {
					contextFiles: [],
					contextDepth: 2,
					enabledTools: [ToolCategory.VAULT_OPERATIONS],
					requireConfirmation: ['modify_files'],
				},
			},
		} as any;

		const mockFile = new TFile();
		(mockFile as any).path = 'doc.md';
		(mockFile as any).extension = 'md';
		plugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);
		plugin.app.vault.read.mockResolvedValue('original');
		plugin.app.vault.modify = vi.fn().mockResolvedValue(undefined);

		const confirmProvider: IConfirmationProvider = {
			showConfirmationInChat: vi.fn().mockResolvedValue({
				confirmed: true,
				allowWithoutConfirmation: false,
				finalContent: 'full edited file',
				userEdited: true,
			}),
			isToolAllowedWithoutConfirmation: vi.fn().mockReturnValue(false),
			allowToolWithoutConfirmation: vi.fn(),
			updateProgress: vi.fn(),
		};

		const result = await engine.executeTool(
			{ name: 'append_content', arguments: { path: 'doc.md', content: 'suffix' } },
			context,
			confirmProvider
		);

		expect(result.success).toBe(true);
		// A user edit means "replace the whole file", not "append the suffix":
		// the tool overwrites with the edited content and reports a replace.
		expect(result.data.action).toBe('replaced');
		expect(result.data.userEdited).toBe(true);
		expect(plugin.app.vault.modify).toHaveBeenCalledWith(
			expect.objectContaining({ path: 'doc.md' }),
			'full edited file'
		);
	});
});

describe('ToolExecutionEngine - Non-Error Thrown Value', () => {
	let plugin: any;
	let registry: ToolRegistry;
	let engine: ToolExecutionEngine;

	beforeEach(() => {
		plugin = {
			settings: {
				loopDetectionThreshold: 3,
				loopDetectionTimeWindowSeconds: 60,
			},
			logger: { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
		};

		registry = new ToolRegistry(plugin);
		engine = new ToolExecutionEngine(plugin, registry);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('handles a non-Error thrown value with "Unknown error" message', async () => {
		const stringThrowTool = {
			name: 'string_throw',
			description: 'Throws a string',
			category: ToolCategory.READ_ONLY,
			classification: ToolClassification.READ,
			parameters: { type: 'object' as const, properties: {}, required: [] },
			execute: vi.fn().mockRejectedValue('just a string'),
		};
		registry.registerTool(stringThrowTool);

		const context = {
			plugin,
			session: {
				id: 'throw-session',
				type: 'agent-session',
				context: {
					contextFiles: [],
					contextDepth: 2,
					enabledTools: [ToolCategory.READ_ONLY],
					requireConfirmation: [],
				},
			},
		} as any;

		const result = await engine.executeTool({ name: 'string_throw', arguments: {} }, context, denyProvider);

		expect(result.success).toBe(false);
		expect(result.error).toBe('Unknown error');
	});
});
