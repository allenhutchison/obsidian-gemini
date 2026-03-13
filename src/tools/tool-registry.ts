import { Tool, ToolExecutionContext } from './types';
import { ToolCategory } from '../types/agent';
import { ToolPermission, resolvePermission, ToolPolicySettings, DEFAULT_TOOL_POLICY } from '../types/tool-policy';
import type ObsidianGemini from '../main';

/**
 * Registry for managing available tools
 */
export class ToolRegistry {
	private tools = new Map<string, Tool>();
	private plugin: InstanceType<typeof ObsidianGemini>;

	constructor(plugin: InstanceType<typeof ObsidianGemini>) {
		this.plugin = plugin;
	}

	/**
	 * Register a new tool
	 */
	registerTool(tool: Tool): void {
		if (this.tools.has(tool.name)) {
			this.plugin.logger.warn(`Tool ${tool.name} is already registered, overwriting...`);
		}
		this.tools.set(tool.name, tool);
	}

	/**
	 * Unregister a tool
	 */
	unregisterTool(toolName: string): boolean {
		return this.tools.delete(toolName);
	}

	/**
	 * Get a tool by name
	 */
	getTool(name: string): Tool | undefined {
		return this.tools.get(name);
	}

	/**
	 * Get all tools (regardless of policy)
	 */
	getAllTools(): Tool[] {
		return Array.from(this.tools.values());
	}

	/**
	 * Get tools by category
	 */
	getToolsByCategory(category: string): Tool[] {
		return this.getAllTools().filter((tool) => tool.category === category);
	}

	/**
	 * Get the current tool policy settings from the plugin.
	 * Falls back to DEFAULT_TOOL_POLICY if not yet configured.
	 */
	private getToolPolicy(): ToolPolicySettings {
		return this.plugin.settings?.toolPolicy ?? DEFAULT_TOOL_POLICY;
	}

	/**
	 * Resolve the effective permission for a tool based on the current policy settings.
	 *
	 * Resolution order:
	 * 1. Explicit per-tool override in `toolPolicy.toolPermissions`
	 * 2. Preset-defined permission based on tool classification
	 */
	getEffectivePermission(toolName: string): ToolPermission {
		const tool = this.getTool(toolName);
		if (!tool) return ToolPermission.DENY;

		return resolvePermission(toolName, tool.classification, this.getToolPolicy());
	}

	/**
	 * Get tools that are enabled for the current session.
	 *
	 * A tool is enabled if:
	 * 1. Its category is in the session's `enabledTools` list (session-level filtering)
	 * 2. Its effective permission is NOT `DENY` (global policy filtering)
	 *
	 * Session contexts never escalate beyond global policy — a DENY tool
	 * cannot be enabled by a session.
	 */
	getEnabledTools(context: ToolExecutionContext): Tool[] {
		const enabledCategories = context.session.context.enabledTools;
		return this.getAllTools().filter((tool) => {
			// Session-level category filter
			if (!enabledCategories.includes(tool.category as ToolCategory)) {
				return false;
			}
			// Global policy filter — exclude DENY tools
			return this.getEffectivePermission(tool.name) !== ToolPermission.DENY;
		});
	}

	/**
	 * Check if a tool requires confirmation based on global policy.
	 *
	 * - APPROVE → no confirmation needed
	 * - ASK_USER → confirmation required
	 * - DENY → tool should not be present (but returns false as a safe default)
	 */
	requiresConfirmation(toolName: string): boolean {
		return this.getEffectivePermission(toolName) === ToolPermission.ASK_USER;
	}

	/**
	 * Get tool descriptions for AI context
	 */
	getToolDescriptions(context: ToolExecutionContext): Array<{
		type: 'function';
		function: {
			name: string;
			description: string;
			parameters: any;
		};
	}> {
		const enabledTools = this.getEnabledTools(context);

		return enabledTools.map((tool) => ({
			type: 'function' as const,
			function: {
				name: tool.name,
				description: tool.description,
				parameters: tool.parameters,
			},
		}));
	}

	/**
	 * Validate tool parameters against schema
	 */
	validateParameters(toolName: string, params: any): { valid: boolean; errors?: string[] } {
		const tool = this.getTool(toolName);
		if (!tool) {
			return { valid: false, errors: [`Tool ${toolName} not found`] };
		}

		const errors: string[] = [];
		const schema = tool.parameters;

		// Check required parameters
		if (schema.required) {
			for (const required of schema.required) {
				if (!(required in params)) {
					errors.push(`Missing required parameter: ${required}`);
				}
			}
		}

		// Validate parameter types
		for (const [key, value] of Object.entries(params)) {
			const propSchema = schema.properties[key];
			if (!propSchema) {
				errors.push(`Unknown parameter: ${key}`);
				continue;
			}

			// Basic type validation
			const actualType = Array.isArray(value) ? 'array' : typeof value;
			if (actualType !== propSchema.type) {
				errors.push(`Parameter ${key} should be ${propSchema.type} but got ${actualType}`);
			}

			// Enum validation
			if (propSchema.enum && !propSchema.enum.includes(value)) {
				errors.push(`Parameter ${key} must be one of: ${propSchema.enum.join(', ')}`);
			}
		}

		return {
			valid: errors.length === 0,
			errors: errors.length > 0 ? errors : undefined,
		};
	}
}
