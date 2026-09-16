/**
 * Carrying Claude's thinking blocks across a tool round.
 *
 * With thinking on, the assistant turn that requests tools must go back to the
 * API with its `thinking` / `redacted_thinking` blocks unchanged and in their
 * original order, or the follow-up request fails. The agent loop rebuilds that
 * turn from `ToolCall`s as Gemini `functionCall` parts (`buildFunctionCallParts`),
 * and the only per-call field it replays verbatim is `thoughtSignature` — the
 * opaque continuity token Gemini uses for the same purpose. The Anthropic
 * client therefore serializes the turn's thinking blocks into the first tool
 * call's `thoughtSignature`, behind a prefix no Gemini signature can carry, and
 * decodes them when converting history back.
 *
 * `thoughtSignature` lives only in the in-flight tool loop's history — session
 * files don't persist it — so an encoded value never outlives the turn that
 * produced it and never reaches another provider.
 */

import type Anthropic from '@anthropic-ai/sdk';

type ThinkingBlockParam = Anthropic.Beta.BetaThinkingBlockParam | Anthropic.Beta.BetaRedactedThinkingBlockParam;

const PREFIX = 'anthropic-thinking:';

/** Serialize a response's thinking blocks, or `undefined` when it had none. */
export function encodeThinkingBlocks(content: readonly Anthropic.Beta.BetaContentBlock[]): string | undefined {
	const blocks: ThinkingBlockParam[] = [];
	for (const block of content) {
		if (block.type === 'thinking') {
			blocks.push({ type: 'thinking', thinking: block.thinking, signature: block.signature });
		} else if (block.type === 'redacted_thinking') {
			blocks.push({ type: 'redacted_thinking', data: block.data });
		}
	}
	return blocks.length ? PREFIX + JSON.stringify(blocks) : undefined;
}

/**
 * Decode a `thoughtSignature` written by {@link encodeThinkingBlocks}. Any
 * other value — a Gemini signature, a malformed payload — decodes to `[]`:
 * a turn replayed without its thinking fails loudly at the API, which beats
 * sending blocks we can't vouch for.
 */
export function decodeThinkingBlocks(signature: string | undefined): ThinkingBlockParam[] {
	if (!signature?.startsWith(PREFIX)) return [];
	try {
		const parsed: unknown = JSON.parse(signature.slice(PREFIX.length));
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((value: unknown): value is ThinkingBlockParam => {
			if (!value || typeof value !== 'object') return false;
			const b = value as Record<string, unknown>;
			return (
				(b.type === 'thinking' && typeof b.thinking === 'string' && typeof b.signature === 'string') ||
				(b.type === 'redacted_thinking' && typeof b.data === 'string')
			);
		});
	} catch {
		return [];
	}
}
