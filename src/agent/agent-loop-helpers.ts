import type { ToolCall } from '../api/interfaces/model-api';
import type { ToolResult } from '../tools/types';

/**
 * Pure helpers for the agent tool loop. UI-agnostic and side-effect-free —
 * safe to call from any caller (UI agent view, headless task runner, tests).
 *
 * Extracted from AgentViewTools.handleToolCalls so multiple loop implementations
 * (UI-coupled and headless) can share identical history construction.
 */

/**
 * A tool call paired with its execution result. Carries the original args
 * alongside so emitters that need both (e.g. agent event bus) get a single
 * record instead of having to zip two arrays.
 */
export interface ToolCallResultPair {
	toolName: string;
	toolArguments: Record<string, any>;
	result: ToolResult;
}

/**
 * Tool execution priority. Reads run before writes/deletes so a model that
 * emits "delete A" and "read A" in the same response can't lose data to the
 * race. Lower number = earlier execution. Tools not listed default to 10.
 */
const TOOL_PRIORITY: Record<string, number> = {
	read_file: 1,
	list_files: 2,
	find_files_by_name: 3,
	google_search: 4,
	fetch_url: 5,
	write_file: 6,
	create_folder: 7,
	move_file: 8,
	delete_file: 9,
};

/**
 * Sort tool calls so reads execute before writes/deletes.
 * Stable: equal-priority calls retain their original relative order.
 */
export function sortToolCallsByPriority<T extends { name: string }>(toolCalls: T[]): T[] {
	return [...toolCalls].sort((a, b) => {
		const pa = TOOL_PRIORITY[a.name] ?? 10;
		const pb = TOOL_PRIORITY[b.name] ?? 10;
		return pa - pb;
	});
}

/**
 * Build the model-role `parts` array from a list of tool calls.
 *
 * The output matches the Gemini API's `Content.parts` shape for a model turn
 * containing function calls. `thoughtSignature` (when present) is emitted as
 * a sibling key of `functionCall` — not nested inside it — per Gemini 3 spec.
 * Falsy signatures (undefined, null, '') are omitted entirely so the wire
 * format stays clean.
 *
 * Required by every follow-up request after tool execution. Dropping
 * `thoughtSignature` here causes Gemini thinking models to reject the request
 * with `INVALID_ARGUMENT: Function call is missing a thought_signature`.
 */
export function buildFunctionCallParts(toolCalls: ToolCall[]): any[] {
	return toolCalls.map((tc) => ({
		functionCall: {
			name: tc.name,
			args: tc.arguments || {},
			...(tc.id && { id: tc.id }),
		},
		...(tc.thoughtSignature && { thoughtSignature: tc.thoughtSignature }),
	}));
}

/**
 * Build the user-role `parts` array from a list of tool execution results.
 *
 * For each result, emits a `functionResponse` part. If the result carried
 * `inlineData` (binary file contents read by the agent — images, PDFs,
 * audio, video), the inlineData entries are stripped from the response body
 * and re-injected as sibling parts in the same user turn. This lets the
 * model see the binary content alongside the textual function response.
 */
export function buildFunctionResponseParts(toolResults: ToolCallResultPair[]): any[] {
	return toolResults.flatMap((tr) => {
		const { inlineData, ...resultWithoutInlineData } = tr.result as any;
		const parts: any[] = [
			{
				functionResponse: {
					name: tr.toolName,
					response: resultWithoutInlineData,
				},
			},
		];
		if (inlineData && Array.isArray(inlineData)) {
			for (const attachment of inlineData) {
				parts.push({
					inlineData: { mimeType: attachment.mimeType, data: attachment.base64 },
				});
			}
		}
		return parts;
	});
}

/**
 * Compose the full updated conversation history after a tool execution batch.
 *
 * Layout:
 *   [...conversationHistory, optional userMessage turn, model functionCall turn, user functionResponse turn]
 *
 * The user message (when non-empty) is spliced in *before* the new model
 * turn — at position `conversationHistory.length` — so the chronological
 * order is correct. On follow-up iterations within the same agent turn the
 * user message is empty (already in `conversationHistory`) and no user turn
 * is added.
 *
 * Use this whenever building the history for a follow-up request after the
 * model emits tool calls. Both UI and headless callers must produce the
 * same shape or the API will reject or misinterpret the request.
 */
export function buildToolHistoryTurns(args: {
	conversationHistory: any[];
	userMessage: string;
	toolCalls: ToolCall[];
	toolResults: ToolCallResultPair[];
}): any[] {
	const { conversationHistory, userMessage, toolCalls, toolResults } = args;

	const updated: any[] = [
		...conversationHistory,
		{ role: 'model', parts: buildFunctionCallParts(toolCalls) },
		{ role: 'user', parts: buildFunctionResponseParts(toolResults) },
	];

	if (userMessage && userMessage.trim()) {
		updated.splice(conversationHistory.length, 0, {
			role: 'user',
			parts: [{ text: userMessage }],
		});
	}

	return updated;
}
