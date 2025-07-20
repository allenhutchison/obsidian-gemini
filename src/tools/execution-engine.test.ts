import { ToolExecutionEngine } from './execution-engine';
import { ToolRegistry } from './tool-registry';
import { ReadFileTool, ListFilesTool, WriteFileTool } from './vault-tools';
import { ToolCategory } from '../types/agent';
import { Notice } from 'obsidian';

// Mock Obsidian
jest.mock('obsidian', () => ({
	...jest.requireActual('../../__mocks__/obsidian.js'),
	Notice: jest.fn().mockImplementation(() => ({
		hide: jest.fn()
	})),
	normalizePath: jest.fn((path: string) => path),
	TFile: class TFile {
		path: string = '';
		name: string = '';
		stat = { size: 0, mtime: Date.now(), ctime: Date.now() };
	},
	TFolder: class TFolder {
		path: string = '';
		name: string = '';
		children: any[] = [];
	}
}));

// Mock the confirmation modal
jest.mock('../ui/tool-confirmation-modal', () => ({
	ToolConfirmationModal: jest.fn()
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
				loopDetectionTimeWindowSeconds: 60
			},
			app: {
				vault: {
					getAbstractFileByPath: jest.fn(),
					read: jest.fn().mockResolvedValue('file content'),
					getMarkdownFiles: jest.fn().mockReturnValue([]),
					getRoot: jest.fn().mockReturnValue({ children: [] })
				}
			},
			agentView: null
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
		jest.clearAllMocks();
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
					requireConfirmation: [] // No confirmations required
				}
			}
		} as any;

		// Test read_file - should not require confirmation
		const readResult = await engine.executeTool({
			name: 'read_file',
			arguments: { path: 'test.md' }
		}, context);

		// Tool should execute without confirmation
		expect(readResult.success).toBe(false); // Will fail because file doesn't exist, but that's ok
		expect(readResult.error).toBe('File not found: test.md');

		// Test list_files - should not require confirmation
		const listResult = await engine.executeTool({
			name: 'list_files',
			arguments: { path: '' }
		}, context);

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
					requireConfirmation: ['modify_files'] // Require confirmation for file modifications
				}
			}
		} as any;

		// Mock user declining confirmation
		const { ToolConfirmationModal } = require('../ui/tool-confirmation-modal');
		ToolConfirmationModal.mockImplementation((app: any, tool: any, params: any, callback: Function) => ({
			open: jest.fn(() => {
				// Simulate user declining
				callback(false);
			})
		}));

		// Test write_file - should require confirmation
		const writeResult = await engine.executeTool({
			name: 'write_file',
			arguments: { path: 'test.md', content: 'new content' }
		}, context);

		expect(writeResult.success).toBe(false);
		expect(writeResult.error).toBe('User declined tool execution');
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
				loopDetectionTimeWindowSeconds: 60
			},
			app: {
				vault: {
					getAbstractFileByPath: jest.fn(),
					read: jest.fn().mockResolvedValue('file content'),
					getMarkdownFiles: jest.fn().mockReturnValue([]),
					getRoot: jest.fn().mockReturnValue({ children: [] })
				}
			},
			agentView: null
		};

		// Create registry and engine
		registry = new ToolRegistry(plugin);
		engine = new ToolExecutionEngine(plugin, registry);
	});

	afterEach(() => {
		jest.clearAllMocks();
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
					requireConfirmation: []
				}
			}
		} as any;

		const result = await engine.executeTool({
			name: 'non_existent_tool',
			arguments: {}
		}, context);

		expect(result.success).toBe(false);
		expect(result.error).toBe('Tool not found: non_existent_tool');
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
					requireConfirmation: []
				}
			}
		} as any;

		// Register a VAULT_OPERATIONS tool
		registry.registerTool(new WriteFileTool());

		const result = await engine.executeTool({
			name: 'write_file',
			arguments: { path: 'test.md', content: 'content' }
		}, context);

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
					requireConfirmation: []
				}
			}
		} as any;

		// Register a tool that throws
		const errorTool = {
			name: 'error_tool',
			description: 'A tool that always throws',
			category: ToolCategory.READ_ONLY,
			parameters: {
				type: 'object' as const,
				properties: {},
				required: []
			},
			execute: jest.fn().mockRejectedValue(new Error('Tool execution failed'))
		};
		registry.registerTool(errorTool);

		const result = await engine.executeTool({
			name: 'error_tool',
			arguments: {}
		}, context);

		expect(result.success).toBe(false);
		expect(result.error).toBe('Tool execution failed: Error: Tool execution failed');
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
					requireConfirmation: []
				}
			}
		} as any;

		registry.registerTool(new ReadFileTool());

		// Missing required 'path' argument
		const result = await engine.executeTool({
			name: 'read_file',
			arguments: {}
		}, context);

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
					requireConfirmation: []
				}
			}
		} as any;

		registry.registerTool(new ListFilesTool());

		// Execute multiple tool calls
		const results = await engine.executeMultipleTools([
			{ name: 'list_files', arguments: { path: '' } }, // Should succeed
			{ name: 'non_existent', arguments: {} }, // Should fail
			{ name: 'list_files', arguments: { path: 'folder' } } // Should succeed
		], context);

		expect(results).toHaveLength(3);
		expect(results[0].success).toBe(true);
		expect(results[1].success).toBe(false);
		expect(results[1].error).toBe('Tool not found: non_existent');
		expect(results[2].success).toBe(true);
	});
});