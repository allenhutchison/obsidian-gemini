import type ObsidianGemini from '../../main';
import { ChatSession } from '../../types/agent';
import { GeminiConversationEntry } from '../../types/conversation';
import { ToolExecutionContext, ToolResult } from '../../tools/types';
import { CustomPrompt } from '../../prompts/types';
import { AgentFactory } from '../../agent/agent-factory';
import { generateToolDescription } from '../../utils/text-generation';
import { AgentViewToolDisplay } from './agent-view-tool-display';
import { buildFollowUpRequest, buildRetryRequest, buildEmptyResponseMessage } from './agent-view-tool-followup';

/**
 * Callbacks and state access that AgentViewTools needs from AgentView
 */
export interface AgentViewContext {
	getCurrentSession(): ChatSession | null;
	isCancellationRequested(): boolean;
	updateProgress(statusText: string, state?: 'thinking' | 'tool' | 'waiting' | 'streaming'): void;
	hideProgress(): void;
	displayMessage(entry: GeminiConversationEntry): Promise<void>;
	incrementToolCallCount?(count: number): void;
}

/**
 * Manages tool execution orchestration for the Agent View.
 * Delegates UI rendering to AgentViewToolDisplay and request building to followup helpers.
 */
export class AgentViewTools {
	private currentExecutingTool: string | null = null;
	private lastCompletedTool: string | null = null;
	private currentGroupContainer: HTMLElement | null = null;
	private display: AgentViewToolDisplay;

	constructor(
		chatContainer: HTMLElement,
		private plugin: ObsidianGemini,
		private context: AgentViewContext
	) {
		this.display = new AgentViewToolDisplay(chatContainer, plugin);
	}

	/**
	 * Sort tool calls to ensure safe execution order
	 * Prioritizes reads before writes/deletes to prevent race conditions
	 */
	private sortToolCallsByPriority(toolCalls: any[]): any[] {
		// Define priority order (lower number = higher priority)
		const toolPriority: Record<string, number> = {
			read_file: 1,
			list_files: 2,
			find_files_by_name: 3,
			google_search: 4,
			fetch_url: 5,
			write_file: 6,
			create_folder: 7,
			move_file: 8,
			delete_file: 9, // Destructive operations last
		};

		// Sort by priority, maintaining original order for same priority
		return [...toolCalls].sort((a, b) => {
			const priorityA = toolPriority[a.name] || 10;
			const priorityB = toolPriority[b.name] || 10;
			return priorityA - priorityB;
		});
	}

