/**
 * Provider-agnostic pairing of tool-call ids with the tool-results that answer
 * them across a whole conversation history.
 *
 * Gemini pairs `functionCall`/`functionResponse` parts positionally and
 * carries no ids of its own. The OpenAI and Anthropic APIs do carry ids, and
 * both reject the entire request when a tool result references an id no
 * assistant turn declared — so the clients converting Gemini-shaped history
 * have to run the same policy: give every `functionCall` an id the target API
 * will accept, remember which ids were declared, pair each `functionResponse`
 * with the oldest unanswered call of the same tool name, and report "no
 * match" for a response whose call was trimmed away by history compaction.
 * This module owns that policy so it cannot drift between the two clients
 * (it was previously written twice, once per client, and had diverged).
 *
 * What genuinely differs per provider is parameterized: the minted-id shape
 * (`call_<name>_<seq>` vs `toolu_<seq>`) and the validity predicate for an
 * inbound id. What was already decided once, here, for both: an inbound id
 * that fails the predicate is replaced by a minted one, an unmatched response
 * yields `id: null` instead of an undeclared minted id, and calls and
 * responses are resolved interleaved in source-part order (reproducing
 * Gemini's single-loop pairing, so a response preceding its own call within
 * one `Content` still resolves first).
 *
 * The Gemini client is deliberately not a consumer: it speaks `Content`
 * natively and has no pairing step. Ollama decodes history via
 * `history-walk.ts` but emits no ids at all.
 *
 * This is a leaf module — it imports only types from its sibling
 * `history-walk.ts` — so it stays outside the import-cycle graph
 * (`npm run lint:cycles` is at zero and must stay there).
 */

import type { WalkedToolCall, WalkedToolResponse } from './history-walk';

/**
 * Id charset both target APIs accept for tool-call identifiers (Anthropic
 * documents this pattern; OpenAI's ids follow the same shape, and passing an
 * id outside it through to `tool_call_id` risks a 400).
 */
export const SIMPLE_TOOL_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export interface ToolIdLedgerConfig {
	/**
	 * Mints a fresh id for a call whose inbound id is missing or invalid.
	 * `seq` is a per-ledger counter over all minted ids, so callers can embed
	 * it for uniqueness.
	 */
	mint: (name: string, seq: number) => string;
	/** Whether an inbound id may be kept verbatim; anything else is re-minted. */
	isValidId: (id: string) => boolean;
}

/** A tool call with its final, wire-safe id. */
export interface ResolvedToolCall {
	name: string;
	args: Record<string, unknown>;
	id: string;
	thoughtSignature?: string;
}

/** A tool response paired with its call's id — or `null` when orphaned. */
export interface ResolvedToolResponse {
	name: string;
	response: unknown;
	/**
	 * The id of the declared call this response answers, or `null` when no
	 * call matches (its `functionCall` was trimmed away by history
	 * compaction). The caller drops a `null` response — both APIs reject an
	 * unmatched tool result — and logs the drop itself, so the provider-
	 * specific log prefix stays in the client.
	 */
	id: string | null;
}

export class ToolIdLedger {
	private pending = new Map<string, string[]>();
	private declared = new Set<string>();
	private seq = 0;

	constructor(private readonly config: ToolIdLedgerConfig) {}

	/**
	 * Resolve ids for one history entry's tool parts, walking calls and
	 * responses interleaved in source-part order — the order the parts had in
	 * the original Gemini `Content`, so a response that precedes its own call
	 * resolves before the call exactly as a single-loop pairing would.
	 */
	resolveEntry(
		toolCalls: WalkedToolCall[],
		toolResponses: WalkedToolResponse[]
	): { calls: ResolvedToolCall[]; responses: ResolvedToolResponse[] } {
		const parts: ({ kind: 'call'; call: WalkedToolCall } | { kind: 'response'; response: WalkedToolResponse })[] = [
			...toolCalls.map((call) => ({ kind: 'call' as const, call })),
			...toolResponses.map((response) => ({ kind: 'response' as const, response })),
		].sort(
			(a, b) =>
				(a.kind === 'call' ? a.call.partIndex : a.response.partIndex) -
				(b.kind === 'call' ? b.call.partIndex : b.response.partIndex)
		);

		const calls: ResolvedToolCall[] = [];
		const responses: ResolvedToolResponse[] = [];
		for (const part of parts) {
			if (part.kind === 'call') calls.push(this.declare(part.call));
			else responses.push(this.answer(part.response));
		}
		return { calls, responses };
	}

	private declare(call: WalkedToolCall): ResolvedToolCall {
		const id = call.id && this.config.isValidId(call.id) ? call.id : this.config.mint(call.name, this.seq++);
		const queue = this.pending.get(call.name) ?? [];
		queue.push(id);
		this.pending.set(call.name, queue);
		this.declared.add(id);
		return {
			name: call.name,
			args: call.args,
			id,
			...(call.thoughtSignature && { thoughtSignature: call.thoughtSignature }),
		};
	}

	private answer(response: WalkedToolResponse): ResolvedToolResponse {
		const queue = this.pending.get(response.name);
		let id: string | null;
		// A declared id is only usable while it is still in the FIFO — the queue
		// encodes "declared and unanswered". Once answered it is spliced out, so
		// a repeat of the same id falls through to the FIFO fallback instead of
		// answering the same call a second time.
		const index =
			response.id && this.config.isValidId(response.id) && this.declared.has(response.id)
				? (queue?.indexOf(response.id) ?? -1)
				: -1;
		if (index >= 0) {
			queue?.splice(index, 1);
			id = response.id as string;
		} else {
			// No usable own id: pair with the oldest unanswered call of the same
			// tool name, mirroring Gemini's positional pairing — or report no
			// match. A carried-but-undeclared id is treated the same as no id:
			// minting one would produce exactly the unmatched id both APIs reject.
			id = queue?.shift() ?? null;
		}
		return { name: response.name, response: response.response, id };
	}
}
