import { Tool, ToolResult, ToolExecutionContext, ToolCall, ToolExecution } from './types';
import { ToolRegistry } from './tool-registry';
import { ChatSession } from '../types/agent';
import { Notice } from 'obsidian';
import { ToolConfirmationModal } from '../ui/tool-confirmation-modal';
import type ObsidianGemini from '../main';

/**
 * Handles execution of tools with permission checks and UI feedback
 */
export class ToolExecutionEngine {
	private plugin: InstanceType<typeof ObsidianGemini>;
	private registry: ToolRegistry;
	private executionHistory: Map<string, ToolExecution[]> = new Map();

	constructor(plugin: InstanceType<typeof ObsidianGemini>, registry: ToolRegistry) {
		this.plugin = plugin;
		this.registry = registry;
	}

	/**
	 * Execute a tool call with appropriate checks and UI feedback
	 */
	async executeTool(
		toolCall: ToolCall, 
		context: ToolExecutionContext
	): Promise<ToolResult> {
		const tool = this.registry.getTool(toolCall.name);
		
		if (!tool) {
			return {
				success: false,
				error: `Tool ${toolCall.name} not found`
			};
		}

		// Validate parameters
		const validation = this.registry.validateParameters(toolCall.name, toolCall.arguments);
		if (!validation.valid) {
			return {
				success: false,
				error: `Invalid parameters: ${validation.errors?.join(', ')}`
			};
		}

		// Check if tool is enabled for current session
		const enabledTools = this.registry.getEnabledTools(context);
		if (!enabledTools.includes(tool)) {
			return {
				success: false,
				error: `Tool ${tool.name} is not enabled for this session`
			};
		}

		// Check if confirmation is required
		const requiresConfirmation = this.registry.requiresConfirmation(toolCall.name, context);
		
		if (requiresConfirmation) {
			const confirmed = await this.requestUserConfirmation(tool, toolCall.arguments);
			if (!confirmed) {
				return {
					success: false,
					error: 'User declined tool execution'
				};
			}
		}

		// Show execution notification
		const executionNotice = new Notice(`Executing ${tool.name}...`, 0);

		try {
			// Execute the tool
			const result = await tool.execute(toolCall.arguments, context);

			// Record execution in history
			const execution: ToolExecution = {
				toolName: tool.name,
				parameters: toolCall.arguments,
				result: result,
				timestamp: new Date(),
				confirmed: requiresConfirmation
			};

			this.addToHistory(context.session.id, execution);

			// Update UI with result
			executionNotice.hide();
			
			if (result.success) {
				new Notice(`✓ ${tool.name} completed successfully`, 3000);
			} else {
				new Notice(`✗ ${tool.name} failed: ${result.error}`, 5000);
			}
			
			return result;

		} catch (error) {
			executionNotice.hide();
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			new Notice(`✗ ${tool.name} error: ${errorMessage}`, 5000);
			
			const errorResult = {
				success: false,
				error: errorMessage
			};
			
			
			return errorResult;
		}
	}

	/**
	 * Execute multiple tool calls in sequence
	 */
	async executeToolCalls(
		toolCalls: ToolCall[], 
		context: ToolExecutionContext
	): Promise<ToolResult[]> {
		const results: ToolResult[] = [];
		
		for (const toolCall of toolCalls) {
			const result = await this.executeTool(toolCall, context);
			results.push(result);
			
			// Stop execution chain if a tool fails (unless configured otherwise)
			if (!result.success && this.plugin.settings.stopOnToolError !== false) {
				break;
			}
		}
		
		return results;
	}

	/**
	 * Request user confirmation for tool execution
	 */
	private async requestUserConfirmation(
		tool: Tool, 
		parameters: any
	): Promise<boolean> {
		return new Promise((resolve) => {
			const modal = new ToolConfirmationModal(
				this.plugin.app,
				tool,
				parameters,
				(confirmed) => {
					resolve(confirmed);
				}
			);
			modal.open();
		});
	}

	/**
	 * Add execution to history
	 */
	private addToHistory(sessionId: string, execution: ToolExecution) {
		const history = this.executionHistory.get(sessionId) || [];
		history.push(execution);
		this.executionHistory.set(sessionId, history);
	}

	/**
	 * Get execution history for a session
	 */
	getExecutionHistory(sessionId: string): ToolExecution[] {
		return this.executionHistory.get(sessionId) || [];
	}

	/**
	 * Clear execution history for a session
	 */
	clearExecutionHistory(sessionId: string) {
		this.executionHistory.delete(sessionId);
	}

	/**
	 * Format tool results for display in chat
	 */
	formatToolResult(execution: ToolExecution): string {
		const icon = execution.result.success ? '✓' : '✗';
		const status = execution.result.success ? 'Success' : 'Failed';
		
		let formatted = `### Tool Execution: ${execution.toolName}\n\n`;
		formatted += `**Status:** ${icon} ${status}\n\n`;
		
		if (execution.result.data) {
			formatted += `**Result:**\n\`\`\`json\n${JSON.stringify(execution.result.data, null, 2)}\n\`\`\`\n`;
		}
		
		if (execution.result.error) {
			formatted += `**Error:** ${execution.result.error}\n`;
		}
		
		return formatted;
	}

	/**
	 * Get available tools for the current context as formatted descriptions
	 */
	getAvailableToolsDescription(context: ToolExecutionContext): string {
		const tools = this.registry.getEnabledTools(context);
		
		if (tools.length === 0) {
			return 'No tools are currently available.';
		}
		
		let description = '## Available Tools\n\n';
		
		for (const tool of tools) {
			description += `### ${tool.name}\n`;
			description += `${tool.description}\n\n`;
			
			if (tool.parameters.properties && Object.keys(tool.parameters.properties).length > 0) {
				description += '**Parameters:**\n';
				for (const [param, schema] of Object.entries(tool.parameters.properties)) {
					const required = tool.parameters.required?.includes(param) ? ' (required)' : '';
					description += `- \`${param}\` (${schema.type})${required}: ${schema.description}\n`;
				}
				description += '\n';
			}
		}
		
		return description;
	}
}