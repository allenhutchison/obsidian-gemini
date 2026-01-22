import { ToolRegistry } from '../../src/tools/tool-registry';
import { Tool, ToolResult, ToolExecutionContext } from '../../src/tools/types';
import { ToolCategory } from '../../src/types/agent';

// Mock plugin
const mockPlugin = {
	app: {
		vault: {},
		workspace: {},
		metadataCache: {},
	},
	logger: {
		log: jest.fn(),
		debug: jest.fn(),
		warn: jest.fn(),
		error: jest.fn(),
		child: jest.fn(function (this: any, prefix: string) {
			return this;
		}),
	},
} as any;

// Create a test tool
class TestTool implements Tool {
	name = 'test_tool';
	category = ToolCategory.READ_ONLY;
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

	async execute(params: { message: string }, context: ToolExecutionContext): Promise<ToolResult> {
		return {
			success: true,
			data: { response: `Hello, ${params.message}!` },
		};
	}
}

class DestructiveTestTool implements Tool {
	name = 'destructive_tool';
	category = ToolCategory.VAULT_OPERATIONS;
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

	async execute(params: { action: string }, context: ToolExecutionContext): Promise<ToolResult> {
		return {
			success: true,
			data: { performed: params.action },
		};
	}
}

describe('ToolRegistry', () => {
	let registry: ToolRegistry;

	beforeEach(() => {
		registry = new ToolRegistry(mockPlugin);
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
	});

	describe('requiresConfirmation', () => {
		beforeEach(() => {
			registry.registerTool(new TestTool());
			registry.registerTool(new DestructiveTestTool());
		});

		it('should return false for non-destructive tool', () => {
			const context = {
				session: {
					context: {
						requireConfirmation: [],
					},
				},
			} as any;

			expect(registry.requiresConfirmation('test_tool', context)).toBe(false);
		});

		it('should return true for destructive tool', () => {
			const context = {
				session: {
					context: {
						requireConfirmation: [],
					},
				},
			} as any;

			expect(registry.requiresConfirmation('destructive_tool', context)).toBe(true);
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
