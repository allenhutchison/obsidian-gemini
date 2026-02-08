import { Tool, ToolExecutionContext } from './types';
import { ToolCategory, DestructiveAction } from '../types/agent';
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
	 * Get all tools
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
	 * Get tools that are enabled for the current session
	 */
	getEnabledTools(context: ToolExecutionContext): Tool[] {
		const enabledCategories = context.session.context.enabledTools;
		return this.getAllTools().filter((tool) => enabledCategories.includes(tool.category as ToolCategory));
	}

	/**
	 * Check if a tool requires confirmation based on session settings.
	 *
	 * For MCP tools, per-tool trust (requiresConfirmation = false) takes
	 * precedence over the session-level category check so that trusted
	 * tools can skip confirmation even though EXTERNAL_API_CALLS is in
	 * the default session context.
	 */
	requiresConfirmation(toolName: string, context: ToolExecutionContext): boolean {
		const tool = this.getTool(toolName);
		if (!tool) return false;

		// Check if tool explicitly requires confirmation
		if (tool.requiresConfirmation) return true;

		// MCP tools have per-tool trust: if the tool explicitly opted out
		// of confirmation, honour that instead of the category-level check.
		if (tool.category === ToolCategory.EXTERNAL_MCP) {
			return false;
		}

		// Check session-level confirmation requirements
		const confirmActions = context.session.context.requireConfirmation;

		// Map tool categories to destructive actions
		const categoryActionMap: Record<string, DestructiveAction> = {
			[ToolCategory.VAULT_OPERATIONS]: DestructiveAction.MODIFY_FILES,
		};

		const action = categoryActionMap[tool.category];
		return action ? confirmActions.includes(action) : false;
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
