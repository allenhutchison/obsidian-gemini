/**
 * Carrying `reasoning_details` across a tool round on OpenAI-compatible gateways.
 *
 * OpenRouter (and gateways that copy its shape) return the model's structured
 * reasoning as `reasoning_details` on the assistant message — Claude thinking
 * blocks with their signatures, Gemini thought signatures, OpenAI encrypted
 * reasoning. During tool calling the gateway asks for that array back on the
 * assistant turn that requested the tools, unchanged and in order, or the
 * upstream model loses (or rejects) its reasoning continuity.
 *
 * The agent loop rebuilds that turn from `ToolCall`s as Gemini `functionCall`
 * parts, and the only per-call field it replays verbatim is `thoughtSignature`.
 * So, exactly like `anthropic/thinking-replay.ts`, the client serializes the
 * turn's `reasoning_details` into the first tool call's `thoughtSignature`
 * behind a prefix no Gemini or Anthropic signature can carry, and decodes it
 * when converting history back. `thoughtSignature` lives only in the in-flight
 * tool loop's history (session files don't persist it), so an encoded value
 * never outlives the turn that produced it.
 *
 * Leaf module: no imports, so the clients and tests can depend on it freely.
 */

/** One structured reasoning block as the gateway reports it. Opaque beyond `type`/`index`. */
export interface ReasoningDetail {
	type: string;
	index?: number;
	[key: string]: unknown;
}

const PREFIX = 'oai-reasoning-details:';

/** String fields that arrive as fragments across streaming deltas and must be concatenated. */
const FRAGMENT_FIELDS = ['text', 'summary'] as const;

function isReasoningDetail(value: unknown): value is ReasoningDetail {
	return !!value && typeof value === 'object' && typeof (value as Record<string, unknown>).type === 'string';
}

/** The valid reasoning blocks in a raw `reasoning_details` value (anything else is dropped). */
export function readReasoningDetails(raw: unknown): ReasoningDetail[] {
	return Array.isArray(raw) ? raw.filter(isReasoningDetail) : [];
}

/**
 * Fold one streaming delta's `reasoning_details` into the running list.
 *
 * A block is streamed as several deltas sharing an `index`: text/summary
 * arrive as fragments to concatenate, while fields like `signature` or `id`
 * typically arrive whole on a later delta. Deltas without an `index` (or with
 * a new one) start a new block.
 */
export function mergeReasoningDetails(acc: ReasoningDetail[], incoming: unknown): void {
	for (const detail of readReasoningDetails(incoming)) {
		const existing =
			detail.index !== undefined ? acc.find((d) => d.index === detail.index && d.type === detail.type) : undefined;
		if (!existing) {
			acc.push({ ...detail });
			continue;
		}
		for (const [key, value] of Object.entries(detail)) {
			if (value === undefined || value === null) continue;
			if ((FRAGMENT_FIELDS as readonly string[]).includes(key) && typeof value === 'string') {
				existing[key] = typeof existing[key] === 'string' ? existing[key] + value : value;
			} else {
				existing[key] = value;
			}
		}
	}
}

/** Serialize a turn's reasoning blocks, or `undefined` when it had none. */
export function encodeReasoningDetails(details: readonly ReasoningDetail[]): string | undefined {
	return details.length ? PREFIX + JSON.stringify(details) : undefined;
}

/**
 * Decode a `thoughtSignature` written by {@link encodeReasoningDetails}. Any
 * other value — a Gemini signature, an Anthropic payload, malformed JSON —
 * decodes to `[]`, so a foreign signature is never forwarded to the gateway.
 */
export function decodeReasoningDetails(signature: string | undefined): ReasoningDetail[] {
	if (!signature?.startsWith(PREFIX)) return [];
	try {
		return readReasoningDetails(JSON.parse(signature.slice(PREFIX.length)));
	} catch {
		return [];
	}
}
