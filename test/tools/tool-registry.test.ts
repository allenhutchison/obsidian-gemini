import { ToolRegistry } from '../../src/tools/tool-registry';
import { Tool, ToolResult, ToolExecutionContext } from '../../src/tools/types';
import { ToolCategory } from '../../src/types/agent';
import { ToolClassification, PolicyPreset, ToolPermission } from '../../src/types/tool-policy';

// Mock plugin
const mockPlugin = {
	app: {
		vault: {},
		workspace: {},
		metadataCache: {},
	},
	settings: {
		toolPolicy: {
			activePreset: PolicyPreset.CAUTIOUS,
			toolPermissions: {},
		},
	},
	logger: {
		log: jest.fn(),
		debug: jest.fn(),
		warn: jest.fn(),
		error: jest.fn(),
		child: jest.fn(function (this: any, _prefix: string) {
			return this;
		}),
	},
} as any;

// Create a test tool
class TestTool implements Tool {
	name = 'test_tool';
	category = ToolCategory.READ_ONLY;
	classification = ToolClassification.READ;
	description = 'A test tool';

	parameters = {
		type: 'object' as const,
		properties: {
			message: {
				type: 'string' as const,
				description: 'A test message',
			},
		},
		required: ['message'],
	};

	async execute(params: { message: string }, _context: ToolExecutionContext): Promise<ToolResult> {
		return {
			success: true,
			data: { response: `Hello, ${params.message}!` },
		};
	}
}

class DestructiveTestTool implements Tool {
	name = 'destructive_tool';
	category = ToolCategory.VAULT_OPERATIONS;
	classification = ToolClassification.DESTRUCTIVE;
	description = 'A destructive test tool';
	requiresConfirmation = true;

	parameters = {
		type: 'object' as const,
		properties: {
			action: {
				type: 'string' as const,
				description: 'The action to perform',
			},
		},
		required: ['action'],
	};

	async execute(params: { action: string }, _context: ToolExecutionContext): Promise<ToolResult> {
		return {
			success: true,
			data: { performed: params.action },
		};
	}
}

class WriteTestTool implements Tool {
	name: string;
	category = ToolCategory.VAULT_OPERATIONS;
	classification = ToolClassification.WRITE;
	description = 'A write test tool';

	parameters = {
		type: 'object' as const,
		properties: {
			content: {
				type: 'string' as const,
				description: 'Content to write',
			},
		},
		required: ['content'],
	};

	constructor(name: string) {
		this.name = name;
	}

	async execute(params: { content: string }, _context: ToolExecutionContext): Promise<ToolResult> {
		return {
			success: true,
			data: { written: params.content },
		};
	}
}

