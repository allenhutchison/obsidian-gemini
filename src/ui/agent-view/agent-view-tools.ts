import type { Content } from '@google/genai';
import { getActiveChatModel } from '../../models';
import type { ObsidianGemini } from '../../types/plugin';
import { ChatSession } from '../../types/agent';
import { GeminiConversationEntry } from '../../types/conversation';
import { IConfirmationProvider, IToolHostView, ToolResult } from '../../tools/types';
import { CustomPrompt } from '../../prompts/types';
import { AgentLoop, DEFAULT_INTERACTIVE_MAX_ITERATIONS } from '../../agent/agent-loop';
import { DEFAULT_TURN_BUDGET_REMIND_AT } from '../../agent/turn-budget';
import type { ToolCall, StreamChunk } from '../../api/interfaces/model-api';
import { AgentViewToolDisplay } from './agent-view-tool-display';
import type { PerTurnContext } from './agent-view-tool-followup';
import { buildCompactionEntry } from './compaction-notice';
import { t } from '../../i18n';

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
	/** Refresh the header token-usage display from ContextManager's cached metadata. */
	updateTokenUsage?(): Promise<void>;
	incrementToolCallCount?(count: number): void;
	/** Who approves tool calls that require confirmation — AgentView implements this. */
	confirmationProvider: IConfirmationProvider;
	/** View side effects tools can trigger (shelf updates, header refresh). */
	viewActions: IToolHostView;
	/**
	 * Create an empty live streaming container for follow-up response text.
	 * Returns undefined when the view can't create one (e.g. in tests that don't
	 * implement this method).
	 */
	createFollowUpStream?(): HTMLElement;
	/**
	 * Finalize the live streaming container with full markdown rendering and
	 * scroll the view to the bottom. Called in place of `displayMessage` when
	 * a follow-up was streamed.
	 */
	finalizeFollowUpStream?(container: HTMLElement, entry: GeminiConversationEntry): Promise<void>;
	/**
	 * Register the in-flight follow-up stream (or clear it with `null`) so the
	 * Stop button can cancel it mid-stream. The view forwards this to the same
	 * `currentStreamingResponse` slot the initial request uses.
	 */
	registerFollowUpStream?(stream: { cancel: () => void } | null): void;
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
	/** Live streaming container for the follow-up text response, set on first text chunk. */
	private streamingFollowUpContainer: HTMLElement | null = null;
	private display: AgentViewToolDisplay;
	/** Reasoning produced before the first tool batch, rendered into the group once it exists. */
	private pendingReasoning: string | null = null;
	/**
	 * Latest remaining turns from the soft budget (via `onBudgetUpdate`), used to
	 * surface a small counter in the "Thinking…" progress label as the budget
	 * runs low. `Infinity` (or undefined) means no finite budget — no counter.
	 */
	private budgetRemaining: number | undefined;

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

		// Fresh budget counter per user turn (this instance is reused across turns).
		this.budgetRemaining = undefined;

		// Reasoning the model produced before this first tool batch. Render it as
		// the first row of the tool group (once the group exists) and persist it.
		this.pendingReasoning = precedingThoughts?.trim() ? precedingThoughts : null;
		if (this.pendingReasoning) {
			await this.plugin.sessionHistory.addEntryToSession(currentSession, {
				role: 'model',
				message: '',
				notePath: '',
				created_at: new Date(),
				model: currentSession.modelConfig?.model || getActiveChatModel(this.plugin.settings),
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
					// Give interactive sessions a high soft budget so the reminder +
					// one-shot extension machinery applies here too, bounding runaway
					// loops on the path users watch without capping normal work.
					maxIterations: DEFAULT_INTERACTIVE_MAX_ITERATIONS,
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
						onBudgetUpdate: ({ remaining }) => {
							// Remember the latest count so the next "Thinking…" label can
							// surface it once the budget runs low.
							this.budgetRemaining = remaining;
						},
						onFollowUpRequestStart: () => {
							this.context.updateProgress(this.thinkingLabel(), 'thinking');
						},
						onFollowUpChunk: (chunk: StreamChunk) => {
							if (!chunk.text) return;
							if (!this.streamingFollowUpContainer) {
								// Only create a container once there's actual (non-whitespace) text
								// to show — intermediate tool-continuation turns that produce no
								// text must not spawn an empty streaming bubble.
								if (!chunk.text.trim()) return;
								this.streamingFollowUpContainer = this.context.createFollowUpStream?.() ?? null;
								this.context.updateProgress(t('agent.progress.generating'), 'streaming');
							}
							if (!this.streamingFollowUpContainer) return;
							const contentDiv = this.streamingFollowUpContainer.querySelector('.gemini-agent-message-content');
							if (contentDiv) {
								contentDiv.appendChild(contentDiv.ownerDocument.createTextNode(chunk.text));
							}
						},
						onFollowUpStreamReady: (stream) => {
							// Route the live follow-up stream to the view's Stop target so
							// pressing Stop cancels token generation immediately.
							this.context.registerFollowUpStream?.(stream);
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
								model: currentSession.modelConfig?.model || getActiveChatModel(this.plugin.settings),
								thoughts,
							});
						},
						onMidLoopCompaction: async ({ summaryText }) => {
							// Mirrors the pre-turn "Context Compacted" notice in
							// agent-view-send.ts — surface the same notification when
							// AgentLoop compacts history mid-tool-chain. AgentLoop already
							// force-set the post-compaction usage metadata before firing
							// this hook, so refreshing the header just re-reads it.
							await this.context.updateTokenUsage?.();
							if (!summaryText) return;
							const compactionEntry = buildCompactionEntry(
								summaryText,
								currentSession.modelConfig?.model || getActiveChatModel(this.plugin.settings)
							);
							await this.context.displayMessage(compactionEntry);
							await this.plugin.sessionHistory.addEntryToSession(currentSession, compactionEntry);
						},
					},
				},
			});

			// Tool chain done — clear the group so the next user turn opens a fresh one.
			this.currentGroupContainer = null;

			if (result.cancelled) {
				this.streamingFollowUpContainer?.remove();
				this.streamingFollowUpContainer = null;
				this.context.hideProgress();
				return;
			}

			if (!result.markdown) {
				// Loop ran but produced nothing actionable (cancelled mid-stream or
				// exhausted iterations without a text response). Just hide progress.
				this.streamingFollowUpContainer?.remove();
				this.streamingFollowUpContainer = null;
				this.context.hideProgress();
				return;
			}

			const aiEntry: GeminiConversationEntry = {
				role: 'model',
				message: result.markdown,
				notePath: '',
				created_at: new Date(),
				model: currentSession.modelConfig?.model || getActiveChatModel(this.plugin.settings),
				...(result.thoughts ? { thoughts: result.thoughts } : {}),
			};

			const streamingContainer = this.streamingFollowUpContainer;
			this.streamingFollowUpContainer = null;

			if (streamingContainer && this.context.finalizeFollowUpStream) {
				// Follow-up was streamed into a live container — finalize it with
				// proper markdown rendering rather than creating a duplicate message.
				await this.context.finalizeFollowUpStream(streamingContainer, aiEntry);
			} else {
				if (streamingContainer) {
					// View doesn't support finalization — remove the partial container
					// so displayMessage can render the full markdown cleanly.
					streamingContainer.remove();
				}
				await this.context.displayMessage(aiEntry);
			}

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
			this.streamingFollowUpContainer?.remove();
			this.streamingFollowUpContainer = null;
			this.context.hideProgress();
		}
	}

	/**
	 * The "Thinking…" progress label, suffixed with a small remaining-turns
	 * counter once the soft budget runs low (≤ the reminder threshold). A
	 * non-finite or absent budget shows the plain label.
	 */
	private thinkingLabel(): string {
		const remaining = this.budgetRemaining;
		if (remaining !== undefined && Number.isFinite(remaining) && remaining <= DEFAULT_TURN_BUDGET_REMIND_AT) {
			return t('agent.progress.thinkingWithBudget', {
				thinking: t('agent.progress.thinking'),
				remaining,
			});
		}
		return t('agent.progress.thinking');
	}

	/**
	 * Render a "permission granted" acknowledgment into the current tool group,
	 * interleaved with the tool rows. Called by the view after the user approves
	 * a confirmation, so the acknowledgment sits in the activity stack instead of
	 * stacking up in the main conversation flow.
	 */
	public showPermissionGranted(toolName: string): void {
		this.display.showPermissionGranted(toolName, this.currentGroupContainer);
	}

	/**
	 * Render a reasoning line into the current tool group's body so it interleaves
	 * with the tool rows in execution order. No-op if there's no active group.
	 */
	private async renderReasoningInGroup(thoughts: string): Promise<void> {
		if (!this.currentGroupContainer) return;
		const body = this.currentGroupContainer.querySelector<HTMLElement>('.gemini-tool-group-body');
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
	public async showToolExecution(
		toolName: string,
		parameters: Record<string, unknown>,
		executionId?: string
	): Promise<void> {
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
