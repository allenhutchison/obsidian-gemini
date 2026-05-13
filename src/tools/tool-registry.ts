import { Tool, ToolExecutionContext } from './types';
import {
	ToolPermission,
	FeatureToolPolicy,
	resolveEffectivePermission,
	ToolPolicySettings,
	DEFAULT_TOOL_POLICY,
} from '../types/tool-policy';
import type ObsidianGemini from '../main';

/**
 * Registry for managing available tools
 */
export class ToolRegistry {
	private tools = new Map<string, Tool>();
	private plugin: ObsidianGemini;

	constructor(plugin: ObsidianGemini) {
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
	 * Resolve the effective permission for a tool, layering the optional
	 * feature-level policy on top of the global plugin policy.
	 *
	 * Resolution order (most specific wins):
	 *   1. Feature `overrides[toolName]`
	 *   2. Global `toolPermissions[toolName]`
	 *   3. Feature `preset[classification]`
	 *   4. Global `activePreset[classification]`
	 */
	getEffectivePermission(toolName: string, featurePolicy?: FeatureToolPolicy): ToolPermission {
		const tool = this.getTool(toolName);
		if (!tool) return ToolPermission.DENY;

		return resolveEffectivePermission(toolName, tool.classification, this.getToolPolicy(), featurePolicy);
	}

	/**
	 * Get tools that are enabled for the current execution context.
	 *
	 * A tool is enabled iff its effective permission is not DENY. Filtering is
	 * permission-driven only — there is no category filter. To narrow the tool
	 * surface for a feature run, set a `featureToolPolicy` whose preset (or
	 * per-tool overrides) maps the unwanted tools to DENY.
	 */
	getEnabledTools(context: ToolExecutionContext): Tool[] {
		return this.getAllTools().filter(
			(tool) => this.getEffectivePermission(tool.name, context.featureToolPolicy) !== ToolPermission.DENY
		);
	}

	/**
	 * Subset of `getEnabledTools` for headless callers (scheduled tasks, hooks).
	 *
	 * Returns only tools whose effective permission is APPROVE — i.e. tools the
	 * user has explicitly opted into. Tools mapped to ASK_USER are excluded
	 * because headless runs auto-approve every confirmation prompt, which would
	 * silently bypass the user's ASK_USER intent. To allow a tool in a headless
	 * flow, the task / hook policy must explicitly mark it APPROVE (via preset
	 * or `overrides`).
	 */
	getAutoApprovedTools(context: ToolExecutionContext): Tool[] {
		return this.getAllTools().filter(
			(tool) => this.getEffectivePermission(tool.name, context.featureToolPolicy) === ToolPermission.APPROVE
		);
	}

	/**
	 * Check if a tool requires confirmation based on the effective policy.
	 *
	 * - APPROVE → no confirmation needed
	 * - ASK_USER → confirmation required
	 * - DENY → tool should not be present (but returns false as a safe default)
	 */
	requiresConfirmation(toolName: string, featurePolicy?: FeatureToolPolicy): boolean {
		return this.getEffectivePermission(toolName, featurePolicy) === ToolPermission.ASK_USER;
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