describe('ToolRegistry', () => {
	let registry: ToolRegistry;

	beforeEach(() => {
		registry = new ToolRegistry(mockPlugin);
		// Reset to Cautious preset for each test
		mockPlugin.settings.toolPolicy = {
			activePreset: PolicyPreset.CAUTIOUS,
			toolPermissions: {},
		};
	});

	describe('registerTool', () => {
		it('should register a tool successfully', () => {
			const tool = new TestTool();
			registry.registerTool(tool);

			expect(registry.getTool('test_tool')).toBe(tool);
		});

		it('should warn when registering duplicate tool', () => {
			const tool1 = new TestTool();
			const tool2 = new TestTool();

			registry.registerTool(tool1);
			registry.registerTool(tool2);

			expect(mockPlugin.logger.warn).toHaveBeenCalledWith('Tool test_tool is already registered, overwriting...');
		});
	});

	describe('getTool', () => {
		it('should return undefined for non-existent tool', () => {
			expect(registry.getTool('non_existent')).toBeUndefined();
		});

		it('should return registered tool', () => {
			const tool = new TestTool();
			registry.registerTool(tool);

			expect(registry.getTool('test_tool')).toBe(tool);
		});
	});

	describe('getToolsByCategory', () => {
		it('should return tools by category', () => {
			const readOnlyTool = new TestTool();
			const vaultTool = new DestructiveTestTool();

			registry.registerTool(readOnlyTool);
			registry.registerTool(vaultTool);

			const readOnlyTools = registry.getToolsByCategory(ToolCategory.READ_ONLY);
			const vaultTools = registry.getToolsByCategory(ToolCategory.VAULT_OPERATIONS);

			expect(readOnlyTools).toHaveLength(1);
			expect(readOnlyTools[0]).toBe(readOnlyTool);
			expect(vaultTools).toHaveLength(1);
			expect(vaultTools[0]).toBe(vaultTool);
		});

		it('should return empty array for category with no tools', () => {
			const tools = registry.getToolsByCategory(ToolCategory.EXTERNAL_MCP);
			expect(tools).toHaveLength(0);
		});
	});

	describe('validateParameters', () => {
		beforeEach(() => {
			registry.registerTool(new TestTool());
		});

		it('should validate correct parameters', () => {
			const result = registry.validateParameters('test_tool', { message: 'hello' });
			expect(result.valid).toBe(true);
			expect(result.errors).toBeUndefined();
		});

		it('should reject missing required parameters', () => {
			const result = registry.validateParameters('test_tool', {});
			expect(result.valid).toBe(false);
			expect(result.errors).toContain('Missing required parameter: message');
		});

		it('should reject invalid parameter types', () => {
			const result = registry.validateParameters('test_tool', { message: 123 });
			expect(result.valid).toBe(false);
			expect(result.errors).toContain('Parameter message should be string but got number');
		});

		it('should return invalid for non-existent tool', () => {
			const result = registry.validateParameters('non_existent', { message: 'hello' });
			expect(result.valid).toBe(false);
			expect(result.errors).toContain('Tool non_existent not found');
		});
	});

	describe('getEnabledTools', () => {
		it('should return tools enabled for context', () => {
			const readOnlyTool = new TestTool();
			const vaultTool = new DestructiveTestTool();

			registry.registerTool(readOnlyTool);
			registry.registerTool(vaultTool);

			const context = {
				session: {
					context: {
						enabledTools: [ToolCategory.READ_ONLY],
					},
				},
			} as any;

			const enabledTools = registry.getEnabledTools(context);
			expect(enabledTools).toHaveLength(1);
			expect(enabledTools[0]).toBe(readOnlyTool);
		});

		it('should return empty array when no tools enabled', () => {
			const context = {
				session: {
					context: {
						enabledTools: [],
					},
				},
			} as any;

			const enabledTools = registry.getEnabledTools(context);
			expect(enabledTools).toHaveLength(0);
		});

		it('should filter out DENY tools from enabled list', () => {
			const readOnlyTool = new TestTool();
			const vaultTool = new DestructiveTestTool();

			registry.registerTool(readOnlyTool);
			registry.registerTool(vaultTool);

			// Set destructive_tool to DENY via per-tool override
			mockPlugin.settings.toolPolicy.toolPermissions = {
				destructive_tool: ToolPermission.DENY,
			};

			const context = {
				session: {
					context: {
						enabledTools: [ToolCategory.READ_ONLY, ToolCategory.VAULT_OPERATIONS],
					},
				},
			} as any;

			const enabledTools = registry.getEnabledTools(context);
			expect(enabledTools).toHaveLength(1);
			expect(enabledTools[0]).toBe(readOnlyTool);
		});

		it('should preserve permissions for untouched tools when switching to CUSTOM', () => {
			const writeToolA = new WriteTestTool('write_tool_a');
			const writeToolB = new WriteTestTool('write_tool_b');

			registry.registerTool(writeToolA);
			registry.registerTool(writeToolB);

			// Start in EDIT_MODE where WRITE tools get APPROVE
			mockPlugin.settings.toolPolicy.activePreset = PolicyPreset.EDIT_MODE;
			mockPlugin.settings.toolPolicy.toolPermissions = {};

			expect(registry.getEffectivePermission('write_tool_a')).toBe(ToolPermission.APPROVE);
			expect(registry.getEffectivePermission('write_tool_b')).toBe(ToolPermission.APPROVE);

			// Switch to CUSTOM and override only write_tool_a
			mockPlugin.settings.toolPolicy.activePreset = PolicyPreset.CUSTOM;
			mockPlugin.settings.toolPolicy.toolPermissions = {
				write_tool_a: ToolPermission.ASK_USER,
				write_tool_b: ToolPermission.APPROVE, // materialized from EDIT_MODE
			};

			expect(registry.getEffectivePermission('write_tool_a')).toBe(ToolPermission.ASK_USER);
			// write_tool_b should retain its EDIT_MODE permission, not fall back to CUSTOM defaults
			expect(registry.getEffectivePermission('write_tool_b')).toBe(ToolPermission.APPROVE);
		});
	});

	describe('requiresConfirmation', () => {
		beforeEach(() => {
			registry.registerTool(new TestTool());
			registry.registerTool(new DestructiveTestTool());
		});

		it('should return false for READ tool in Cautious mode', () => {
			expect(registry.requiresConfirmation('test_tool')).toBe(false);
		});

		it('should return true for DESTRUCTIVE tool in Cautious mode', () => {
			expect(registry.requiresConfirmation('destructive_tool')).toBe(true);
		});
	});

	describe('getAllTools', () => {
		it('should return all registered tools', () => {
			const tool1 = new TestTool();
			const tool2 = new DestructiveTestTool();

			registry.registerTool(tool1);
			registry.registerTool(tool2);

			const allTools = registry.getAllTools();
			expect(allTools).toHaveLength(2);
			expect(allTools).toContain(tool1);
			expect(allTools).toContain(tool2);
		});

		it('should return empty array when no tools registered', () => {
			const allTools = registry.getAllTools();
			expect(allTools).toHaveLength(0);
		});
	});
});
