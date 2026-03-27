import { ChatSession } from './agent';
import { ToolResult } from '../tools/types';

/**
 * Handler priority levels. Lower numbers execute first.
 */
export enum HandlerPriority {
	INTERNAL = 100,
	NORMAL = 500,
	EXTERNAL = 900,
}

/**
 * Payloads for each agent lifecycle event.
 */
export interface AgentEventMap {
	/** User sends a message, before any API call */
	turnStart: Readonly<{
		session: ChatSession;
		userMessage: string;
	}>;

	/** Entire turn complete (including all tool chains) */
	turnEnd: Readonly<{
		session: ChatSession;
		toolCallCount: number;
	}>;

	/** Turn failed with an error */
	turnError: Readonly<{
		session: ChatSession;
		error: Error;
	}>;

	/** Individual tool finished executing */
	toolExecutionComplete: Readonly<{
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
		toolCount: number;
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
