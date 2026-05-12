import type ObsidianGemini from '../main';
import type { ChatSession, PerTurnContext } from '../types/agent';
import type { FeatureToolPolicy } from '../types/tool-policy';
import type { ToolCall, ModelResponse, ModelApi } from '../api/interfaces/model-api';
import type { CustomPrompt } from '../prompts/types';
import type { IConfirmationProvider, ToolExecutionContext, ToolResult } from '../tools/types';
import { generateToolDescription } from '../utils/text-generation';
import { sortToolCallsByPriority, buildToolHistoryTurns, type ToolCallResultPair } from './agent-loop-helpers';
import {
	buildFollowUpRequest,
	buildRetryRequest,
	buildEmptyResponseMessage,
} from '../ui/agent-view/agent-view-tool-followup';

/**
 * UI-agnostic hooks the AgentLoop fires at key points so callers (UI agent
 * view, headless task runners) can render or react without the loop knowing
 * anything about its caller. All hooks are optional; an absent hook is a no-op.
 */
export interface AgentLoopHooks {
	/**
	 * Fired once at the start of each tool-execution batch (every iteration of
	 * the loop), with the sorted batch the loop is about to execute. UI uses
	 * this to provision or extend the tool group container — the per-tool
	 * `onToolCallStart` hook fires inside the batch and assumes the container
	 * already accounts for these calls in its running total.
	 */
	onToolBatchStart?(toolCalls: ToolCall[], iterationIndex: number): void | Promise<void>;
	/**
	 * Fired immediately before a tool executes. UI uses this to render a tool
	 * row in the chat. `description` is the human-friendly progress label
	 * (e.g. "Reading note.md") computed by the loop from the tool's
	 * getProgressDescription or the generic fallback.
	 */
	onToolCallStart?(toolCall: ToolCall, executionId: string, description: string): void | Promise<void>;
	/** Fired after a tool execution completes (success or failure). */
	onToolCallComplete?(toolCall: ToolCall, result: ToolResult, executionId: string): void | Promise<void>;
	/** Fired once per completed tool — UI uses this to bump its turn counter. */
	onToolCounted?(): void;
	/**
	 * Fired before the follow-up model call that follows each tool batch.
	 * UI uses this to update the progress label ("Processing results…",
	 * then "Thinking…").
	 */
	onFollowUpRequestStart?(): void | Promise<void>;
	/** Fired when the loop falls into the empty-response retry path. */
	onEmptyResponseRetry?(): void | Promise<void>;
}

export interface AgentLoopOptions {
	plugin: ObsidianGemini;
	session: ChatSession;
	/**
	 * Returns true when the caller wants the loop to abort. Polled at every
	 * cancellation-safe boundary (between tools, before follow-up requests).
	 */
	isCancelled: () => boolean;
	/**
	 * Who approves tool calls that require confirmation. UI callers pass the
	 * agent view; headless callers pass an auto-approve provider. Required —
	 * the engine no longer reaches out to the plugin to find one.
	 */
	confirmationProvider: IConfirmationProvider;
	/** Optional cap on the number of tool-execution batches. Undefined = no cap. */
	maxIterations?: number;
	customPrompt?: CustomPrompt;
	projectRootPath?: string;
	/**
	 * Feature-level tool policy (project / scheduled-task / hook scope) applied
	 * on top of the global plugin policy for the duration of the turn. When
	 * unset, only the global policy applies.
	 */
	featureToolPolicy?: FeatureToolPolicy;
	/**
	 * System-prompt fields that must stay byte-stable across the initial model
	 * call and every follow-up/retry within this turn. Without these, follow-up
	 * requests rebuild the system prompt without context-file content / project
	 * scope, which both confuses the model after a tool call and forces a
	 * Gemini implicit-cache miss on every follow-up. Caller (agent-view-send)
	 * sets these once when the user submits the turn.
	 */
	perTurn?: PerTurnContext;
	hooks?: AgentLoopHooks;
	/**
	 * Factory for the model API used for follow-up and retry requests.
	 * Defaults to `AgentFactory.createAgentModel(plugin, session)`. Pass a
	 * custom factory to inject a stub in tests or use a different config.
	 */
	createModelApi?: () => ModelApi;
}

