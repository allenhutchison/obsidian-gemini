import type { Content, Part } from '@google/genai';
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
 * Tool execution priority. Reads run before writes, writes before deletes —
 * so a model that emits "delete A" and "read A" in the same response can't
 * lose data to the race. Lower number = earlier execution.
 *
 * Grouped by classification (band gaps make it obvious where a new tool slots
 * in by category): READS 1–19, EXTERNAL 20–29, WRITES 30–39, DESTRUCTIVE 40+.
 * Unknown tools fall to the END of the EXTERNAL band (29) — safer than after
 * deletes, since most unknown tools added later will be reads or writes, and
 * if it really is destructive the explicit entry should be added.
 *
 * When adding a new tool, add it here too. Any READ-classified tool MUST sort
 * before write_file (30) to satisfy the reads-before-writes invariant.
 */
const TOOL_PRIORITY: Record<string, number> = {
	// ── READS (1–19) ────────────────────────────────────────────────────────
	read_file: 1,
	list_files: 2,
	find_files_by_name: 3,
	find_files_by_content: 4,
	get_workspace_state: 5,
	read_memory: 6,
	recall_sessions: 7,
	vault_semantic_search: 8,
	activate_skill: 9,
	// ── EXTERNAL (20–29) ────────────────────────────────────────────────────
	google_search: 20,
	fetch_url: 21,
	deep_research: 22,
	// ── WRITES (30–39) ──────────────────────────────────────────────────────
	write_file: 30,
	create_folder: 31,
	update_frontmatter: 32,
	append_content: 33,
	update_memory: 34,
	create_skill: 35,
	edit_skill: 36,
	generate_image: 37,
	// ── DESTRUCTIVE (40+) ───────────────────────────────────────────────────
	move_file: 40,
	delete_file: 41,
};

/**
 * Default priority for tools not in TOOL_PRIORITY — bottom of the EXTERNAL
 * band so unknowns run after all known reads but before any known writes or
 * destructive operations. Conservative choice: if a future tool is added but
 * its priority entry is forgotten, it still won't race destructive ops.
 */
const UNKNOWN_TOOL_PRIORITY = 29;

/**
 * Sort tool calls so reads execute before writes/deletes.
 * Stable: equal-priority calls retain their original relative order.
 */
export function sortToolCallsByPriority<T extends { name: string }>(toolCalls: T[]): T[] {
	return [...toolCalls].sort((a, b) => {
		const pa = TOOL_PRIORITY[a.name] ?? UNKNOWN_TOOL_PRIORITY;
		const pb = TOOL_PRIORITY[b.name] ?? UNKNOWN_TOOL_PRIORITY;
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
	toolCalls: ToolCall[];
	toolResults: ToolCallResultPair[];
}): Content[] {
	const { conversationHistory, userMessage, toolCalls, toolResults } = args;

	const updated: Content[] = [
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
