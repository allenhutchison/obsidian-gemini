import { setIcon, TFile } from 'obsidian';
import type ObsidianGemini from '../../main';
import { ChatSession } from '../../types/agent';
import { GeminiConversationEntry } from '../../types/conversation';
import { ToolExecutionContext, ToolResult } from '../../tools/types';
import { ExtendedModelRequest } from '../../api/interfaces/model-api';
import { CustomPrompt } from '../../prompts/types';
import { AgentFactory } from '../../agent/agent-factory';
import { generateToolDescription } from '../../utils/text-generation';
import { formatFileSize } from '../../utils/format-utils';

// Tool execution result messages
const TOOL_EXECUTION_FAILED_DEFAULT_MSG = 'Tool execution failed (no error message provided)';
const OPERATION_COMPLETED_SUCCESSFULLY_MSG = 'Operation completed successfully';

// Shared tool icon mapping
const TOOL_ICONS: Record<string, string> = {
	read_file: 'file-text',
	write_file: 'file-edit',
	list_files: 'folder-open',
	create_folder: 'folder-plus',
	delete_file: 'trash-2',
	move_file: 'file-symlink',
	find_files_by_name: 'search',
	google_search: 'globe',
	fetch_url: 'link',
	generate_image: 'image',
};

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
 * Manages tool execution display and handling for the Agent View
 */
export class AgentViewTools {
	private currentExecutingTool: string | null = null;
	private lastCompletedTool: string | null = null;
	private currentGroupContainer: HTMLElement | null = null;

	constructor(
		private chatContainer: HTMLElement,
		private plugin: ObsidianGemini,
		private context: AgentViewContext
	) {}

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
	 * Get a brief parameter summary for a tool row (e.g. file path or query)
	 */
	private getToolParamSummary(_toolName: string, parameters: any): string {
		if (!parameters) return '';
		// Pick the most meaningful parameter for each tool type
		if (parameters.path) return parameters.path;
		if (parameters.query) return parameters.query;
		if (parameters.url) return parameters.url;
		if (parameters.name) return parameters.name;
		// Fallback: show first key's value
		const keys = Object.keys(parameters);
		if (keys.length > 0) {
			const val = parameters[keys[0]];
			const str = typeof val === 'string' ? val : JSON.stringify(val);
			return str.length > 40 ? str.substring(0, 40) + '…' : str;
		}
		return '';
	}

