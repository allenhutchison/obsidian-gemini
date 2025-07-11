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