	/**
	 * Handle tool calls from the model response
	 */
	public async handleToolCalls(
		toolCalls: any[],
		userMessage: string,
		conversationHistory: any[],
		_userEntry: GeminiConversationEntry,
		customPrompt?: CustomPrompt
	) {
		const currentSession = this.context.getCurrentSession();
		if (!currentSession) return;

		// Execute each tool
		const toolResults: any[] = [];
		// Resolve project root for scoped tool discovery
		const activeProject = currentSession.projectPath
			? await this.plugin.projectManager?.getProject(currentSession.projectPath)
			: null;

		const toolContext: ToolExecutionContext = {
			plugin: this.plugin,
			session: currentSession,
			projectRootPath: activeProject?.rootPath,
			projectPermissions: activeProject?.config.permissions,
		};

		// Sort tool calls to prioritize reads before destructive operations
		const sortedToolCalls = this.sortToolCallsByPriority(toolCalls);

		// Reuse existing group container for recursive calls, or create a new one
		let groupContainer: HTMLElement;
		if (this.currentGroupContainer) {
			// Recursive call — add to the existing group
			groupContainer = this.currentGroupContainer;
			const prevTotal = parseInt(groupContainer.dataset.totalCount || '0', 10);
			groupContainer.dataset.totalCount = String(prevTotal + sortedToolCalls.length);
			this.display.updateGroupSummary(groupContainer);
		} else {
			// First call in this turn — create a new group
			groupContainer = this.display.createToolGroup(sortedToolCalls.length);
			this.currentGroupContainer = groupContainer;
		}

		for (const toolCall of sortedToolCalls) {
			// Check if cancellation was requested
			if (this.context.isCancellationRequested()) {
				this.plugin.logger.debug('[AgentViewTools] Cancellation detected, stopping tool execution');
				this.currentGroupContainer = null;
				break;
			}

			try {
				// Generate unique ID for this tool execution
				const toolExecutionId = `${toolCall.name}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

				// Update progress for this tool with human-friendly description
				const tool = this.plugin.toolRegistry.getTool(toolCall.name);
				const displayName = tool?.displayName || toolCall.name;

				// Use tool's own progress description if available, otherwise use fallback
				let toolDescription: string;
				if (tool?.getProgressDescription) {
					toolDescription = tool.getProgressDescription(toolCall.arguments);
				} else {
					toolDescription = generateToolDescription(this.plugin, toolCall.name, toolCall.arguments, displayName);
				}

				this.context.updateProgress(toolDescription, 'tool');

				// Show tool execution in UI
				await this.display.showToolExecution(
					toolCall.name,
					toolCall.arguments,
					toolExecutionId,
					this.currentGroupContainer
				);

				// Track current executing tool
				this.currentExecutingTool = toolCall.name;

				// Execute the tool
				// Note: Don't pass 'this' (AgentViewTools) - let execution engine get AgentView from plugin
				const toolStartTime = Date.now();
				const result = await this.plugin.toolExecutionEngine.executeTool(toolCall, toolContext);
				const toolDuration = Date.now() - toolStartTime;

				// Log failed tool results so root causes aren't silent. The execution
				// engine's early-return paths (invalid parameters, tool not enabled,
				// folder not found, etc.) return {success: false} without logging.
				if (!result.success) {
					this.plugin.logger.warn(
						`[AgentViewTools] Tool ${toolCall.name} failed:`,
						result.error,
						'args:',
						toolCall.arguments
					);
				}

				// Track as last completed tool
				this.lastCompletedTool = toolCall.name;
				this.currentExecutingTool = null;

				// Show result in UI
				await this.display.showToolResult(toolCall.name, result, toolExecutionId);

				// Emit toolExecutionComplete hook
				await this.plugin.agentEventBus?.emit('toolExecutionComplete', {
					toolName: toolCall.name,
					args: toolCall.arguments || {},
					result,
					durationMs: toolDuration,
				});
				this.context.incrementToolCallCount?.(1);

				// Format result for the model - store original tool call with result
				toolResults.push({
					toolName: toolCall.name,
					toolArguments: toolCall.arguments,
					result: result,
				});
			} catch (error) {
				this.plugin.logger.error(`Tool execution error for ${toolCall.name}:`, error);
				this.context.incrementToolCallCount?.(1);
				toolResults.push({
					toolName: toolCall.name,
					toolArguments: toolCall.arguments || {},
					result: {
						success: false,
						error: error instanceof Error ? error.message : 'Unknown error',
					},
				});
			}
		}

		// Accessed files tracking is handled by the toolChainComplete event bus subscriber

		// Emit toolChainComplete hook
		if (currentSession) {
			await this.plugin.agentEventBus?.emit('toolChainComplete', {
				session: currentSession,
				toolResults: toolResults.map((tr) => ({
					toolName: tr.toolName,
					toolArguments: tr.toolArguments,
					result: tr.result,
				})),
				toolCount: toolResults.length,
			});
		}

		// Note: User message is saved to history early in sendMessage(), before the API call
		// Don't save it again here to avoid duplicates

		// Build updated conversation history with proper Gemini API format:
		// 1. Previous conversation history
		// 2. User message (only if non-empty)
		// 3. Model response with tool calls (as functionCall parts)
		// 4. Tool results (as functionResponse parts)

		// Debug logging for thought signature handling
		this.plugin.logger.debug(
			`[AgentViewTools] Building tool call parts: ${toolCalls.length} calls, ` +
				`${toolCalls.filter((tc) => tc.thoughtSignature).length} with signatures`
		);

		const updatedHistory = [
			...conversationHistory,
			// Model's tool calls
			{
				role: 'model',
				parts: toolCalls.map((tc) => ({
					functionCall: {
						name: tc.name,
						args: tc.arguments || {},
						...(tc.id && { id: tc.id }),
					},
					...(tc.thoughtSignature && { thoughtSignature: tc.thoughtSignature }),
				})),
			},
			// Tool results as functionResponse, with inlineData parts injected alongside
			{
				role: 'user',
				parts: toolResults.flatMap((tr) => {
					// Strip inlineData from the result before putting in functionResponse
					const { inlineData, ...resultWithoutInlineData } = tr.result;
					const parts: any[] = [
						{
							functionResponse: {
								name: tr.toolName,
								response: resultWithoutInlineData,
							},
						},
					];
					// Append inlineData as separate parts the model can see
					if (inlineData && Array.isArray(inlineData)) {
						for (const attachment of inlineData) {
							parts.push({
								inlineData: { mimeType: attachment.mimeType, data: attachment.base64 },
							});
						}
					}
					return parts;
				}),
			},
		];

		// Only add user message if it's non-empty
		// On recursive calls, userMessage will be empty since the message is already in conversationHistory
		if (userMessage && userMessage.trim()) {
			// Insert user message before the model's tool calls
			updatedHistory.splice(conversationHistory.length, 0, {
				role: 'user',
				parts: [{ text: userMessage }],
			});
		}

		// Check if cancellation was requested before sending follow-up request
		if (this.context.isCancellationRequested()) {
			this.plugin.logger.debug('[AgentViewTools] Cancellation detected, skipping follow-up request');
			return;
		}

		// Send another request with the tool results
		try {
			const followUpRequest = buildFollowUpRequest({
				plugin: this.plugin,
				currentSession,
				updatedHistory,
				customPrompt,
				projectRootPath: activeProject?.rootPath,
				projectPermissions: activeProject?.config.permissions,
			});

			// Update progress to show we're processing tool results
			this.context.updateProgress('Processing results...', 'waiting');

			// Use the same model API for follow-up requests
			const modelApi = AgentFactory.createAgentModel(this.plugin, currentSession);

			// Update progress to show we're thinking about the response
			this.context.updateProgress('Thinking...', 'thinking');

			const followUpResponse = await modelApi.generateModelResponse(followUpRequest);

			// Emit usage metadata via event bus (contextManager subscribes)
			if (followUpResponse.usageMetadata) {
				await this.plugin.agentEventBus?.emit('apiResponseReceived', {
					usageMetadata: followUpResponse.usageMetadata,
				});
			}

			// Check if the follow-up response also contains tool calls
			if (followUpResponse.toolCalls && followUpResponse.toolCalls.length > 0) {
				// Check if cancellation was requested before recursive call
				if (this.context.isCancellationRequested()) {
					this.plugin.logger.debug('[AgentViewTools] Cancellation detected, skipping recursive tool call');
					this.currentGroupContainer = null;
					return;
				}

				// Recursively handle additional tool calls
				// Don't pass a user message since the tool results are already in history
				await this.handleToolCalls(
					followUpResponse.toolCalls,
					'', // Empty message - tool results already in history
					updatedHistory,
					{
						role: 'system',
						message: 'Continuing with additional tool calls...',
						notePath: '',
						created_at: new Date(),
					},
					customPrompt // Pass custom prompt through recursive calls
				);
			} else {
				// Tool chain complete — clear group so next turn starts fresh
				this.currentGroupContainer = null;

				// Display the final response only if it has content
				if (followUpResponse.markdown && followUpResponse.markdown.trim()) {
					const aiEntry: GeminiConversationEntry = {
						role: 'model',
						message: followUpResponse.markdown,
						notePath: '',
						created_at: new Date(),
					};
					await this.context.displayMessage(aiEntry);

					// Save final response to history
					await this.plugin.sessionHistory.addEntryToSession(currentSession, aiEntry);

					// Hide progress bar after successful response
					this.context.hideProgress();
				} else {
					// Model returned empty response - this might happen with thinking tokens
					this.plugin.logger.warn('Model returned empty response after tool execution');

					// Check if cancellation was requested before retry
					if (this.context.isCancellationRequested()) {
						this.plugin.logger.debug('[AgentViewTools] Cancellation detected, skipping retry request');
						return;
					}

					// Try a simpler prompt to get a response
					const retryRequest = buildRetryRequest({
						plugin: this.plugin,
						currentSession,
						updatedHistory,
					});

					// Use the same model API for retry requests
					const modelApi2 = AgentFactory.createAgentModel(this.plugin, currentSession);
					const retryResponse = await modelApi2.generateModelResponse(retryRequest);

					// Emit usage metadata via event bus (contextManager subscribes)
					if (retryResponse.usageMetadata) {
						await this.plugin.agentEventBus?.emit('apiResponseReceived', {
							usageMetadata: retryResponse.usageMetadata,
						});
					}

					if (retryResponse.markdown && retryResponse.markdown.trim()) {
						const aiEntry: GeminiConversationEntry = {
							role: 'model',
							message: retryResponse.markdown,
							notePath: '',
							created_at: new Date(),
						};
						await this.context.displayMessage(aiEntry);

						// Save final response to history
						await this.plugin.sessionHistory.addEntryToSession(currentSession, aiEntry);

						// Hide progress bar after successful retry response
						this.context.hideProgress();
					} else {
						// Always hide progress even if retry returns empty
						this.plugin.logger.warn('Model returned empty response after retry');
						this.context.hideProgress();

						// Show error message to user with executed tool names
						const emptyResponseMessage = buildEmptyResponseMessage(toolResults, this.plugin);

						const errorEntry: GeminiConversationEntry = {
							role: 'model',
							message: emptyResponseMessage,
							notePath: '',
							created_at: new Date(),
						};
						await this.context.displayMessage(errorEntry);
					}
				}
			}
		} catch (error) {
			this.plugin.logger.error('Failed to process tool results:', error);
			// Clear group container on error
			this.currentGroupContainer = null;
			// Hide progress bar on error
			this.context.hideProgress();
		}
	}

	/**
	 * Show tool execution in the UI as a compact row inside a group container.
	 * If no group container is active, creates a standalone fallback.
	 */
	public async showToolExecution(toolName: string, parameters: any, executionId?: string): Promise<void> {
		return this.display.showToolExecution(toolName, parameters, executionId, this.currentGroupContainer);
	}

	/**
	 * Show tool execution result in the UI, updating the tool row and group summary.
	 */
	public async showToolResult(toolName: string, result: ToolResult, executionId?: string): Promise<void> {
		return this.display.showToolResult(toolName, result, executionId);
	}

	/**
	 * Get current executing tool
	 */
	public getCurrentExecutingTool(): string | null {
		return this.currentExecutingTool;
	}

	/**
	 * Get last completed tool
	 */
	public getLastCompletedTool(): string | null {
		return this.lastCompletedTool;
	}
}
