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
		registry.registerTool(succeedTool as any);
		registry.registerTool(failTool as any);
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

describe('ToolExecutionEngine - buildDiffContext for write_file', () => {
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

	it('returns original content with proposed content when file exists', async () => {
		const mockFile = new TFile();
		(mockFile as any).path = 'existing.md';
		plugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);
		plugin.app.vault.read.mockResolvedValue('original content');

		const tool = { name: 'write_file' } as any;
		const params = { path: 'existing.md', content: 'new content' };

		const diff = await (engine as any).buildDiffContext(tool, params);

		expect(diff).toBeDefined();
		expect(diff.filePath).toBe('existing.md');
		expect(diff.originalContent).toBe('original content');
		expect(diff.proposedContent).toBe('new content');
		expect(diff.isNewFile).toBe(false);
	});

	it('returns empty original content with isNewFile=true when file does not exist', async () => {
		plugin.app.vault.getAbstractFileByPath.mockReturnValue(null);

		const tool = { name: 'write_file' } as any;
		const params = { path: 'brand-new.md', content: 'new file content' };

		const diff = await (engine as any).buildDiffContext(tool, params);

		expect(diff).toBeDefined();
		expect(diff.filePath).toBe('brand-new.md');
		expect(diff.originalContent).toBe('');
		expect(diff.proposedContent).toBe('new file content');
		expect(diff.isNewFile).toBe(true);
	});

	it('returns undefined when path is in excluded history folder', async () => {
		const tool = { name: 'write_file' } as any;
		const params = { path: 'gemini-scribe/History/log.md', content: 'content' };

		const diff = await (engine as any).buildDiffContext(tool, params);

		expect(diff).toBeUndefined();
	});
});

describe('ToolExecutionEngine - buildDiffContext for append_content', () => {
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

	it('returns proposed = original + content for normal append', async () => {
		const mockFile = new TFile();
		(mockFile as any).path = 'notes.md';
		plugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);
		plugin.app.vault.read.mockResolvedValue('existing text\n');

		const tool = { name: 'append_content' } as any;
		const params = { path: 'notes.md', content: 'appended text' };

		const diff = await (engine as any).buildDiffContext(tool, params);

		expect(diff).toBeDefined();
		expect(diff.filePath).toBe('notes.md');
		expect(diff.originalContent).toBe('existing text\n');
		expect(diff.proposedContent).toBe('existing text\nappended text');
		expect(diff.isNewFile).toBe(false);
	});

	it('inserts newline when original does not end with one', async () => {
		const mockFile = new TFile();
		(mockFile as any).path = 'notes.md';
		plugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);
		plugin.app.vault.read.mockResolvedValue('no trailing newline');

		const tool = { name: 'append_content' } as any;
		const params = { path: 'notes.md', content: 'suffix' };

		const diff = await (engine as any).buildDiffContext(tool, params);

		expect(diff).toBeDefined();
		expect(diff.proposedContent).toBe('no trailing newline\nsuffix');
	});

	it('finds file via .md suffix fallback', async () => {
		const mockFile = new TFile();
		(mockFile as any).path = 'readme.md';
		// First call (direct path) returns null, second call (.md suffix) returns the file
		plugin.app.vault.getAbstractFileByPath.mockReturnValueOnce(null).mockReturnValueOnce(mockFile);
		plugin.app.vault.read.mockResolvedValue('readme content\n');

		const tool = { name: 'append_content' } as any;
		const params = { path: 'readme', content: 'more text' };

		const diff = await (engine as any).buildDiffContext(tool, params);

		expect(diff).toBeDefined();
		expect(diff.filePath).toBe('readme.md');
		expect(plugin.app.vault.getAbstractFileByPath).toHaveBeenCalledWith('readme.md');
	});

	it('finds file via wikilink/metadataCache fallback', async () => {
		const mockFile = new TFile();
		(mockFile as any).path = 'resolved.md';
		plugin.app.vault.getAbstractFileByPath.mockReturnValue(null);
		plugin.app.metadataCache.getFirstLinkpathDest.mockReturnValue(mockFile);
		plugin.app.vault.read.mockResolvedValue('resolved content\n');

		const tool = { name: 'append_content' } as any;
		const params = { path: '[[resolved]]', content: 'appended' };

		const diff = await (engine as any).buildDiffContext(tool, params);

		expect(diff).toBeDefined();
		expect(diff.filePath).toBe('resolved.md');
		expect(plugin.app.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith('resolved', '');
	});

	it('returns undefined when file not found (not a TFile instance)', async () => {
		plugin.app.vault.getAbstractFileByPath.mockReturnValue(null);
		plugin.app.metadataCache.getFirstLinkpathDest.mockReturnValue(null);

		const tool = { name: 'append_content' } as any;
		const params = { path: 'nonexistent.md', content: 'text' };

		const diff = await (engine as any).buildDiffContext(tool, params);

		expect(diff).toBeUndefined();
	});

	it('returns undefined when path is in excluded history folder', async () => {
		const tool = { name: 'append_content' } as any;
		const params = { path: 'gemini-scribe/sessions/log.md', content: 'text' };

		const diff = await (engine as any).buildDiffContext(tool, params);

		expect(diff).toBeUndefined();
	});
});

