import { Tool, ToolResult, ToolExecutionContext, ToolCall, ToolExecution } from './types';
import { ToolRegistry } from './tool-registry';
import { ChatSession } from '../types/agent';
import { ToolConfirmationModal } from '../ui/tool-confirmation-modal';
import { ToolLoopDetector } from './loop-detector';
import type ObsidianGemini from '../main';

/**
 * Handles execution of tools with permission checks and UI feedback
 */
export class ToolExecutionEngine {
	private plugin: InstanceType<typeof ObsidianGemini>;
	private registry: ToolRegistry;
	private executionHistory: Map<string, ToolExecution[]> = new Map();
	private loopDetector: ToolLoopDetector;

	constructor(plugin: InstanceType<typeof ObsidianGemini>, registry: ToolRegistry) {
		this.plugin = plugin;
		this.registry = registry;
		this.loopDetector = new ToolLoopDetector(
			plugin.settings.loopDetectionThreshold,
			plugin.settings.loopDetectionTimeWindowSeconds
		);
	}

	/**
	 * Execute a tool call with appropriate checks and UI feedback
	 */
	async executeTool(
		toolCall: ToolCall, 
		context: ToolExecutionContext,
		agentView?: any // AgentView type to avoid circular dependency
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

		// Check for execution loops if enabled
		if (this.plugin.settings.loopDetectionEnabled) {
			// Update loop detector config in case settings changed
			this.loopDetector.updateConfig(
				this.plugin.settings.loopDetectionThreshold,
				this.plugin.settings.loopDetectionTimeWindowSeconds
			);

			const loopInfo = this.loopDetector.getLoopInfo(context.session.id, toolCall);
			if (loopInfo.isLoop) {
				this.plugin.logger.warn(`Loop detected for tool ${toolCall.name}:`, loopInfo);
				return {
					success: false,
					error: `Execution loop detected: ${toolCall.name} has been called ${loopInfo.identicalCallCount} times with the same parameters in the last ${loopInfo.timeWindowMs / 1000} seconds. Please try a different approach.`
				};
			}
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
			// Check if this tool is allowed without confirmation for this session
			const isAllowedWithoutConfirmation = agentView?.isToolAllowedWithoutConfirmation?.(toolCall.name) || false;
			
			if (!isAllowedWithoutConfirmation) {
				const result = await this.requestUserConfirmation(tool, toolCall.arguments);
				if (!result.confirmed) {
					return {
						success: false,
						error: 'User declined tool execution'
					};
				}
				// If user allowed this action without future confirmation
				if (result.allowWithoutConfirmation && agentView) {
					agentView.allowToolWithoutConfirmation(toolCall.name);
				}
			}
		}

		// Show execution notification (disabled - now shown in chat UI)
		// const executionNotice = new Notice(`Executing ${tool.name}...`, 0);
		const executionNotice = { hide: () => {} }; // Dummy object for compatibility

		try {
			// Record the execution attempt
			this.loopDetector.recordExecution(context.session.id, toolCall);
			
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
			
			// Tool execution results are now shown in the chat UI
			// No need for separate notices
			
			return result;

		} catch (error) {
			executionNotice.hide();
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			// Error is shown in chat UI, no need for notice
			
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
		context: ToolExecutionContext,
		agentView?: any // AgentView type to avoid circular dependency
	): Promise<ToolResult[]> {
		const results: ToolResult[] = [];
		
		for (const toolCall of toolCalls) {
			const result = await this.executeTool(toolCall, context, agentView);
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
	): Promise<{ confirmed: boolean; allowWithoutConfirmation?: boolean }> {
		return new Promise((resolve) => {
			const modal = new ToolConfirmationModal(
				this.plugin.app,
				tool,
				parameters,
				(confirmed, allowWithoutConfirmation) => {
					resolve({ confirmed, allowWithoutConfirmation: allowWithoutConfirmation || false });
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
		this.loopDetector.clearSession(sessionId);
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