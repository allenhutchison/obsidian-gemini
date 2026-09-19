import {
	Tool,
	ToolResult,
	ToolExecutionContext,
	ToolCall,
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
	private loopDetector: ToolLoopDetector;

	constructor(plugin: ObsidianGemini, registry: ToolRegistry) {
		this.plugin = plugin;
		this.registry = registry;
		this.loopDetector = new ToolLoopDetector();
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

		// Check for execution loops. Always on, with the detector's own fixed
		// defaults (settings redesign — was previously gated by an enable toggle
		// with a configurable threshold/window).
		const loopInfo = this.loopDetector.getLoopInfo(context.session.id, toolCall);
		if (loopInfo.isLoop) {
			this.plugin.logger.warn(`Loop detected for tool ${toolCall.name}:`, loopInfo);

			// Surface the fire on the event bus so UI (and headless) subscribers can react.
			// Emit is fire-and-forget; a throwing subscriber must not block the block.
			try {
				void this.plugin.agentEventBus?.emit('toolLoopDetected', {
					sessionId: context.session.id,
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
	 * Release per-session state for a finished or deleted session.
	 *
	 * Clears the tool loop detector's recorded calls for the session so its key
	 * does not live on for the rest of the plugin process (#1387). Called from
	 * `SessionManager.releaseSession` after headless turns and session deletion.
	 */
	clearLoopDetectorSession(sessionId: string): void {
		this.loopDetector.clearSession(sessionId);
	}
}
