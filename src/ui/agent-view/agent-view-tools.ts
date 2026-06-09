import type { Content } from '@google/genai';
import type ObsidianGemini from '../../main';
import { ChatSession } from '../../types/agent';
import { GeminiConversationEntry } from '../../types/conversation';
import { IConfirmationProvider, IToolHostView, ToolResult } from '../../tools/types';
import { CustomPrompt } from '../../prompts/types';
import { AgentLoop } from '../../agent/agent-loop';
import type { ToolCall } from '../../api/interfaces/model-api';
import { AgentViewToolDisplay } from './agent-view-tool-display';
import type { PerTurnContext } from './agent-view-tool-followup';

/**
 * Callbacks and state access that AgentViewTools needs from AgentView
 */
export interface AgentViewContext {
	getCurrentSession(): ChatSession | null;
	isCancellationRequested(): boolean;
	updateProgress(statusText: string, state?: 'thinking' | 'tool' | 'waiting' | 'streaming'): void;
	hideProgress(): void;
	displayMessage(entry: GeminiConversationEntry): Promise<void>;
	/** Render a reasoning line into an arbitrary container (e.g. the tool group body). */
	renderReasoning(container: HTMLElement, thoughts: string, sourcePath: string): Promise<void>;
	incrementToolCallCount?(count: number): void;
	/** Who approves tool calls that require confirmation — AgentView implements this. */
	confirmationProvider: IConfirmationProvider;
	/** View side effects tools can trigger (shelf updates, header refresh). */
	viewActions: IToolHostView;
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
	/** Reasoning produced before the first tool batch, rendered into the group once it exists. */
	private pendingReasoning: string | null = null;

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
		toolCalls: ToolCall[],
		userMessage: string,
		conversationHistory: Content[],
		_userEntry: GeminiConversationEntry,
		customPrompt?: CustomPrompt,
		perTurn?: PerTurnContext,
		precedingThoughts?: string
	) {
		const currentSession = this.context.getCurrentSession();
		if (!currentSession) return;

		// Reasoning the model produced before this first tool batch. Render it as
		// the first row of the tool group (once the group exists) and persist it.
		this.pendingReasoning = precedingThoughts?.trim() ? precedingThoughts : null;
		if (this.pendingReasoning) {
			await this.plugin.sessionHistory.addEntryToSession(currentSession, {
				role: 'model',
				message: '',
				notePath: '',
				created_at: new Date(),
				model: currentSession.modelConfig?.model || this.plugin.settings.chatModelName,
				thoughts: this.pendingReasoning,
			});
		}

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
					confirmationProvider: this.context.confirmationProvider,
					customPrompt,
					projectRootPath: activeProject?.rootPath,
					featureToolPolicy: activeProject?.config.toolPolicy,
					viewActions: this.context.viewActions,
					perTurn,
					hooks: {
						onToolBatchStart: async (batch) => {
							this.ensureGroupContainer(batch.length);
							// Flush any pre-tool reasoning as the first row of the group.
							if (this.pendingReasoning) {
								await this.renderReasoningInGroup(this.pendingReasoning);
								this.pendingReasoning = null;
							}
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
						onModelReasoning: async (thoughts) => {
							// Reasoning the model produced before deciding to call the
							// next tool batch — render it as a row inside the current tool
							// group (interleaved with the tool calls) and persist it.
							await this.renderReasoningInGroup(thoughts);
							await this.plugin.sessionHistory.addEntryToSession(currentSession, {
								role: 'model',
								message: '',
								notePath: '',
								created_at: new Date(),
								model: currentSession.modelConfig?.model || this.plugin.settings.chatModelName,
								thoughts,
							});
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
				model: currentSession.modelConfig?.model || this.plugin.settings.chatModelName,
				...(result.thoughts ? { thoughts: result.thoughts } : {}),
			};

			await this.context.displayMessage(aiEntry);

			// `fellBack` (empty-response courtesy) and `loopAborted` (loop-detector
			// escalation) both produce UI-only notices — don't pollute session
			// history with synthetic content the model didn't actually say.
			if (!result.fellBack && !result.loopAborted) {
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
	 * Render a reasoning line into the current tool group's body so it interleaves
	 * with the tool rows in execution order. No-op if there's no active group.
	 */
	private async renderReasoningInGroup(thoughts: string): Promise<void> {
		if (!this.currentGroupContainer) return;
		const body = this.currentGroupContainer.querySelector('.gemini-tool-group-body') as HTMLElement | null;
		if (!body) return;
		const sourcePath = this.context.getCurrentSession()?.historyPath || '';
		await this.context.renderReasoning(body, thoughts, sourcePath);
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