export interface AgentLoopResult {
	/**
	 * Final text response. Empty when cancelled before any text was produced.
	 * When `fellBack` is true, this is the empty-response fallback message
	 * (which the caller may display but should not save to session history).
	 */
	markdown: string;
	/** Final conversation history including all tool turns. */
	history: any[];
	/** True if cancellation interrupted the loop. */
	cancelled: boolean;
	/** True if the empty-response retry was triggered. */
	retried: boolean;
	/**
	 * True if even the retry returned empty and `markdown` is the fallback
	 * message listing executed tools. Caller should display but not persist.
	 */
	fellBack: boolean;
	/** True if `maxIterations` was reached without a terminal text response. */
	exhausted: boolean;
	/**
	 * True if the turn was aborted because the tool loop detector fired more
	 * times than `AGENT_LOOP_ABORT_THRESHOLD` in a single turn. `markdown` is
	 * a user-visible notice the caller may render but should not persist as a
	 * model response.
	 */
	loopAborted: boolean;
	/** Number of tool-execution batches that ran. */
	iterations: number;
}

/**
 * Number of tool-loop-detector fires (per turn) before the loop aborts the
 * turn entirely. Individual identical-call blocking still happens on every
 * fire via `ToolExecutionEngine`; this threshold exists so a model that
 * keeps re-attempting the same call after being told "loop detected" still
 * gets stopped cleanly instead of burning iterations and tokens.
 */
export const AGENT_LOOP_ABORT_THRESHOLD = 3;

/**
 * Drives the tool-execution loop after the initial model response. Iterates
 * until the model returns a text response (or cancellation / iteration cap /
 * empty-fallback fires). UI-agnostic — callers attach behavior via hooks.
 *
 * The caller is responsible for:
 *  - The initial API call (so streaming concerns stay caller-side)
 *  - Saving the final text response to session history (so headless callers
 *    can write to a file instead)
 *  - All UI side effects (tool rendering, progress labels) via hooks
 *
 * Hook contract: hooks are observability and side-effect points. A throw from
 * a hook is logged and swallowed — it never aborts the loop or alters tool
 * results. Callers don't need to wrap their hook bodies in try/catch.
 */
