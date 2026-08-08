import type { Content } from '@google/genai';
import { getActiveChatModel } from '../../models';
import type { ObsidianGemini } from '../../types/plugin';
import { ChatSession, type PerTurnContext } from '../../types/agent';
import { ToolExecutionContext } from '../../tools/types';
import { ExtendedModelRequest } from '../../api/interfaces/model-api';
import { CustomPrompt } from '../../prompts/types';

// Re-export so existing callers that import PerTurnContext from this module
// keep working — the canonical home is now `src/types/agent.ts` so the
// UI-agnostic `AgentLoop` can depend on the type without reaching into a
// UI module.
export type { PerTurnContext };

export interface FollowUpRequestParams extends PerTurnContext {
	plugin: ObsidianGemini;
	currentSession: ChatSession;
	updatedHistory: Content[];
	customPrompt?: CustomPrompt;
	projectRootPath?: string;
	featureToolPolicy?: import('../../types/tool-policy').FeatureToolPolicy;
	/**
	 * When true, restrict follow-up tools to those auto-approved by the
	 * effective policy. Scheduled-task and hook runners set this so the
	 * model never sees an ASK_USER tool that would auto-approve through
	 * the headless confirmation provider.
	 */
	headless?: boolean;
}

export interface RetryRequestParams extends PerTurnContext {
	plugin: ObsidianGemini;
	currentSession: ChatSession;
	updatedHistory: Content[];
	customPrompt?: CustomPrompt;
}

/**
 * The request fields the follow-up and the empty-response retry share verbatim:
 * everything except `userMessage` and (for the follow-up) `availableTools`.
 * Built in one place so a change to the model/temperature/topP resolution or the
 * project context passthrough can't land on one request shape and miss the other.
 *
 * `perTurnContext` is deliberately omitted from both: `buildToolHistoryTurns`
 * already spliced it into the user turn of `updatedHistory`. Passing it here too
 * would make `buildContents` append it a second time, duplicating the
 * (potentially large) context payload on every tool iteration.
 */
function buildSharedRequestFields(params: RetryRequestParams): Omit<ExtendedModelRequest, 'userMessage'> {
	const { plugin, currentSession, updatedHistory, customPrompt, projectInstructions, projectSkills, sessionStartedAt } =
		params;
	const modelConfig = currentSession?.modelConfig || {};

	return {
		kind: 'extended',
		conversationHistory: updatedHistory,
		model: modelConfig.model || getActiveChatModel(plugin.settings),
		temperature: modelConfig.temperature ?? plugin.settings.temperature,
		topP: modelConfig.topP ?? plugin.settings.topP,
		prompt: '', // Unused in agent pipeline — context lives in conversationHistory
		customPrompt,
		projectInstructions,
		projectSkills,
		sessionStartedAt,
		renderContent: false,
	};
}

/**
 * Build the follow-up request sent to the model after tool execution.
 * Includes available tools so the model can chain additional calls.
 */
export function buildFollowUpRequest(params: FollowUpRequestParams): ExtendedModelRequest {
	const { plugin, currentSession, projectRootPath, featureToolPolicy, headless } = params;

	const availableToolsContext: ToolExecutionContext = {
		plugin,
		session: currentSession,
		projectRootPath,
		featureToolPolicy,
	};
	// Headless callers can't surface a confirmation prompt mid-run, so they
	// must only see APPROVE tools. UI callers see the full enabled set and
	// confirm ASK_USER tools through the in-chat prompt.
	const availableTools = headless
		? plugin.toolRegistry.getAutoApprovedTools(availableToolsContext)
		: plugin.toolRegistry.getEnabledTools(availableToolsContext);

	return {
		...buildSharedRequestFields(params),
		userMessage: '', // Empty since tool results are already in conversation history
		availableTools, // Include tools so model can chain calls
	};
}

/**
 * Build a simpler retry request when the model returns an empty response.
 * Does not include tools — just asks the model to summarize what it did.
 */
export function buildRetryRequest(params: RetryRequestParams): ExtendedModelRequest {
	return {
		...buildSharedRequestFields(params),
		userMessage: 'Please summarize what you just did with the tools.',
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
