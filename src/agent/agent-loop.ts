import type { Content } from '@google/genai';
import type ObsidianGemini from '../main';
import type { ChatSession, PerTurnContext } from '../types/agent';
import type { FeatureToolPolicy } from '../types/tool-policy';
import type { ToolCall, ModelResponse, ModelApi, StreamChunk } from '../api/interfaces/model-api';
import type { CustomPrompt } from '../prompts/types';
import type { IConfirmationProvider, IToolHostView, ToolExecutionContext, ToolResult } from '../tools/types';
import { generateToolDescription } from '../utils/text-generation';
import {
	sortToolCallsByPriority,
	buildToolHistoryTurns,
	formatBudgetReminder,
	formatBudgetExtension,
	type ToolCallResultPair,
} from './agent-loop-helpers';
import { TurnBudget } from './turn-budget';
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
// knip:keep — Intentional public API for UI and headless extension hooks
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
	/**
	 * Fired when an intermediate follow-up response carries model reasoning but
	 * continues to another tool batch (i.e. the model "thought" before deciding
	 * to call more tools). UI/headless callers use this to persist a
	 * reasoning-only model turn so the full session — user → reasoning → tools →
	 * reasoning → answer — is captured. The terminal response's reasoning is
	 * returned on `AgentLoopResult.thoughts` instead, not via this hook.
	 */
	onModelReasoning?(thoughts: string): void | Promise<void>;
	/**
	 * Fired once per iteration after a tool batch runs, with the soft turn
	 * budget's state. `remaining` is `Infinity` for an unlimited (no-cap)
	 * budget; `limit` is `undefined` in that case. `extended` is true once the
	 * one-shot extension has been granted. UI uses this to render a small
	 * remaining-turns counter as the budget runs low.
	 */
	onBudgetUpdate?(state: { remaining: number; limit: number | undefined; extended: boolean }): void | Promise<void>;
	/**
	 * Fired per text chunk when the follow-up model call uses the streaming API.
	 * Only present on the UI path — headless callers leave it unset and follow-ups
	 * use the non-streaming path unchanged. Thought/reasoning chunks are not
	 * forwarded here; they are returned on `AgentLoopResult.thoughts` at the end
	 * of the turn.
	 */
	onFollowUpChunk?(chunk: StreamChunk): void | Promise<void>;
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
	 * True when running unattended (scheduled task, hook fire). Headless runs
	 * auto-approve confirmations, so we must hide ASK_USER tools from the
	 * model — otherwise the user's "ask first" intent gets silently bypassed.
	 * UI callers leave this false; the interactive confirmation provider
	 * handles ASK_USER tools at execution time.
	 */
	headless?: boolean;
	/**
	 * System-prompt fields that must stay byte-stable across the initial model
	 * call and every follow-up/retry within this turn. Without these, follow-up
	 * requests rebuild the system prompt without context-file content / project
	 * scope, which both confuses the model after a tool call and forces a
	 * Gemini implicit-cache miss on every follow-up. Caller (agent-view-send)
	 * sets these once when the user submits the turn.
	 */
	perTurn?: PerTurnContext;
	/**
	 * View-owned side effects (shelf updates, header refresh) for tools that need
	 * them. UI callers (AgentViewTools) pass the owning agent view; headless
	 * callers leave it unset, so those tool calls become no-ops.
	 */
	viewActions?: IToolHostView;
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
	/**
	 * Model reasoning ("thinking") from the terminal follow-up response that
	 * produced `markdown`. Undefined when the model emitted no thoughts or the
	 * turn ended without a text response. The caller attaches this to the final
	 * model history entry. Intermediate reasoning (before further tool batches)
	 * is surfaced via the `onModelReasoning` hook instead, not here.
	 */
	thoughts?: string;
	/** Final conversation history including all tool turns. */
	history: Content[];
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
const AGENT_LOOP_ABORT_THRESHOLD = 3;

/**
 * Default cap on tool-execution iterations for unattended (headless) runs —
 * scheduled tasks and lifecycle hooks. Each iteration is one tool-call batch
 * (which may contain several parallel calls), not a single tool call. Acts as a
 * runaway-loop guard; callers can override it per run via
 * `AgentLoopOptions.maxIterations` (exposed to users through the `maxIterations`
 * frontmatter key on tasks and hooks). Interactive agent-view runs pass no cap.
 */