export class AgentLoop {
	async run(args: {
		initialResponse: ModelResponse;
		initialUserMessage: string;
		initialHistory: any[];
		options: AgentLoopOptions;
	}): Promise<AgentLoopResult> {
		const { initialResponse, initialUserMessage, initialHistory, options } = args;
		const { plugin, session, isCancelled, hooks, customPrompt, projectRootPath, featureToolPolicy, perTurn } = options;
		const maxIterations = options.maxIterations;

		const toolContext: ToolExecutionContext = {
			plugin,
			session,
			projectRootPath,
			featureToolPolicy,
		};

		// `currentToolCalls` is what we execute on the next iteration. Seed it
		// from the initial response — the caller already paid the cost of that
		// API call and handed us the result.
		let currentToolCalls = initialResponse.toolCalls ?? [];
		let conversationHistory = initialHistory;
		let userMessage = initialUserMessage;
		let iterations = 0;
		// Turn-scoped count of tool-loop-detector fires. Incremented per blocked
		// call (each `ToolResult` with `loopDetected: true`). Once it reaches
		// AGENT_LOOP_ABORT_THRESHOLD the turn aborts cleanly so a model that
		// refuses to adapt after being told "loop detected" doesn't burn the
		// rest of the iteration budget.
		let loopFireCount = 0;

		// Lazily resolve the model API factory once — same instance is reused
		// for every follow-up and retry request in this loop.
		const createModel =
			options.createModelApi ??
			(() => {
				// Avoid a top-level import cycle: AgentFactory → tools → AgentLoop
				const { AgentFactory } = require('./agent-factory');
				return AgentFactory.createAgentModel(plugin, session) as ModelApi;
			});

		while (currentToolCalls.length > 0) {
			if (isCancelled()) {
				return this.cancelledResult(conversationHistory, iterations);
			}

			if (maxIterations !== undefined && iterations >= maxIterations) {
				return {
					markdown: '',
					history: conversationHistory,
					cancelled: false,
					retried: false,
					fellBack: false,
					exhausted: true,
					loopAborted: false,
					iterations,
				};
			}

			// Sort and execute this batch
			const sortedToolCalls = sortToolCallsByPriority(currentToolCalls);
			await this.safeHook('onToolBatchStart', plugin, () => hooks?.onToolBatchStart?.(sortedToolCalls, iterations));
			iterations++;
			const toolResults = await this.executeToolBatch(sortedToolCalls, toolContext, options);

			// Count any loop-detector fires in this batch against the turn budget.
			// If the model has triggered the detector too many times in this turn,
			// stop iterating — the "please try a different approach" hint isn't
			// working and continuing just burns tokens/time.
			for (const tr of toolResults) {
				if (tr.result.loopDetected) loopFireCount++;
			}
			if (loopFireCount >= AGENT_LOOP_ABORT_THRESHOLD) {
				plugin.logger.warn(
					`[AgentLoop] Aborting turn: tool loop detector fired ${loopFireCount} times ` +
						`(threshold ${AGENT_LOOP_ABORT_THRESHOLD})`
				);
				const updatedHistory = buildToolHistoryTurns({
					conversationHistory,
					userMessage,
					toolCalls: currentToolCalls,
					toolResults,
				});
				return this.loopAbortedResult(updatedHistory, iterations, loopFireCount);
			}

			// Emit toolChainComplete so subscribers (accessed-files tracker, etc.) see this batch.
			await this.safeEmit(plugin, 'toolChainComplete', {
				session,
				toolResults: toolResults.map((tr) => ({
					toolName: tr.toolName,
					toolArguments: tr.toolArguments,
					result: tr.result,
				})),
				toolCount: toolResults.length,
			});

			plugin.logger.debug(
				`[AgentLoop] Building tool call parts: ${currentToolCalls.length} calls, ` +
					`${currentToolCalls.filter((tc) => tc.thoughtSignature).length} with signatures`
			);

			const updatedHistory = buildToolHistoryTurns({
				conversationHistory,
				userMessage,
				toolCalls: currentToolCalls,
				toolResults,
			});

			if (isCancelled()) {
				return this.cancelledResult(updatedHistory, iterations);
			}

			// Follow-up: ask the model what to do next given the tool results
			await this.safeHook('onFollowUpRequestStart', plugin, () => hooks?.onFollowUpRequestStart?.());

			const followUpRequest = buildFollowUpRequest({
				plugin,
				currentSession: session,
				updatedHistory,
				customPrompt,
				projectRootPath,
				featureToolPolicy,
				...perTurn,
			});

			const modelApi = createModel();
			const followUpResponse = await modelApi.generateModelResponse(followUpRequest);

			if (followUpResponse.usageMetadata) {
				await this.safeEmit(plugin, 'apiResponseReceived', {
					usageMetadata: followUpResponse.usageMetadata,
				});
			}

			if (followUpResponse.toolCalls && followUpResponse.toolCalls.length > 0) {
				// Continue iterating with the new tool calls.
				if (isCancelled()) {
					return this.cancelledResult(updatedHistory, iterations);
				}
				currentToolCalls = followUpResponse.toolCalls;
				conversationHistory = updatedHistory;
				userMessage = ''; // Empty on follow-up — tool results are already in history
				continue;
			}

			// Terminal: model returned text (or empty)
			if (followUpResponse.markdown && followUpResponse.markdown.trim()) {
				return {
					markdown: followUpResponse.markdown,
					history: updatedHistory,
					cancelled: false,
					retried: false,
					fellBack: false,
					exhausted: false,
					loopAborted: false,
					iterations,
				};
			}

			// Empty response — try once with a simpler prompt that excludes tools.
			plugin.logger.warn('[AgentLoop] Model returned empty response after tool execution');

			if (isCancelled()) {
				return this.cancelledResult(updatedHistory, iterations);
			}

			await this.safeHook('onEmptyResponseRetry', plugin, () => hooks?.onEmptyResponseRetry?.());

			const retryRequest = buildRetryRequest({
				plugin,
				currentSession: session,
				updatedHistory,
				customPrompt,
				...perTurn,
			});

			const retryModelApi = createModel();
			const retryResponse = await retryModelApi.generateModelResponse(retryRequest);

			if (retryResponse.usageMetadata) {
				await this.safeEmit(plugin, 'apiResponseReceived', {
					usageMetadata: retryResponse.usageMetadata,
				});
			}

			if (retryResponse.markdown && retryResponse.markdown.trim()) {
				return {
					markdown: retryResponse.markdown,
					history: updatedHistory,
					cancelled: false,
					retried: true,
					fellBack: false,
					exhausted: false,
					loopAborted: false,
					iterations,
				};
			}

			// Both attempts empty — fall back to the executed-tools summary.
			plugin.logger.warn('[AgentLoop] Model returned empty response after retry');
			return {
				markdown: buildEmptyResponseMessage(toolResults, plugin),
				history: updatedHistory,
				cancelled: false,
				retried: true,
				fellBack: true,
				exhausted: false,
				loopAborted: false,
				iterations,
			};
		}

		// No initial tool calls at all — degenerate case the caller shouldn't hit
		// (they'd have used the initial response directly). Return a no-op result.
		return {
			markdown: '',
			history: conversationHistory,
			cancelled: false,
			retried: false,
			fellBack: false,
			exhausted: false,
			loopAborted: false,
			iterations: 0,
		};
	}

