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
		log: vi.fn(),
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		child: vi.fn(function (this: any, _prefix: string) {
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
		it('should return all tools when no policy denies them', () => {
			const readOnlyTool = new TestTool();
			const vaultTool = new DestructiveTestTool();

			registry.registerTool(readOnlyTool);
			registry.registerTool(vaultTool);

			// Cautious (default) maps READ to APPROVE and DESTRUCTIVE to ASK_USER;
			// nothing is DENY, so both tools are enabled.
			const context = { session: { context: {} } } as any;
			const enabledTools = registry.getEnabledTools(context);
			expect(enabledTools).toHaveLength(2);
		});

		it('should drop tools that the feature preset maps to DENY', () => {
			const readOnlyTool = new TestTool();
			const vaultTool = new DestructiveTestTool();

			registry.registerTool(readOnlyTool);
			registry.registerTool(vaultTool);

			// READ_ONLY preset maps WRITE / DESTRUCTIVE / EXTERNAL to DENY, so a
			// session carrying that preset should only see the read tool.
			const context = {
				session: { context: {} },
				featureToolPolicy: { preset: PolicyPreset.READ_ONLY },
			} as any;

			const enabledTools = registry.getEnabledTools(context);
			expect(enabledTools).toHaveLength(1);
			expect(enabledTools[0]).toBe(readOnlyTool);
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

			const context = { session: { context: {} } } as any;
			const enabledTools = registry.getEnabledTools(context);
			expect(enabledTools).toHaveLength(1);
			expect(enabledTools[0]).toBe(readOnlyTool);
		});

		// Pins the documented resolveEffectivePermission precedence:
		// feature overrides > global overrides > feature preset > global preset.
		// Without this, a future "let's just merge the maps" refactor could
		// silently flip the priority and DENY-stuck tools couldn't be opened up
		// by a project / scheduled-task / hook.
		it('feature override wins over a conflicting global override for the same tool', () => {
			const readOnlyTool = new TestTool();
			const vaultTool = new DestructiveTestTool();

			registry.registerTool(readOnlyTool);
			registry.registerTool(vaultTool);

			// Global says DENY...
			mockPlugin.settings.toolPolicy.toolPermissions = {
				destructive_tool: ToolPermission.DENY,
			};

			// ...but the feature explicitly opens it back up.
			const context = {
				session: { context: {} },
				featureToolPolicy: {
					overrides: { destructive_tool: ToolPermission.APPROVE },
				},
			} as any;

			const enabledTools = registry.getEnabledTools(context);
			expect(enabledTools.map((t) => t.name).sort()).toEqual(['destructive_tool', 'test_tool']);
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

	describe('getAutoApprovedTools', () => {
		// Regression for the headless ASK_USER bypass: scheduled tasks and
		// hooks must only see tools with APPROVE permission. ASK_USER tools
		// would otherwise be auto-approved by the headless confirmation
		// provider, silently bypassing the user's "ask first" intent.
		it('returns only tools whose effective permission is APPROVE', () => {
			const readOnlyTool = new TestTool();
			const destructiveTool = new DestructiveTestTool();

			registry.registerTool(readOnlyTool);
			registry.registerTool(destructiveTool);

			// Default CAUTIOUS: READ → APPROVE, DESTRUCTIVE → ASK_USER.
			const context = { session: { context: {} } } as any;
			const tools = registry.getAutoApprovedTools(context);
			expect(tools).toHaveLength(1);
			expect(tools[0]).toBe(readOnlyTool);
		});

		it('upgrades ASK_USER tools to APPROVE when the feature policy says so', () => {
			const readOnlyTool = new TestTool();
			const destructiveTool = new DestructiveTestTool();

			registry.registerTool(readOnlyTool);
			registry.registerTool(destructiveTool);

			const context = {
				session: { context: {} },
				featureToolPolicy: {
					overrides: { destructive_tool: ToolPermission.APPROVE },
				},
			} as any;

			const tools = registry.getAutoApprovedTools(context);
			expect(tools.map((t) => t.name).sort()).toEqual(['destructive_tool', 'test_tool']);
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

		it('should return false when project overrides ASK_USER to APPROVE', () => {
			// destructive_tool is ASK_USER in Cautious mode
			expect(
				registry.requiresConfirmation('destructive_tool', {
					overrides: { destructive_tool: ToolPermission.APPROVE },
				})
			).toBe(false);
		});

		it('should return false when project overrides to DENY (tool blocked, not asked)', () => {
			expect(
				registry.requiresConfirmation('destructive_tool', {
					overrides: { destructive_tool: ToolPermission.DENY },
				})
			).toBe(false);
		});

		it('should return true when project overrides APPROVE to ASK_USER', () => {
			// test_tool is READ → APPROVE in Cautious mode
			expect(
				registry.requiresConfirmation('test_tool', {
					overrides: { test_tool: ToolPermission.ASK_USER },
				})
			).toBe(true);
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

	describe('getEffectivePermission edge cases', () => {
		it('should return DENY for unknown tool', () => {
			expect(registry.getEffectivePermission('nonexistent_tool')).toBe(ToolPermission.DENY);
		});

		it('should fallback to DEFAULT_TOOL_POLICY when settings.toolPolicy is undefined', () => {
			// Temporarily set toolPolicy to undefined
			mockPlugin.settings.toolPolicy = undefined;

			const tool = new TestTool();
			registry.registerTool(tool);

			// DEFAULT_TOOL_POLICY is CAUTIOUS with no overrides.
			// READ classification in CAUTIOUS → APPROVE.
			const result = registry.getEffectivePermission('test_tool');
			expect(result).toBe(ToolPermission.APPROVE);
		});

		it('should fallback to DEFAULT_TOOL_POLICY when settings.toolPolicy is null', () => {
			mockPlugin.settings.toolPolicy = null;

			const tool = new TestTool();
			registry.registerTool(tool);

			const result = registry.getEffectivePermission('test_tool');
			expect(result).toBe(ToolPermission.APPROVE);
		});
	});

	describe('validateParameters edge cases', () => {
		it('should detect unknown parameters', () => {
			registry.registerTool(new TestTool());

			const result = registry.validateParameters('test_tool', {
				message: 'hello',
				unknownParam: 'should fail',
			});

			expect(result.valid).toBe(false);
			expect(result.errors).toContain('Unknown parameter: unknownParam');
		});

		it('should validate enum - valid value', () => {
			// Create a tool with an enum parameter
			const enumTool: Tool = {
				name: 'enum_tool',
				category: ToolCategory.READ_ONLY,
				classification: ToolClassification.READ,
				description: 'Tool with enum param',
				parameters: {
					type: 'object' as const,
					properties: {
						color: {
							type: 'string' as const,
							description: 'Pick a color',
							enum: ['red', 'green', 'blue'],
						},
					},
					required: ['color'],
				},
				execute: vi.fn(),
			};
			registry.registerTool(enumTool);

			const result = registry.validateParameters('enum_tool', { color: 'red' });
			expect(result.valid).toBe(true);
			expect(result.errors).toBeUndefined();
		});

		it('should validate enum - invalid value', () => {
			const enumTool: Tool = {
				name: 'enum_tool2',
				category: ToolCategory.READ_ONLY,
				classification: ToolClassification.READ,
				description: 'Tool with enum param',
				parameters: {
					type: 'object' as const,
					properties: {
						color: {
							type: 'string' as const,
							description: 'Pick a color',
							enum: ['red', 'green', 'blue'],
						},
					},
					required: ['color'],
				},
				execute: vi.fn(),
			};
			registry.registerTool(enumTool);

			const result = registry.validateParameters('enum_tool2', { color: 'yellow' });
			expect(result.valid).toBe(false);
			expect(result.errors).toContain('Parameter color must be one of: red, green, blue');
		});

		it('should reject array when string is expected', () => {
			registry.registerTool(new TestTool());

			const result = registry.validateParameters('test_tool', {
				message: ['not', 'a', 'string'],
			});

			expect(result.valid).toBe(false);
			expect(result.errors).toContain('Parameter message should be string but got array');
		});
	});

	describe('getToolDescriptions', () => {
		it('should return correct format with function wrappers', () => {
			const tool = new TestTool();
			registry.registerTool(tool);

			const context = { session: { context: {} } } as any;
			const descriptions = registry.getToolDescriptions(context);

			expect(descriptions).toHaveLength(1);
			expect(descriptions[0]).toEqual({
				type: 'function',
				function: {
					name: 'test_tool',
					description: 'A test tool',
					parameters: {
						type: 'object',
						properties: {
							message: {
								type: 'string',
								description: 'A test message',
							},
						},
						required: ['message'],
					},
				},
			});
		});

		it('should only include enabled (non-DENY) tools', () => {
			const readTool = new TestTool();
			const destructiveTool = new DestructiveTestTool();

			registry.registerTool(readTool);
			registry.registerTool(destructiveTool);

			// DENY the destructive tool
			mockPlugin.settings.toolPolicy.toolPermissions = {
				destructive_tool: ToolPermission.DENY,
			};

			const context = { session: { context: {} } } as any;
			const descriptions = registry.getToolDescriptions(context);

			expect(descriptions).toHaveLength(1);
			expect(descriptions[0].function.name).toBe('test_tool');
		});
	});

	describe('unregisterTool', () => {
		it('should return true when unregistering an existing tool', () => {
			registry.registerTool(new TestTool());

			const result = registry.unregisterTool('test_tool');

			expect(result).toBe(true);
			expect(registry.getTool('test_tool')).toBeUndefined();
		});

		it('should return false when unregistering a non-existent tool', () => {
			const result = registry.unregisterTool('nonexistent_tool');
			expect(result).toBe(false);
		});

		it('should remove tool from getAllTools after unregistering', () => {
			const tool = new TestTool();
			registry.registerTool(tool);
			expect(registry.getAllTools()).toHaveLength(1);

			registry.unregisterTool('test_tool');
			expect(registry.getAllTools()).toHaveLength(0);
		});
	});
});
