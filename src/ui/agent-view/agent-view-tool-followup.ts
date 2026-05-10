import type ObsidianGemini from '../../main';
import { ChatSession } from '../../types/agent';
import { ToolExecutionContext } from '../../tools/types';
import { ExtendedModelRequest } from '../../api/interfaces/model-api';
import { CustomPrompt } from '../../prompts/types';

/**
 * Per-turn system-prompt fields that must stay stable across the initial
 * model call AND every follow-up/retry within the same user turn.
 *
 * These are set once when the user sends a message (in `agent-view-send.ts`)
 * and threaded through `AgentLoopOptions` so the system prompt rebuilt on
 * each model call inside the loop is byte-identical to the initial one.
 *
 * Two reasons this matters:
 *  1. Correctness — `perTurnContext` carries the rendered content of files
 *     dragged or @-mentioned into the chat. Dropping it on follow-ups means
 *     the model can't reference that content after a tool call, so it tends
 *     to re-read the same files via tools. `projectInstructions` /
 *     `projectSkills` similarly disappear, so project-scoped behavior
 *     degrades the moment a tool fires.
 *  2. Cache stability — Gemini's implicit prefix cache keys on the exact
 *     system-prompt bytes. Rebuilding without these fields between the
 *     initial call and the follow-up changes the prefix and forces a
 *     cache miss on every follow-up in a long tool chain.
 */
export interface PerTurnContext {
	perTurnContext?: string;
	projectInstructions?: string;
	projectSkills?: string[];
	sessionStartedAt?: string;
}

export interface FollowUpRequestParams extends PerTurnContext {
	plugin: ObsidianGemini;
	currentSession: ChatSession;
	updatedHistory: any[];
	customPrompt?: CustomPrompt;
	projectRootPath?: string;
	projectPermissions?: Record<string, import('../../types/tool-policy').ToolPermission>;
}

export interface RetryRequestParams extends PerTurnContext {
	plugin: ObsidianGemini;
	currentSession: ChatSession;
	updatedHistory: any[];
	customPrompt?: CustomPrompt;
}

/**
 * Build the follow-up request sent to the model after tool execution.
 * Includes available tools so the model can chain additional calls.
 */
export function buildFollowUpRequest(params: FollowUpRequestParams): ExtendedModelRequest {
	const {
		plugin,
		currentSession,
		updatedHistory,
		customPrompt,
		projectRootPath,
		projectPermissions,
		perTurnContext,
		projectInstructions,
		projectSkills,
		sessionStartedAt,
	} = params;

	const availableToolsContext: ToolExecutionContext = {
		plugin,
		session: currentSession,
		projectRootPath,
		projectPermissions,
	};
	const availableTools = plugin.toolRegistry.getEnabledTools(availableToolsContext);

	const modelConfig = currentSession?.modelConfig || {};

	return {
		userMessage: '', // Empty since tool results are already in conversation history
		conversationHistory: updatedHistory,
		model: modelConfig.model || plugin.settings.chatModelName,
		temperature: modelConfig.temperature ?? plugin.settings.temperature,
		topP: modelConfig.topP ?? plugin.settings.topP,
		prompt: '', // Unused in agent pipeline — perTurnContext carries context instead
		customPrompt,
		projectInstructions,
		projectSkills,
		perTurnContext,
		sessionStartedAt,
		renderContent: false,
		availableTools, // Include tools so model can chain calls
	};
}

/**
 * Build a simpler retry request when the model returns an empty response.
 * Does not include tools — just asks the model to summarize what it did.
 */
export function buildRetryRequest(params: RetryRequestParams): ExtendedModelRequest {
	const {
		plugin,
		currentSession,
		updatedHistory,
		customPrompt,
		perTurnContext,
		projectInstructions,
		projectSkills,
		sessionStartedAt,
	} = params;
	const modelConfig = currentSession?.modelConfig || {};

	return {
		userMessage: 'Please summarize what you just did with the tools.',
		conversationHistory: updatedHistory,
		model: modelConfig.model || plugin.settings.chatModelName,
		temperature: modelConfig.temperature ?? plugin.settings.temperature,
		topP: modelConfig.topP ?? plugin.settings.topP,
		prompt: '', // Unused in agent pipeline — perTurnContext carries context instead
		customPrompt,
		projectInstructions,
		projectSkills,
		perTurnContext,
		sessionStartedAt,
		renderContent: false,
	};
}

/**
 * Build a fallback message when the model returns empty even after retry.
 * Lists the names of successfully executed tools.
 */
export function buildEmptyResponseMessage(
	toolResults: Array<{ toolName: string; result: { success?: boolean } }>,
	plugin: ObsidianGemini
): string {
	const executedToolNames = toolResults
		.filter((r) => r.result?.success !== false)
		.map((r) => {
			const tool = plugin.toolRegistry.getTool(r.toolName);
			return tool?.displayName || r.toolName;
		})
		.join(', ');

	return executedToolNames
		? `I completed the requested actions (${executedToolNames}) but had trouble generating a summary. The operations were successful.`
		: 'I completed the requested actions but had trouble generating a summary. The operations were successful.';
}