	/**
	 * Run a hook callback and swallow any throw with a logger entry. Hooks are
	 * fire-and-forget side effects — they must never abort the loop or alter
	 * tool results. A throwing UI hook (e.g. DOM write fails because the view
	 * was closed mid-turn) gets logged and the loop continues unaffected.
	 */
	private async safeHook(
		hookName: string,
		plugin: ObsidianGemini,
		fn: () => void | Promise<void> | undefined
	): Promise<void> {
		try {
			await fn();
		} catch (error) {
			plugin.logger.error(`[AgentLoop] Hook ${hookName} threw — continuing:`, error);
		}
	}

	/**
	 * Emit on the agent event bus with the same swallow-and-log policy as
	 * hooks. A subscriber's failure is observability noise, not a reason to
	 * abort an in-flight agent turn.
	 */
	private async safeEmit(plugin: ObsidianGemini, event: string, payload: any): Promise<void> {
		try {
			await plugin.agentEventBus?.emit(event as any, payload);
		} catch (error) {
			plugin.logger.error(`[AgentLoop] Event bus emit "${event}" threw — continuing:`, error);
		}
	}

	private cancelledResult(history: any[], iterations: number): AgentLoopResult {
		return {
			markdown: '',
			history,
			cancelled: true,
			retried: false,
			fellBack: false,
			exhausted: false,
			loopAborted: false,
			iterations,
		};
	}

	private loopAbortedResult(history: any[], iterations: number, fireCount: number): AgentLoopResult {
		return {
			markdown:
				`The agent kept retrying the same tool call (loop detector fired ${fireCount} times). ` +
				'Stopping this turn to prevent a runaway loop. Try rephrasing your request or starting a new session.',
			history,
			cancelled: false,
			retried: false,
			fellBack: false,
			exhausted: false,
			loopAborted: true,
			iterations,
		};
	}

	private async executeToolBatch(
		sortedToolCalls: ToolCall[],
		toolContext: ToolExecutionContext,
		options: AgentLoopOptions
	): Promise<ToolCallResultPair[]> {
		const { plugin, isCancelled, hooks, confirmationProvider } = options;
		const results: ToolCallResultPair[] = [];

		for (const toolCall of sortedToolCalls) {
			if (isCancelled()) {
				plugin.logger.debug('[AgentLoop] Cancellation detected, stopping tool execution');
				break;
			}

			const executionId = `${toolCall.name}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

			try {
				const tool = plugin.toolRegistry.getTool(toolCall.name);
				const displayName = tool?.displayName || toolCall.name;
				const description = tool?.getProgressDescription
					? tool.getProgressDescription(toolCall.arguments)
					: generateToolDescription(plugin, toolCall.name, toolCall.arguments, displayName);

				await this.safeHook('onToolCallStart', plugin, () =>
					hooks?.onToolCallStart?.(toolCall, executionId, description)
				);

				const startedAt = Date.now();
				const result = await plugin.toolExecutionEngine.executeTool(toolCall, toolContext, confirmationProvider);
				const durationMs = Date.now() - startedAt;

				// Log failed tool results so root causes aren't silent — the engine's
				// early-return paths return {success: false} without logging themselves.
				if (!result.success) {
					plugin.logger.warn(`[AgentLoop] Tool ${toolCall.name} failed:`, result.error, 'args:', toolCall.arguments);
				}

				await this.safeHook('onToolCallComplete', plugin, () =>
					hooks?.onToolCallComplete?.(toolCall, result, executionId)
				);

				await this.safeEmit(plugin, 'toolExecutionComplete', {
					toolName: toolCall.name,
					args: toolCall.arguments || {},
					result,
					durationMs,
				});

				await this.safeHook('onToolCounted', plugin, () => hooks?.onToolCounted?.());

				results.push({
					toolName: toolCall.name,
					toolArguments: toolCall.arguments,
					result,
				});
			} catch (error) {
				plugin.logger.error(`[AgentLoop] Tool execution error for ${toolCall.name}:`, error);
				await this.safeHook('onToolCounted', plugin, () => hooks?.onToolCounted?.());
				results.push({
					toolName: toolCall.name,
					toolArguments: toolCall.arguments || {},
					result: {
						success: false,
						error: error instanceof Error ? error.message : 'Unknown error',
					},
				});
			}
		}

		return results;
	}
}
