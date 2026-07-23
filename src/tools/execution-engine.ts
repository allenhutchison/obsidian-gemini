import {
	Tool,
	ToolResult,
	ToolExecutionContext,
	ToolCall,
	ToolExecution,
	ToolParams,
	IConfirmationProvider,
	ConfirmationResult,
} from './types';
import { getRawErrorMessageOr } from '../utils/error-utils';
import { ToolRegistry } from './tool-registry';
import { ToolLoopDetector } from './loop-detector';
import type { ObsidianGemini } from '../types/plugin';

/**
 * Handles execution of tools with permission checks and UI feedback
 */
export class ToolExecutionEngine {
	private plugin: ObsidianGemini;
	private registry: ToolRegistry;
	private executionHistory: Map<string, ToolExecution[]> = new Map();
	private loopDetector: ToolLoopDetector;

	constructor(plugin: ObsidianGemini, registry: ToolRegistry) {
		this.plugin = plugin;
		this.registry = registry;
		this.loopDetector = new ToolLoopDetector(
			plugin.settings.loopDetectionThreshold,
			plugin.settings.loopDetectionTimeWindowSeconds
		);
	}

	/**
	 * Execute a tool call with appropriate checks and UI feedback.
	 *
	 * `confirmationProvider` is required — the engine never reaches out to the
	 * plugin to find a UI. Callers decide who approves: UI callers pass the
	 * agent view; headless callers pass an auto-approve (or deny) provider.
	 */
	async executeTool(
		toolCall: ToolCall,
		context: ToolExecutionContext,
		confirmationProvider: IConfirmationProvider
	): Promise<ToolResult> {
		const tool = this.registry.getTool(toolCall.name);

		if (!tool) {
			return {
				success: false,
				error: `Tool ${toolCall.name} not found`,
			};
		}

		// Validate parameters
		const validation = this.registry.validateParameters(toolCall.name, toolCall.arguments);
		if (!validation.valid) {
			return {
				success: false,
				error: `Invalid parameters: ${validation.errors?.join(', ')}`,
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

				// Surface the fire on the event bus so UI (and headless) subscribers can react.
				// Emit is fire-and-forget; a throwing subscriber must not block the block.
				try {
					void this.plugin.agentEventBus?.emit('toolLoopDetected', {
						toolName: toolCall.name,
						args: toolCall.arguments || {},
						identicalCallCount: loopInfo.identicalCallCount,
						timeWindowMs: loopInfo.timeWindowMs,
					});
				} catch (error) {
					this.plugin.logger.error('Failed to emit toolLoopDetected event:', error);
				}

				return {
					success: false,
					loopDetected: true,
					error: `Execution loop detected: ${toolCall.name} has been called ${loopInfo.identicalCallCount} times with the same parameters in the last ${loopInfo.timeWindowMs / 1000} seconds. Please try a different approach.`,
				};
			}
		}

		// Check if tool is enabled for current session
		const enabledTools = this.registry.getEnabledTools(context);
		if (!enabledTools.includes(tool)) {
			return {
				success: false,
				error: `Tool ${tool.name} is not enabled for this session`,
			};
		}

		// Check if confirmation is required (feature policy overlay → global policy)
		const requiresConfirmation = this.registry.requiresConfirmation(toolCall.name, context.featureToolPolicy);

		if (requiresConfirmation) {
			// Check if this tool is allowed without confirmation for this session
			// (session-level override via the in-chat "Allow" button)
			const isAllowedWithoutConfirmation = confirmationProvider.isToolAllowedWithoutConfirmation(toolCall.name);

			if (!isAllowedWithoutConfirmation) {
				// Update progress to show waiting for confirmation
				const toolDisplay = tool.displayName || tool.name;
				const confirmationMessage = `Waiting for confirmation: ${toolDisplay}`;
				confirmationProvider.updateProgress?.(confirmationMessage, 'waiting');

				const result = await this.requestUserConfirmation(tool, toolCall.arguments, confirmationProvider, context);

				// Update progress back to tool execution
				confirmationProvider.updateProgress?.(`Executing: ${toolDisplay}`, 'tool');

				if (!result.confirmed) {
					return {
						success: false,
						error: 'User declined tool execution',
					};
				}

				// If the user edited the content in the diff view, let the tool fold the
				// edited content back into its own arguments — each content-editing tool
				// owns its own write contract (write_file / create_skill / edit_skill
				// replace the editable body; append_content flips to a full overwrite).
				// Tools without an editable diff implement neither hook, so this is a
				// no-op for them.
				if (result.finalContent !== undefined) {
					tool.applyConfirmedEdit?.(toolCall.arguments, result);
				}

				// If user allowed this action without future confirmation
				if (result.allowWithoutConfirmation) {
					confirmationProvider.allowToolWithoutConfirmation(toolCall.name);
				}
			}
		}

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
				confirmed: requiresConfirmation,
			};

			this.addToHistory(context.session.id, execution);

			return result;
		} catch (error) {
			const errorMessage = getRawErrorMessageOr(error, 'Unknown error');
			return {
				success: false,
				error: errorMessage,
			};
		}
	}

	/**
	 * Execute multiple tool calls in sequence
	 */
	async executeToolCalls(
		toolCalls: ToolCall[],
		context: ToolExecutionContext,
		confirmationProvider: IConfirmationProvider
	): Promise<ToolResult[]> {
		const results: ToolResult[] = [];

		for (const toolCall of toolCalls) {
			const result = await this.executeTool(toolCall, context, confirmationProvider);
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
		parameters: ToolParams,
		confirmationProvider: IConfirmationProvider,
		context: ToolExecutionContext
	): Promise<ConfirmationResult> {
		// Generate unique execution ID for tracking
		const executionId = `tool-confirm-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

		// A content-editing tool builds its own diff-preview context; tools without
		// an editable diff omit the hook and get a plain (non-diff) confirmation.
		const diffContext = await tool.buildDiffContext?.(parameters, context);

		// Show confirmation in chat instead of modal
		return confirmationProvider.showConfirmationInChat(tool, parameters, executionId, diffContext);
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