export const DEFAULT_HEADLESS_MAX_ITERATIONS = 20;

/**
 * Default soft turn budget for interactive agent-view sessions. Unlike the
 * headless cap this is deliberately high — it exists so the soft-budget
 * machinery (reminder + one-shot extension) applies to the path users actually
 * watch, bounding genuinely runaway loops without getting in the way of normal
 * multi-step work. Per the cache-aware framing on #622, a long focused loop is
 * relatively cheap once the prefix cache is warm, so the right interactive cap
 * is higher than the paper's cost-tuned numbers suggest. `AgentViewTools`
 * passes this as `maxIterations`; tune against the eval suite (#619).
 */
export const DEFAULT_INTERACTIVE_MAX_ITERATIONS = 50;

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
		initialHistory: Content[];
		options: AgentLoopOptions;
	}): Promise<AgentLoopResult> {
		const { initialResponse, initialUserMessage, initialHistory, options } = args;
		const {
			plugin,
			session,
			isCancelled,
			hooks,
			customPrompt,
			projectRootPath,
			featureToolPolicy,
			perTurn,
			headless,
			viewActions,
		} = options;
		const maxIterations = options.maxIterations;

		const toolContext: ToolExecutionContext = {
			plugin,
			session,
			projectRootPath,
			featureToolPolicy,
			viewActions,
		};

		// `currentToolCalls` is what we execute on the next iteration. Seed it
		// from the initial response — the caller already paid the cost of that
		// API call and handed us the result.
		let currentToolCalls = initialResponse.toolCalls ?? [];
		let conversationHistory = initialHistory;
		let userMessage = initialUserMessage;
		// `perTurnContext` is a first-iteration input, like `userMessage`:
		// `buildToolHistoryTurns` splices it into the user turn once, after which
		// it lives in `conversationHistory`. Re-passing it on later iterations
		// would splice the (potentially large) context payload in again each time.
		let perTurnContext = perTurn?.perTurnContext;
		let iterations = 0;
		// Turn-scoped count of tool-loop-detector fires. Incremented per blocked
		// call (each `ToolResult` with `loopDetected: true`). Once it reaches
		// AGENT_LOOP_ABORT_THRESHOLD the turn aborts cleanly so a model that
		// refuses to adapt after being told "loop detected" doesn't burn the
		// rest of the iteration budget.
		let loopFireCount = 0;

		// Soft turn budget layered on the hard `maxIterations` cap. An undefined
		// cap yields an unlimited (inert) budget, preserving the no-cap default.
		// `pendingBudgetNotice` carries an extension-grant string from the top of
		// one iteration to the tool-response turn built later in the same pass.
		const budget = new TurnBudget(maxIterations);
		let pendingBudgetNotice: string | undefined;

		// Lazily resolve the model API factory once — same instance is reused
		// for every follow-up and retry request in this loop.
		const createModel =
			options.createModelApi ??
			(() => {
				// Deliberate lazy require to break the AgentFactory → tools → AgentLoop
				// import cycle (see AGENTS.md). A top-level import here would be circular.

				const { AgentFactory } = require('./agent-factory');
				return AgentFactory.createAgentModel(plugin, session) as ModelApi;
			});

		while (currentToolCalls.length > 0) {
			if (isCancelled()) {
				return this.cancelledResult(conversationHistory, iterations);
			}

			// Budget gate. We only reach here with pending tool calls, so an
			// exhausted budget means the model is out of turns but not done. Grant
			// the one-shot extension if it's still available — the grant text is
			// injected into this batch's tool-response turn so the model sees it
			// and can wrap up. A second exhaustion (extension already spent) falls
			// through to the hard-stop `exhausted` path.
			if (budget.isExhausted(iterations)) {
				if (budget.canExtend()) {
					const granted = budget.grantExtension();
					plugin.logger.log(
						`[AgentLoop] Turn budget spent at ${iterations} iterations; granting one-time extension of ${granted} turns`
					);
					pendingBudgetNotice = formatBudgetExtension(granted);
				} else {
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
					perTurnContext,
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

			// Resolve the soft-budget notice for this tool-response turn. An
			// extension grant (set above) takes priority; otherwise inject the
			// low-turns reminder when the threshold is crossed. The model sees
			// whichever applies on its next follow-up.
			let budgetNotice = pendingBudgetNotice;
			pendingBudgetNotice = undefined;
			if (!budgetNotice && budget.shouldRemind(iterations)) {
				budgetNotice = formatBudgetReminder(budget.remaining(iterations));
			}
			await this.safeHook('onBudgetUpdate', plugin, () =>
				hooks?.onBudgetUpdate?.({
					remaining: budget.remaining(iterations),
					limit: budget.limit,
					extended: budget.wasExtended,
				})
			);

			const updatedHistory = buildToolHistoryTurns({
				conversationHistory,
				userMessage,
				perTurnContext,
				toolCalls: currentToolCalls,
				toolResults,
				appendText: budgetNotice,
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
				headless,
				...perTurn,
			});

			const modelApi = createModel();
			let followUpResponse: ModelResponse;

			if (hooks?.onFollowUpChunk && modelApi.generateStreamingResponse) {
				// Streaming follow-up: fire hook per text chunk so the UI can render
				// tokens as they arrive instead of showing a progress bar then a dump.
				// Only create the live container when there is actual text to show —
				// an intermediate tool-continuation turn may produce no text at all.
				let accText = '';
				let accThoughts = '';
				const stream = modelApi.generateStreamingResponse(followUpRequest, (chunk: StreamChunk) => {
					if (chunk.thought) accThoughts += chunk.thought;
					if (chunk.text) {
						accText += chunk.text;
						void this.safeHook('onFollowUpChunk', plugin, () => hooks?.onFollowUpChunk?.({ text: chunk.text }));
					}
				});
				followUpResponse = await stream.complete;
				// Prefer the completed response's text; fall back to the accumulated
				// streaming text when the response object arrives empty.
				if (!followUpResponse.markdown?.trim() && accText.trim()) {
					followUpResponse = { ...followUpResponse, markdown: accText };
				}
				if (!followUpResponse.thoughts?.trim() && accThoughts.trim()) {
					followUpResponse = { ...followUpResponse, thoughts: accThoughts };
				}
			} else {
				followUpResponse = await modelApi.generateModelResponse(followUpRequest);
			}

			if (followUpResponse.usageMetadata) {
				await this.safeEmit(plugin, 'apiResponseReceived', {
					usageMetadata: followUpResponse.usageMetadata,
				});
			}

			if (followUpResponse.toolCalls && followUpResponse.toolCalls.length > 0) {
				// Surface intermediate reasoning (the "why I'm calling these tools"
				// thinking) so the caller can persist a reasoning-only turn before
				// the next tool batch runs.
				if (followUpResponse.thoughts?.trim()) {
					await this.safeHook('onModelReasoning', plugin, () => hooks?.onModelReasoning?.(followUpResponse.thoughts!));
				}

				// Continue iterating with the new tool calls.
				if (isCancelled()) {
					return this.cancelledResult(updatedHistory, iterations);
				}
				currentToolCalls = followUpResponse.toolCalls;
				conversationHistory = updatedHistory;
				// Both are now embedded in `updatedHistory`; clearing them stops the
				// next iteration from splicing a duplicate user/context turn.
				userMessage = ''; // Empty on follow-up — tool results are already in history
				perTurnContext = undefined;
				continue;
			}

			// Terminal: model returned text (or empty)
			if (followUpResponse.markdown && followUpResponse.markdown.trim()) {
				return {
					markdown: followUpResponse.markdown,
					thoughts: followUpResponse.thoughts?.trim() ? followUpResponse.thoughts : undefined,
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
					thoughts: retryResponse.thoughts?.trim() ? retryResponse.thoughts : undefined,
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

	private cancelledResult(history: Content[], iterations: number): AgentLoopResult {
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

	private loopAbortedResult(history: Content[], iterations: number, fireCount: number): AgentLoopResult {
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