	/**
	 * Create a grouped tool activity container for a batch of tool calls.
	 * Returns the group container element.
	 */
	private createToolGroup(totalToolCount: number): HTMLElement {
		// Remove empty state if it exists
		const emptyState = this.chatContainer.querySelector('.gemini-agent-empty-chat');
		if (emptyState) {
			emptyState.remove();
		}

		const group = this.chatContainer.createDiv({ cls: 'gemini-tool-group' });

		// Summary bar (always visible)
		const summary = group.createDiv({ cls: 'gemini-tool-group-summary' });
		summary.setAttribute('role', 'button');
		summary.setAttribute('tabindex', '0');
		summary.setAttribute('aria-expanded', 'false');

		const summaryIcon = summary.createSpan({ cls: 'gemini-tool-group-icon' });
		setIcon(summaryIcon, 'wrench');

		summary.createSpan({
			text: `Running tools... (0 of ${totalToolCount})`,
			cls: 'gemini-tool-group-text',
		});

		summary.createSpan({
			text: 'Running',
			cls: 'gemini-tool-group-status gemini-tool-group-status-running',
		});

		const chevron = summary.createSpan({ cls: 'gemini-tool-group-chevron' });
		setIcon(chevron, 'chevron-right');

		// Body (hidden by default)
		const body = group.createDiv({ cls: 'gemini-tool-group-body' });
		body.style.display = 'none';

		// Store counts in dataset
		group.dataset.totalCount = String(totalToolCount);
		group.dataset.completedCount = '0';
		group.dataset.failedCount = '0';

		// Toggle expand/collapse — derive state from DOM to stay in sync with programmatic expansion
		const toggleGroup = () => {
			const wasExpanded = summary.getAttribute('aria-expanded') === 'true';
			const nowExpanded = !wasExpanded;
			body.style.display = nowExpanded ? 'block' : 'none';
			setIcon(chevron, nowExpanded ? 'chevron-down' : 'chevron-right');
			group.toggleClass('gemini-tool-group-expanded', nowExpanded);
			summary.setAttribute('aria-expanded', String(nowExpanded));
		};
		summary.addEventListener('click', toggleGroup);
		summary.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				toggleGroup();
			}
		});

		return group;
	}

	/**
	 * Update the group summary bar with current counts and status.
	 */
	private updateGroupSummary(group: HTMLElement): void {
		const total = parseInt(group.dataset.totalCount || '0', 10);
		const completed = parseInt(group.dataset.completedCount || '0', 10);
		const failed = parseInt(group.dataset.failedCount || '0', 10);
		const allDone = completed + failed >= total;

		// Update text
		const textEl = group.querySelector('.gemini-tool-group-text') as HTMLElement;
		if (textEl) {
			if (allDone) {
				const toolWord = total === 1 ? 'tool' : 'tools';
				if (failed > 0) {
					textEl.textContent = `${total} ${toolWord} completed — ${failed} failed`;
				} else {
					textEl.textContent = `${total} ${toolWord} completed`;
				}
			} else {
				textEl.textContent = `Running tools... (${completed + failed} of ${total})`;
			}
		}

		// Update status badge
		const statusEl = group.querySelector('.gemini-tool-group-status') as HTMLElement;
		if (statusEl) {
			statusEl.classList.remove(
				'gemini-tool-group-status-running',
				'gemini-tool-group-status-success',
				'gemini-tool-group-status-error'
			);
			if (allDone) {
				if (failed > 0) {
					statusEl.textContent = '⚠️';
					statusEl.classList.add('gemini-tool-group-status-error');
				} else {
					statusEl.textContent = '✅';
					statusEl.classList.add('gemini-tool-group-status-success');
				}
			} else {
				statusEl.textContent = 'Running';
				statusEl.classList.add('gemini-tool-group-status-running');
			}
		}

		// Auto-expand immediately if there's a failure (don't wait for all tools)
		if (failed > 0) {
			const body = group.querySelector('.gemini-tool-group-body') as HTMLElement;
			const chevron = group.querySelector('.gemini-tool-group-chevron') as HTMLElement;
			const summary = group.querySelector('.gemini-tool-group-summary') as HTMLElement;
			if (body && body.style.display === 'none') {
				body.style.display = 'block';
				if (chevron) setIcon(chevron, 'chevron-down');
				if (summary) summary.setAttribute('aria-expanded', 'true');
				group.classList.add('gemini-tool-group-expanded');
			}
		}
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
			this.updateGroupSummary(groupContainer);
		} else {
			// First call in this turn — create a new group
			groupContainer = this.createToolGroup(sortedToolCalls.length);
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
				await this.showToolExecution(toolCall.name, toolCall.arguments, toolExecutionId);

				// Track current executing tool
				this.currentExecutingTool = toolCall.name;

				// Execute the tool
				// Note: Don't pass 'this' (AgentViewTools) - let execution engine get AgentView from plugin
				const toolStartTime = Date.now();
				const result = await this.plugin.toolExecutionEngine.executeTool(toolCall, toolContext);
				const toolDuration = Date.now() - toolStartTime;

				// Track as last completed tool
				this.lastCompletedTool = toolCall.name;
				this.currentExecutingTool = null;

				// Show result in UI
				await this.showToolResult(toolCall.name, result, toolExecutionId);

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
			// Get available tools again for the follow-up request
			const availableToolsContext: ToolExecutionContext = {
				plugin: this.plugin,
				session: currentSession,
				projectRootPath: activeProject?.rootPath,
				projectPermissions: activeProject?.config.permissions,
			};
			const availableTools = this.plugin.toolRegistry.getEnabledTools(availableToolsContext);

			// Get model config from session or use defaults
			const modelConfig = currentSession?.modelConfig || {};

			const followUpRequest: ExtendedModelRequest = {
				userMessage: '', // Empty since tool results are already in conversation history
				conversationHistory: updatedHistory,
				model: modelConfig.model || this.plugin.settings.chatModelName,
				temperature: modelConfig.temperature ?? this.plugin.settings.temperature,
				topP: modelConfig.topP ?? this.plugin.settings.topP,
				prompt: '', // Unused in agent pipeline
				customPrompt: customPrompt, // Pass custom prompt through to follow-up requests
				renderContent: false,
				availableTools: availableTools, // Include tools so model can chain calls
			};

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
					const retryRequest: ExtendedModelRequest = {
						userMessage: 'Please summarize what you just did with the tools.',
						conversationHistory: updatedHistory,
						model: modelConfig.model || this.plugin.settings.chatModelName,
						temperature: modelConfig.temperature ?? this.plugin.settings.temperature,
						topP: modelConfig.topP ?? this.plugin.settings.topP,
						prompt: '', // Unused in agent pipeline
						renderContent: false,
					};

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
						const executedToolNames = toolResults
							.filter((r) => r.result?.success !== false)
							.map((r) => {
								const tool = this.plugin.toolRegistry.getTool(r.toolName);
								return tool?.displayName || r.toolName;
							})
							.join(', ');

						const emptyResponseMessage = executedToolNames
							? `I completed the requested actions (${executedToolNames}) but had trouble generating a summary. The operations were successful.`
							: 'I completed the requested actions but had trouble generating a summary. The operations were successful.';

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
		// Determine where to add the tool row
		const group = this.currentGroupContainer;
		let targetContainer: HTMLElement;

		if (group) {
			// Add row inside the group body
			const body = group.querySelector('.gemini-tool-group-body') as HTMLElement;
			targetContainer = body || group;
		} else {
			// Fallback: standalone message (backward compatibility for external callers)
			const emptyState = this.chatContainer.querySelector('.gemini-agent-empty-chat');
			if (emptyState) emptyState.remove();
			targetContainer = this.chatContainer;
		}

		// Create compact tool row
		const toolRow = targetContainer.createDiv({ cls: 'gemini-tool-row' });

		// Row header (always visible)
		const rowHeader = toolRow.createDiv({ cls: 'gemini-tool-row-header' });
		rowHeader.setAttribute('role', 'button');
		rowHeader.setAttribute('tabindex', '0');
		rowHeader.setAttribute('aria-expanded', 'false');

		const icon = rowHeader.createSpan({ cls: 'gemini-tool-row-icon' });
		setIcon(icon, TOOL_ICONS[toolName] || 'wrench');

		// Get display name
		const tool = this.plugin.toolRegistry.getTool(toolName);
		const displayName = tool?.displayName || toolName;

		rowHeader.createSpan({
			text: displayName,
			cls: 'gemini-tool-row-name',
		});

		// Brief parameter summary (e.g. file path)
		const paramSummary = this.getToolParamSummary(toolName, parameters);
		if (paramSummary) {
			rowHeader.createSpan({
				text: paramSummary,
				cls: 'gemini-tool-row-param',
			});
		}

		rowHeader.createSpan({
			text: 'Running...',
			cls: 'gemini-tool-row-status gemini-tool-row-status-running',
		});

		const rowChevron = rowHeader.createSpan({ cls: 'gemini-tool-row-chevron' });
		setIcon(rowChevron, 'chevron-right');

		// Row details (hidden by default, contains parameters and later results)
		const rowDetails = toolRow.createDiv({ cls: 'gemini-tool-row-details' });
		rowDetails.style.display = 'none';

		// Parameters section inside details
		if (parameters && Object.keys(parameters).length > 0) {
			const paramsSection = rowDetails.createDiv({ cls: 'gemini-agent-tool-section' });
			paramsSection.createEl('h4', { text: 'Parameters' });

			const paramsList = paramsSection.createDiv({ cls: 'gemini-agent-tool-params-list' });
			for (const [key, value] of Object.entries(parameters)) {
				const paramItem = paramsList.createDiv({ cls: 'gemini-agent-tool-param-item' });
				paramItem.createSpan({
					text: key,
					cls: 'gemini-agent-tool-param-key',
				});

				const valueStr = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
				const valueEl = paramItem.createEl('code', {
					text: valueStr,
					cls: 'gemini-agent-tool-param-value',
				});

				if (valueStr.length > 100) {
					valueEl.textContent = valueStr.substring(0, 100) + '...';
					valueEl.title = valueStr;
				}
			}
		}

		// Toggle row details — derive state from DOM to stay in sync with programmatic expansion
		const toggleRowDetails = () => {
			const wasExpanded = rowHeader.getAttribute('aria-expanded') === 'true';
			const nowExpanded = !wasExpanded;
			rowDetails.style.display = nowExpanded ? 'block' : 'none';
			setIcon(rowChevron, nowExpanded ? 'chevron-down' : 'chevron-right');
			toolRow.toggleClass('gemini-tool-row-expanded', nowExpanded);
			rowHeader.setAttribute('aria-expanded', String(nowExpanded));
		};
		rowHeader.addEventListener('click', toggleRowDetails);
		rowHeader.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				toggleRowDetails();
			}
		});

		// Store references for result updates
		toolRow.dataset.toolName = toolName;
		if (executionId) {
			toolRow.dataset.executionId = executionId;
		}

		// Auto-scroll
		this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
	}

	/**
	 * Show tool execution result in the UI, updating the tool row and group summary.
	 */
	public async showToolResult(toolName: string, result: ToolResult, executionId?: string): Promise<void> {
		// Find the existing tool row (in group body or standalone)
		const toolRows = this.chatContainer.querySelectorAll('.gemini-tool-row');
		let toolRow: HTMLElement | null = null;

		if (executionId) {
			for (const row of Array.from(toolRows)) {
				if ((row as HTMLElement).dataset.executionId === executionId) {
					toolRow = row as HTMLElement;
					break;
				}
			}
		} else {
			for (const row of Array.from(toolRows)) {
				if ((row as HTMLElement).dataset.toolName === toolName) {
					toolRow = row as HTMLElement;
					break;
				}
			}
		}

		if (!toolRow) {
			this.plugin.logger.warn(`Tool row not found for ${toolName}`);
			return;
		}

		// Update row status badge
		const statusEl = toolRow.querySelector('.gemini-tool-row-status') as HTMLElement;
		if (statusEl) {
			statusEl.textContent = result.success ? 'Completed' : 'Failed';
			statusEl.classList.remove('gemini-tool-row-status-running');
			statusEl.classList.add(result.success ? 'gemini-tool-row-status-success' : 'gemini-tool-row-status-error');
		}

		// Update row icon on completion
		const iconEl = toolRow.querySelector('.gemini-tool-row-icon') as HTMLElement;
		if (iconEl) {
			setIcon(iconEl, result.success ? 'check-circle' : 'x-circle');
		}

		// Add result to row details
		const details = toolRow.querySelector('.gemini-tool-row-details');
		if (details) {
			const resultSection = details.createDiv({ cls: 'gemini-agent-tool-section' });
			resultSection.createEl('h4', { text: 'Result' });

			if (result.success === false || result.success === undefined) {
				const errorContent = resultSection.createDiv({ cls: 'gemini-agent-tool-error-content' });
				const errorMessage = result.error || TOOL_EXECUTION_FAILED_DEFAULT_MSG;
				errorContent.createEl('p', {
					text: errorMessage,
					cls: 'gemini-agent-tool-error-message',
				});
			} else if (result.data) {
				const resultContent = resultSection.createDiv({ cls: 'gemini-agent-tool-result-content' });

				if (typeof result.data === 'string') {
					if (result.data.length > 500) {
						const codeBlock = resultContent.createEl('pre', { cls: 'gemini-agent-tool-code-result' });
						const code = codeBlock.createEl('code');
						code.textContent = result.data.substring(0, 500) + '\n\n... (truncated)';

						const expandBtn = resultContent.createEl('button', {
							text: 'Show full content',
							cls: 'gemini-agent-tool-expand-content',
						});
						expandBtn.addEventListener('click', () => {
							code.textContent = result.data;
							expandBtn.remove();
						});
					} else {
						resultContent
							.createEl('pre', { cls: 'gemini-agent-tool-code-result' })
							.createEl('code', { text: result.data });
					}
				} else if (Array.isArray(result.data)) {
					if (result.data.length === 0) {
						resultContent.createEl('p', {
							text: 'No results found',
							cls: 'gemini-agent-tool-empty-result',
						});
					} else {
						const list = resultContent.createEl('ul', { cls: 'gemini-agent-tool-result-list' });
						result.data.slice(0, 10).forEach((item: any) => {
							list.createEl('li', { text: String(item) });
						});
						if (result.data.length > 10) {
							resultContent.createEl('p', {
								text: `... and ${result.data.length - 10} more`,
								cls: 'gemini-agent-tool-more-items',
							});
						}
					}
				} else if (typeof result.data === 'object') {
					this.plugin.logger.log('Tool result is object for:', toolName);
					this.plugin.logger.log('Result data keys:', Object.keys(result.data));

					if (result.data.answer && result.data.citations && toolName === 'google_search') {
						this.plugin.logger.log('Handling google_search result with citations');
						const answerDiv = resultContent.createDiv({ cls: 'gemini-agent-tool-search-answer' });
						answerDiv.createEl('h5', { text: 'Answer:' });

						const answerPara = answerDiv.createEl('p');
						const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
						let lastIndex = 0;
						let match;

						while ((match = linkRegex.exec(result.data.answer)) !== null) {
							if (match.index > lastIndex) {
								answerPara.appendText(result.data.answer.substring(lastIndex, match.index));
							}
							const link = answerPara.createEl('a', {
								text: match[1],
								href: match[2],
							});
							link.setAttribute('target', '_blank');
							lastIndex = linkRegex.lastIndex;
						}
						if (lastIndex < result.data.answer.length) {
							answerPara.appendText(result.data.answer.substring(lastIndex));
						}

						if (result.data.citations.length > 0) {
							const citationsDiv = resultContent.createDiv({ cls: 'gemini-agent-tool-citations' });
							citationsDiv.createEl('h5', { text: 'Sources:' });
							const citationsList = citationsDiv.createEl('ul', {
								cls: 'gemini-agent-tool-citations-list',
							});
							for (const citation of result.data.citations) {
								const citationItem = citationsList.createEl('li');
								const link = citationItem.createEl('a', {
									text: citation.title || citation.url,
									href: citation.url,
									cls: 'gemini-agent-tool-citation-link',
								});
								link.setAttribute('target', '_blank');
								if (citation.snippet) {
									citationItem.createEl('p', {
										text: citation.snippet,
										cls: 'gemini-agent-tool-citation-snippet',
									});
								}
							}
						}
					} else if (result.data.path && result.data.wikilink && toolName === 'generate_image') {
						const imageDiv = resultContent.createDiv({ cls: 'gemini-agent-tool-image-result' });
						imageDiv.createEl('h5', { text: 'Generated Image:' });

						const imageFile = this.plugin.app.vault.getAbstractFileByPath(result.data.path);
						if (imageFile instanceof TFile) {
							const imgContainer = imageDiv.createDiv({ cls: 'gemini-agent-tool-image-container' });
							const img = imgContainer.createEl('img', { cls: 'gemini-agent-tool-image' });

							img.onloadstart = () => imgContainer.addClass('loading');
							img.onload = () => imgContainer.removeClass('loading');
							img.onerror = () => {
								img.style.display = 'none';
								imgContainer.removeClass('loading');
								imgContainer.createEl('p', {
									text: 'Failed to load image preview',
									cls: 'gemini-agent-tool-image-error',
								});
							};

							try {
								img.src = this.plugin.app.vault.getResourcePath(imageFile);
								img.alt = result.data.prompt || 'Generated image';
							} catch (error) {
								this.plugin.logger.error('Failed to get resource path for image:', error);
								img.onerror?.(new Event('error'));
							}

							const imageInfo = imageDiv.createDiv({ cls: 'gemini-agent-tool-image-info' });
							imageInfo.createEl('strong', { text: 'Path: ' });
							imageInfo.createSpan({ text: result.data.path });
							imageInfo.createEl('br');
							imageInfo.createEl('strong', { text: 'Wikilink: ' });
							imageInfo.createEl('code', {
								text: result.data.wikilink,
								cls: 'gemini-agent-tool-wikilink',
							});
							const copyBtn = imageInfo.createEl('button', {
								text: 'Copy',
								cls: 'gemini-agent-tool-copy-wikilink',
							});
							copyBtn.addEventListener('click', () => {
								navigator.clipboard.writeText(result.data.wikilink).then(() => {
									copyBtn.textContent = 'Copied!';
									setTimeout(() => {
										copyBtn.textContent = 'Copy';
									}, 2000);
								});
							});
						} else {
							imageDiv.createEl('p', {
								text: `Image saved to: ${result.data.path}`,
								cls: 'gemini-agent-tool-image-path',
							});
						}
					} else if (result.data.content && result.data.path) {
						const fileInfo = resultContent.createDiv({ cls: 'gemini-agent-tool-file-info' });
						fileInfo.createEl('strong', { text: 'File: ' });
						fileInfo.createSpan({ text: result.data.path });

						if (result.data.size) {
							fileInfo.createSpan({
								text: ` (${formatFileSize(result.data.size)})`,
								cls: 'gemini-agent-tool-file-size',
							});
						}

						const content = result.data.content;
						if (content.length > 500) {
							const codeBlock = resultContent.createEl('pre', {
								cls: 'gemini-agent-tool-code-result',
							});
							const code = codeBlock.createEl('code');
							code.textContent = content.substring(0, 500) + '\n\n... (truncated)';
							const expandBtn = resultContent.createEl('button', {
								text: 'Show full content',
								cls: 'gemini-agent-tool-expand-content',
							});
							expandBtn.addEventListener('click', () => {
								code.textContent = content;
								expandBtn.remove();
							});
						} else {
							resultContent
								.createEl('pre', { cls: 'gemini-agent-tool-code-result' })
								.createEl('code', { text: content });
						}
					} else {
						const resultList = resultContent.createDiv({ cls: 'gemini-agent-tool-result-object' });
						for (const [key, value] of Object.entries(result.data)) {
							if (value === undefined || value === null) continue;
							if (key === 'content' && typeof value === 'string' && value.length > 100) continue;

							const item = resultList.createDiv({ cls: 'gemini-agent-tool-result-item' });
							item.createSpan({ text: key + ':', cls: 'gemini-agent-tool-result-key' });
							const valueStr = typeof value === 'string' ? value : JSON.stringify(value) || String(value);
							item.createSpan({
								text: valueStr.length > 100 ? valueStr.substring(0, 100) + '...' : valueStr,
								cls: 'gemini-agent-tool-result-value',
							});
						}
					}
				}
			} else {
				const resultContent = resultSection.createDiv({ cls: 'gemini-agent-tool-result-content' });
				resultContent.createEl('p', {
					text: `${toolName}: ${OPERATION_COMPLETED_SUCCESSFULLY_MSG}`,
					cls: 'gemini-agent-tool-success-message',
				});
			}
		}

		// Auto-expand row details if there was an error
		if (!result.success) {
			const rowDetails = toolRow.querySelector('.gemini-tool-row-details') as HTMLElement;
			const rowChevron = toolRow.querySelector('.gemini-tool-row-chevron') as HTMLElement;
			const rowHeader = toolRow.querySelector('.gemini-tool-row-header') as HTMLElement;
			if (rowDetails && rowDetails.style.display === 'none') {
				rowDetails.style.display = 'block';
				if (rowChevron) setIcon(rowChevron, 'chevron-down');
				if (rowHeader) rowHeader.setAttribute('aria-expanded', 'true');
				toolRow.classList.add('gemini-tool-row-expanded');
			}
		}

		// Update group summary if this row is inside a group
		const parentGroup = toolRow.closest('.gemini-tool-group') as HTMLElement;
		if (parentGroup) {
			const currentCompleted = parseInt(parentGroup.dataset.completedCount || '0', 10);
			const currentFailed = parseInt(parentGroup.dataset.failedCount || '0', 10);
			if (result.success) {
				parentGroup.dataset.completedCount = String(currentCompleted + 1);
			} else {
				parentGroup.dataset.failedCount = String(currentFailed + 1);
			}
			this.updateGroupSummary(parentGroup);
		}
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
