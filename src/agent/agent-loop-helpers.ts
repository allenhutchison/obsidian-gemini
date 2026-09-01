import type { Content, Part } from '@google/genai';
import type { ToolCall } from '../api/interfaces/model-api';
import { ToolClassification } from '../types/tool-policy';
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
 *
 * `id` is the model-assigned tool-call correlation id (present on Interactions
 * `function_call` steps and OpenAI tool calls; absent on plain generateContent).
 * Carried through so the replayed `functionResponse` part can reference the
 * same id the `functionCall` part emitted — the Interactions API pairs a
 * result to its call by `call_id`, and OpenAI by `tool_call_id` (#1398).
 */
export interface ToolCallResultPair {
	toolName: string;
	toolArguments: Record<string, unknown>;
	result: ToolResult;
	id?: string;
}

/**
 * Execution-priority band for a tool classification. Reads run before
 * external calls, external before writes, writes before deletes — so a model
 * that emits "delete A" and "read A" in the same response can't lose data to
 * the race (#1424). The band is derived from the classification every tool
 * already declares, so a new tool can't silently sort into the wrong band.
 * Lower number = earlier execution.
 */
export function classificationToPriority(c: ToolClassification): number {
	switch (c) {
		case ToolClassification.READ:
			return 10;
		case ToolClassification.EXTERNAL:
			return 20;
		case ToolClassification.WRITE:
			return 30;
		case ToolClassification.DESTRUCTIVE:
			return 40;
	}
}

/**
 * Sort tool calls so reads execute before writes/deletes.
 *
 * Priority comes from each tool's declared classification via `resolve`; the
 * map is injected so this module stays pure and registry-free. Within a band
 * the sort is stable — calls keep the model's emitted order — which is safe:
 * cross-tool ordering inside a band (e.g. a write's parent folder) is handled
 * by the tools themselves, not by sort order. A name the resolver can't
 * resolve falls to the END of the EXTERNAL band (29) — after all known reads,
 * before any known write/destructive — the same conservative fallback the old
 * hand-maintained map used.
 */
export function sortToolCallsByPriority<T extends { name: string }>(
	toolCalls: T[],
	resolve: (name: string) => ToolClassification | undefined
): T[] {
	return [...toolCalls].sort((a, b) => resolvePriority(a.name, resolve) - resolvePriority(b.name, resolve));
}

/** Band for a resolvable name; the EXTERNAL-band fallback (29) otherwise. */
function resolvePriority(name: string, resolve: (name: string) => ToolClassification | undefined): number {
	const classification = resolve(name);
	return classification === undefined ? 29 : classificationToPriority(classification);
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
export function buildFunctionCallParts(toolCalls: ToolCall[]): Part[] {
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
export function buildFunctionResponseParts(toolResults: ToolCallResultPair[]): Part[] {
	return toolResults.flatMap((tr) => {
		const { inlineData, ...resultWithoutInlineData } = tr.result;
		const parts: Part[] = [
			{
				functionResponse: {
					name: tr.toolName,
					response: resultWithoutInlineData,
					// Reference the id the functionCall part emitted, so
					// Interactions `call_id` and OpenAI `tool_call_id` pair the
					// result to its own call rather than by name (#1398).
					...(tr.id && { id: tr.id }),
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
	conversationHistory: Content[];
	userMessage: string;
	perTurnContext?: string;
	toolCalls: ToolCall[];
	toolResults: ToolCallResultPair[];
	/**
	 * Optional text appended to the tool-response (user) turn as a trailing
	 * text part — used by the soft turn budget to inject the budget reminder or
	 * extension grant alongside the tool results, so the model sees it on its
	 * next follow-up without a separate history entry.
	 */
	appendText?: string;
}): Content[] {
	const { conversationHistory, userMessage, perTurnContext, toolCalls, toolResults, appendText } = args;

	const userParts: Part[] = [];
	if (userMessage && userMessage.trim()) {
		userParts.push({ text: userMessage });
	}
	if (perTurnContext && perTurnContext.trim()) {
		userParts.push({ text: perTurnContext });
	}

	const responseParts = buildFunctionResponseParts(toolResults);
	if (appendText && appendText.trim()) {
		responseParts.push({ text: appendText });
	}

	const updated: Content[] = [
		...conversationHistory,
		{ role: 'model', parts: buildFunctionCallParts(toolCalls) },
		{ role: 'user', parts: responseParts },
	];

	if (userParts.length > 0) {
		updated.splice(conversationHistory.length, 0, {
			role: 'user',
			parts: userParts,
		});
	}

	return updated;
}

/**
 * Default per-tool-result size cap before we treat a stored response as
 * bloat worth shedding from history. 4 KB comfortably covers prose answers,
 * structured JSON, and short file fragments; anything larger is usually a
 * `read_file` of source code that the model has already digested and won't
 * need verbatim again.
 */
export const DEFAULT_TOOL_RESPONSE_TRUNCATE_BYTES = 4096;

/**
 * Default number of most-recent tool-result turns to leave intact. Two
 * gives the agent the just-executed turn plus the previous one (so a model
 * that's reasoning across a small batch of recent tool calls still has the
 * full text), while older results — the long tail that drives quadratic
 * input growth (#763) — get shed.
 */
const DEFAULT_TOOL_RESPONSE_KEEP_RECENT = 2;

/**
 * Build the elision marker that replaces a `functionResponse.response`
 * payload when it's truncated. Preserves whatever the original `success`
 * flag was so loop-detection / scoring code that switches on success keeps
 * working, and tells the model to re-call the tool if it actually needs
 * the full content again.
 */
function buildTruncatedResponse(
	originalResponse: Record<string, unknown> | undefined,
	originalBytes: number
): { success: boolean; truncated: true; truncatedFrom: number; note: string } {
	return {
		success: !!(originalResponse?.success ?? false),
		truncated: true,
		truncatedFrom: originalBytes,
		note: `Tool result truncated to save context (${originalBytes} bytes elided). Re-call the tool if you need the full output.`,
	};
}

/**
 * Shed bloat from older tool-result turns in a conversation history.
 *
 * The agent loop appends tool results to history as user-role turns
 * containing `functionResponse` parts; on a long coding session those
 * results (especially `read_file` returning hundreds of KB of source)
 * are replayed on every subsequent send and drive input-token growth
 * roughly quadratically in turns. This pass walks history, identifies
 * tool-result turns, and replaces oversized response payloads in older
 * turns with a small elision marker (preserving `success` and noting
 * the original size).
 *
 * Defaults:
 *   - `maxBytes`: only responses whose JSON exceeds this size get
 *     truncated (4 KB by default). Smaller responses pass through.
 *   - `keepRecent`: the latest N tool-result turns are left intact (2
 *     by default), so an agent reasoning across a small batch of recent
 *     tool calls still has full text.
 *
 * Returns a new array; the input is not mutated. Non-tool-result turns
 * (user messages, model text, etc.) and the actual `functionCall`
 * parts are passed through unchanged.
 *
 * Tracked under #763.
 */
export function truncateOldToolResults(
	history: Content[],
	opts?: { maxBytes?: number; keepRecent?: number }
): Content[] {
	const list = history || [];
	const maxBytes = opts?.maxBytes ?? DEFAULT_TOOL_RESPONSE_TRUNCATE_BYTES;
	const keepRecent = Math.max(0, opts?.keepRecent ?? DEFAULT_TOOL_RESPONSE_KEEP_RECENT);

	const isToolResultTurn = (turn: Content) =>
		turn?.role === 'user' && Array.isArray(turn.parts) && turn.parts.some((p: Part) => p?.functionResponse);

	const toolTurnIndices = list.reduce<number[]>((acc, turn, i) => {
		if (isToolResultTurn(turn)) acc.push(i);
		return acc;
	}, []);
	if (toolTurnIndices.length <= keepRecent) return list;

	const cutoff = toolTurnIndices[toolTurnIndices.length - keepRecent] ?? Infinity;

	return list.map((turn, i) => {
		if (i >= cutoff || !isToolResultTurn(turn)) return turn;
		const newParts = turn.parts!.map((p: Part) => {
			if (!p?.functionResponse?.response) return p;
			const serialized = JSON.stringify(p.functionResponse.response);
			if (serialized.length <= maxBytes) return p;
			return {
				...p,
				functionResponse: {
					...p.functionResponse,
					response: buildTruncatedResponse(p.functionResponse.response, serialized.length),
				},
			};
		});
		return { ...turn, parts: newParts };
	});
}

/**
 * Format the soft-budget reminder injected into the tool-response turn when the
 * agent has only a few turns left. Model-facing (stays English; not localized).
 * Pluralizes "turn"/"turns" so the single-turn case reads naturally.
 */
export function formatBudgetReminder(remaining: number): string {
	const turns = `${remaining} ${remaining === 1 ? 'turn' : 'turns'}`;
	return (
		`ENVIRONMENT REMINDER: You have ${turns} remaining in this task. ` +
		`Wrap up your work and give your final answer before the budget runs out.`
	);
}

/**
 * Format the one-shot extension grant injected when the budget is spent but the
 * agent still wants to call tools. Model-facing (stays English; not localized).
 */
export function formatBudgetExtension(granted: number): string {
	const turns = `${granted} more ${granted === 1 ? 'turn' : 'turns'}`;
	return (
		`ENVIRONMENT REMINDER: You have used your initial turn budget. You are granted ${turns} — ` +
		`wrap up your work now, or explain what you still need to finish.`
	);
}
