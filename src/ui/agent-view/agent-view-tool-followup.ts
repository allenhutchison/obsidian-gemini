import type ObsidianGemini from '../../main';
import { ChatSession } from '../../types/agent';
import { ToolExecutionContext } from '../../tools/types';
import { ExtendedModelRequest } from '../../api/interfaces/model-api';
import { CustomPrompt } from '../../prompts/types';

export interface FollowUpRequestParams {
	plugin: ObsidianGemini;
	currentSession: ChatSession;
	updatedHistory: any[];
	customPrompt?: CustomPrompt;
	projectRootPath?: string;
	projectPermissions?: Record<string, import('../../types/tool-policy').ToolPermission>;
}

export interface RetryRequestParams {
	plugin: ObsidianGemini;
	currentSession: ChatSession;
	updatedHistory: any[];
}

/**
 * Build the follow-up request sent to the model after tool execution.
 * Includes available tools so the model can chain additional calls.
 */
export function buildFollowUpRequest(params: FollowUpRequestParams): ExtendedModelRequest {
	const { plugin, currentSession, updatedHistory, customPrompt, projectRootPath, projectPermissions } = params;

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
		prompt: '', // Unused in agent pipeline
		customPrompt, // Pass custom prompt through to follow-up requests
		renderContent: false,
		availableTools, // Include tools so model can chain calls
	};
}

/**
 * Build a simpler retry request when the model returns an empty response.
 * Does not include tools — just asks the model to summarize what it did.
 */
export function buildRetryRequest(params: RetryRequestParams): ExtendedModelRequest {
	const { plugin, currentSession, updatedHistory } = params;
	const modelConfig = currentSession?.modelConfig || {};

	return {
		userMessage: 'Please summarize what you just did with the tools.',
		conversationHistory: updatedHistory,
		model: modelConfig.model || plugin.settings.chatModelName,
		temperature: modelConfig.temperature ?? plugin.settings.temperature,
		topP: modelConfig.topP ?? plugin.settings.topP,
		prompt: '', // Unused in agent pipeline
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
