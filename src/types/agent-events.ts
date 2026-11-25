import { ChatSession } from './agent';
import { ToolResult } from '../tools/types';
import type { UsageMetadata } from '../api/interfaces/usage-metadata';

/**
 * Handler priority levels. Lower numbers execute first.
 */
export enum HandlerPriority {
	INTERNAL = 100,
	NORMAL = 500,
	EXTERNAL = 900,
}

/**
 * How an interactive agent turn ended, reported on `turnEnd`. The words match
 * the background task end states. Users write them into hook prompts
 * (`{{turnOutcome}}`), so they are a fixed contract: don't rename them.
 *
 * - `complete`: the agent produced a final answer.
 * - `incomplete`: the turn ended normally without a final answer (tool
 *   iteration cap, loop detector, an empty response, or a rejected plan).
 * - `failed`: an exception ended the turn, or a failed tool call stopped it
 *   (the `stopOnToolError` setting).
 * - `cancelled`: the user pressed Stop. Wins over `failed` when a stopped
 *   turn also throws while unwinding.
 */
export type TurnOutcome = 'complete' | 'incomplete' | 'failed' | 'cancelled';

/**
 * Payloads for each agent lifecycle event.
 */
export interface AgentEventMap {
	/** User sends a message, before any API call */
	turnStart: Readonly<{
		session: ChatSession;
		userMessage: string;
	}>;

	/**
	 * Entire turn over (including all tool chains). Emitted for every turn,
	 * whatever its outcome, so subscribers get a reliable end signal.
	 */
	turnEnd: Readonly<{
		session: ChatSession;
		toolCallCount: number;
		/** How the turn ended. */
		outcome: TurnOutcome;
		/**
		 * The user's message as typed. Unlike `turnStart.userMessage`, it has no
		 * date/time preamble, since hook prompts quote it.
		 */
		userMessage: string;
	}>;

	/** Turn failed with an error */
	turnError: Readonly<{
		session: ChatSession;
		error: Error;
	}>;

	/** Individual tool finished executing */
	toolExecutionComplete: Readonly<{
		session: ChatSession;
		toolName: string;
		args: Record<string, unknown>;
		result: ToolResult;
		durationMs: number;
	}>;

	/** All tools in a batch finished, before follow-up API call */
	toolChainComplete: Readonly<{
		session: ChatSession;
		toolResults: ReadonlyArray<{
			toolName: string;
			toolArguments: Record<string, unknown>;
			result: ToolResult;
		}>;
	}>;

	/**
	 * Tool loop detector fired and blocked a call. Emitted per fire so UI
	 * subscribers can surface it (chat notice, badge, etc.) beyond the
	 * logger.warn already emitted by the engine.
	 */
	toolLoopDetected: Readonly<{
		/** Session whose tool call was blocked — subscribers key per-session state on it. */
		sessionId: string;
		toolName: string;
		args: Record<string, unknown>;
		identicalCallCount: number;
		timeWindowMs: number;
	}>;

	/** After any API response (initial, follow-up, or retry) with usage metadata */
	apiResponseReceived: Readonly<{
		usageMetadata?: UsageMetadata;
		/** Model that produced this response — used to calibrate per-model Ollama token estimates. */
		modelName?: string;
	}>;

	/** After a new agent session is created */
	sessionCreated: Readonly<{
		session: ChatSession;
	}>;

	/** After an existing session is loaded from history */
	sessionLoaded: Readonly<{
		session: ChatSession;
	}>;

	/** A background task has started running */
	backgroundTaskStarted: Readonly<{
		taskId: string;
		type: string;
		label: string;
	}>;

	/** A background task completed successfully */
	backgroundTaskComplete: Readonly<{
		taskId: string;
		type: string;
		label: string;
		outputPath: string | undefined;
	}>;

	/** A background task failed or was cancelled */
	backgroundTaskFailed: Readonly<{
		taskId: string;
		type: string;
		label: string;
		error: string;
	}>;
}

/** Union of all valid event names */
export type AgentEventName = keyof AgentEventMap;

/** Handler function type for a specific event */
export type AgentEventHandler<E extends AgentEventName> = (payload: AgentEventMap[E]) => Promise<void>;

/** Internal registration record */
export interface HandlerRegistration<E extends AgentEventName> {
	handler: AgentEventHandler<E>;
	priority: number;
}