describe('ToolExecutionEngine - buildDiffContext for create_skill', () => {
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
				},
				metadataCache: {
					getFirstLinkpathDest: vi.fn().mockReturnValue(null),
				},
			},
			logger: { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
			skillManager: {
				getSkillsFolderPath: vi.fn().mockReturnValue('gemini-scribe/Skills'),
				loadSkill: vi.fn(),
			},
		};

		registry = new ToolRegistry(plugin);
		engine = new ToolExecutionEngine(plugin, registry);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('returns isNewFile=true with empty original and trimmed proposed content', async () => {
		const tool = { name: 'create_skill' } as any;
		const params = { name: 'My-Skill', content: '  skill body content  ' };

		const diff = await (engine as any).buildDiffContext(tool, params);

		expect(diff).toBeDefined();
		expect(diff.filePath).toBe('gemini-scribe/Skills/my-skill/SKILL.md');
		expect(diff.originalContent).toBe('');
		expect(diff.proposedContent).toBe('skill body content');
		expect(diff.isNewFile).toBe(true);
	});
});

describe('ToolExecutionEngine - buildDiffContext for edit_skill', () => {
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
				},
				metadataCache: {
					getFirstLinkpathDest: vi.fn().mockReturnValue(null),
				},
			},
			logger: { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
			skillManager: {
				getSkillsFolderPath: vi.fn().mockReturnValue('gemini-scribe/Skills'),
				loadSkill: vi.fn(),
			},
		};

		registry = new ToolRegistry(plugin);
		engine = new ToolExecutionEngine(plugin, registry);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('returns body diff when content edit is provided', async () => {
		plugin.skillManager.loadSkill.mockResolvedValue('original skill body');

		const tool = { name: 'edit_skill' } as any;
		const params = { name: 'My-Skill', content: '  updated skill body  ' };

		const diff = await (engine as any).buildDiffContext(tool, params);

		expect(diff).toBeDefined();
		expect(diff.filePath).toBe('gemini-scribe/Skills/my-skill/SKILL.md');
		expect(diff.originalContent).toBe('original skill body');
		expect(diff.proposedContent).toBe('updated skill body');
		expect(diff.isNewFile).toBe(false);
	});

	it('returns proposed equals original body for description-only edit', async () => {
		plugin.skillManager.loadSkill.mockResolvedValue('unchanged body');

		const tool = { name: 'edit_skill' } as any;
		const params = { name: 'My-Skill', description: 'new description' };

		const diff = await (engine as any).buildDiffContext(tool, params);

		expect(diff).toBeDefined();
		expect(diff.originalContent).toBe('unchanged body');
		expect(diff.proposedContent).toBe('unchanged body');
	});

	it('returns undefined when neither content nor description provided', async () => {
		const tool = { name: 'edit_skill' } as any;
		const params = { name: 'My-Skill' };

		const diff = await (engine as any).buildDiffContext(tool, params);

		expect(diff).toBeUndefined();
	});

	it('uses empty string when skillManager.loadSkill returns null', async () => {
		plugin.skillManager.loadSkill.mockResolvedValue(null);

		const tool = { name: 'edit_skill' } as any;
		const params = { name: 'My-Skill', content: 'new content' };

		const diff = await (engine as any).buildDiffContext(tool, params);

		expect(diff).toBeDefined();
		expect(diff.originalContent).toBe('');
		expect(diff.proposedContent).toBe('new content');
	});

	it('uses empty string when skillManager is not available', async () => {
		plugin.skillManager = undefined;

		const tool = { name: 'edit_skill' } as any;
		const params = { name: 'My-Skill', content: 'new content' };

		// Re-create engine with updated plugin
		engine = new ToolExecutionEngine(plugin, registry);

		const diff = await (engine as any).buildDiffContext(tool, params);

		expect(diff).toBeDefined();
		expect(diff.originalContent).toBe('');
		expect(diff.filePath).toBe('gemini-scribe/Skills/my-skill/SKILL.md');
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
		registry.registerTool(toolWithParams as any);

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
		registry.registerTool(noopTool as any);
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
		registry.registerTool(noopTool as any);
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

	it('sets _replaceFullContent on append_content when user edits the diff', async () => {
		// Register a fake append_content tool so executeTool doesn't fail
		const appendTool = {
			name: 'append_content',
			description: 'Append content',
			category: ToolCategory.VAULT_OPERATIONS,
			classification: ToolClassification.WRITE,
			requiresConfirmation: true,
			parameters: {
				type: 'object' as const,
				properties: {
					path: { type: 'string' as const, description: 'Path' },
					content: { type: 'string' as const, description: 'Content' },
				},
				required: ['path', 'content'],
			},
			execute: vi.fn().mockImplementation(async (params: any) => {
				// Capture the params to verify _replaceFullContent was set
				return { success: true, data: { params } };
			}),
		};
		registry.registerTool(appendTool as any);

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
		plugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);
		plugin.app.vault.read.mockResolvedValue('original');

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
		// Verify the tool received the user-edited full content with _replaceFullContent flag
		const calledArgs = appendTool.execute.mock.calls[0][0];
		expect(calledArgs.content).toBe('full edited file');
		expect(calledArgs._userEdited).toBe(true);
		expect(calledArgs._replaceFullContent).toBe(true);
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
		registry.registerTool(stringThrowTool as any);

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
