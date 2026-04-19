import type ObsidianGemini from '../../main';
import { ChatSession } from '../../types/agent';
import { GeminiConversationEntry } from '../../types/conversation';
import { ToolResult } from '../../tools/types';
import { CustomPrompt } from '../../prompts/types';
import { AgentLoop } from '../../agent/agent-loop';
import { AgentViewToolDisplay } from './agent-view-tool-display';

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
 * UI adapter that drives AgentLoop for the agent chat view.
 *
 * Owns: tool group container DOM state, session-history persistence for the
 * final response, and the bridge from AgentLoop hooks to AgentViewToolDisplay
 * + AgentViewProgress.
 *
 * The actual tool-execution loop (iteration, history construction, follow-up
 * requests, empty-response retry, cancellation) lives in AgentLoop and is
 * shared with headless callers.
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
	 * Handle tool calls from the model response. Drives AgentLoop with hooks
	 * wired to UI rendering, then persists/displays the final text response.
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

		const activeProject = currentSession.projectPath
			? await this.plugin.projectManager?.getProject(currentSession.projectPath)
			: null;

		const loop = new AgentLoop();
		try {
			const result = await loop.run({
				initialResponse: { markdown: '', rendered: '', toolCalls },
				initialUserMessage: userMessage,
				initialHistory: conversationHistory,
				options: {
					plugin: this.plugin,
					session: currentSession,
					isCancelled: () => this.context.isCancellationRequested(),
					customPrompt,
					projectRootPath: activeProject?.rootPath,
					projectPermissions: activeProject?.config.permissions,
					hooks: {
						onToolBatchStart: (batch) => {
							this.ensureGroupContainer(batch.length);
						},
						onToolCallStart: async (toolCall, executionId, description) => {
							this.context.updateProgress(description, 'tool');
							await this.display.showToolExecution(
								toolCall.name,
								toolCall.arguments,
								executionId,
								this.currentGroupContainer
							);
							this.currentExecutingTool = toolCall.name;
						},
						onToolCallComplete: async (toolCall, toolResult, executionId) => {
							this.lastCompletedTool = toolCall.name;
							this.currentExecutingTool = null;
							await this.display.showToolResult(toolCall.name, toolResult, executionId);
						},
						onToolCounted: () => {
							this.context.incrementToolCallCount?.(1);
						},
						onFollowUpRequestStart: () => {
							this.context.updateProgress('Thinking...', 'thinking');
						},
					},
				},
			});

			// Tool chain done — clear the group so the next user turn opens a fresh one.
			this.currentGroupContainer = null;

			if (result.cancelled) {
				this.context.hideProgress();
				return;
			}

			if (!result.markdown) {
				// Loop ran but produced nothing actionable (cancelled mid-stream or
				// exhausted iterations without a text response). Just hide progress.
				this.context.hideProgress();
				return;
			}

			const aiEntry: GeminiConversationEntry = {
				role: 'model',
				message: result.markdown,
				notePath: '',
				created_at: new Date(),
			};

			await this.context.displayMessage(aiEntry);

			// The empty-response fallback message is a UI-only courtesy — don't
			// pollute session history with synthetic content the model didn't say.
			if (!result.fellBack) {
				await this.plugin.sessionHistory.addEntryToSession(currentSession, aiEntry);
			}

			this.context.hideProgress();
		} catch (error) {
			this.plugin.logger.error('[AgentViewTools] Failed to process tool results:', error);
			this.currentGroupContainer = null;
			this.context.hideProgress();
		}
	}

	/**
	 * Create a new tool group container or extend the existing one's running total.
	 * Reuses the same group across nested loop iterations within a single turn.
	 */
	private ensureGroupContainer(addedCount: number): void {
		if (this.currentGroupContainer) {
			const prev = parseInt(this.currentGroupContainer.dataset.totalCount || '0', 10);
			this.currentGroupContainer.dataset.totalCount = String(prev + addedCount);
			this.display.updateGroupSummary(this.currentGroupContainer);
		} else {
			this.currentGroupContainer = this.display.createToolGroup(addedCount);
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
