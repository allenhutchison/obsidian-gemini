/**
 * Provider-agnostic decoding of a single conversation-history entry.
 *
 * Both the Ollama and OpenAI clients receive history in the same two shapes —
 * a Gemini `Content` (`{ role, parts: Part[] }`) or the plugin's legacy
 * internal `{ role, text | message }` entry — and both have to answer the same
 * questions about it before they can emit anything: which role is this, what
 * text did it carry, which attachments, which tool calls, which tool
 * responses. Only the *emission* is provider-specific (Ollama wants
 * `images: string[]` and `tool_name`; OpenAI wants `ImageContentPart[]`,
 * `tool_call_id`, and a call-id ledger). This module owns everything before
 * emission so the shared half cannot drift between the two clients.
 *
 * The Gemini client is deliberately not a consumer: it speaks `Content`
 * natively and has no equivalent conversion step.
 *
 * This is a leaf module — it imports types and one pure helper, never a
 * client — so it stays outside the import-cycle graph (`npm run lint:cycles`
 * is at zero and must stay there).
 */

import type { InlineDataPart } from '../interfaces/model-api';
import { getLegacyEntryText } from '../../utils/history-normalize';

/** A `functionCall` part, decoded but not yet given a provider-specific id. */
export interface WalkedToolCall {
	name: string;
	args: Record<string, unknown>;
	/**
	 * The part's own `id` verbatim, or `undefined` when it carried none. The
	 * walker never mints one: id synthesis is stateful across the whole
	 * history and belongs to the provider that needs ids (OpenAI).
	 */
	id?: string;
	/** Index of the source part within the entry's `parts` array. */
	partIndex: number;
}

/** A `functionResponse` part, decoded but not yet paired with a call id. */
export interface WalkedToolResponse {
	name: string;
	response: unknown;
	/** The part's own `id` verbatim, or `undefined` — see {@link WalkedToolCall.id}. */
	id?: string;
	/** Index of the source part within the entry's `parts` array. */
	partIndex: number;
}

/** One history entry decoded into provider-agnostic pieces. */
export interface WalkedEntry {
	role: 'user' | 'assistant' | 'system';
	/**
	 * The entry's text parts joined by the role's separator and trimmed —
	 * `'\n'` for an assistant turn (contiguous model output), `'\n\n'`
	 * otherwise (separate user/system blocks). Empty when every text part was
	 * blank, which is why {@link hasText} exists separately.
	 */
	text: string;
	/**
	 * Whether the entry carried *any* text part, even a blank one. Both
	 * clients gate emission on the presence of a text part rather than on
	 * non-empty text, so an entry whose only part is `{ text: '' }` still
	 * emits a message with empty content.
	 */
	hasText: boolean;
	images: InlineDataPart[];
	toolCalls: WalkedToolCall[];
	toolResponses: WalkedToolResponse[];
}

/**
 * Decode one history entry into its provider-agnostic pieces.
 *
 * Returns `null` when the entry decodes to nothing at all: it isn't an object,
 * it has no `role`, its legacy text is missing or blank, or it is a `Content`
 * whose parts yielded no text, images, calls or responses. A non-`null` result
 * is not a promise that the caller will emit something — a provider still
 * drops, say, an assistant turn carrying only images.
 *
 * @param providerName Display name used in the unsupported-attachment error
 *   ("Ollama", "OpenAI"), so the two clients cannot drift that sentence apart.
 * @throws When a part carries a non-image `inlineData` attachment, which
 *   neither provider can represent.
 */
export function walkHistoryEntry(entry: unknown, providerName: string): WalkedEntry | null {
	if (!entry || typeof entry !== 'object') return null;
	const record = entry as Record<string, unknown>;

	// Gemini Content shape: { role: 'user'|'model', parts: Part[] }
	if ('role' in record && Array.isArray(record.parts)) {
		const role = record.role === 'model' ? 'assistant' : record.role === 'system' ? 'system' : 'user';
		const textChunks: string[] = [];
		const images: InlineDataPart[] = [];
		const toolCalls: WalkedToolCall[] = [];
		const toolResponses: WalkedToolResponse[] = [];

		for (let partIndex = 0; partIndex < record.parts.length; partIndex++) {
			const part = record.parts[partIndex] as {
				text?: unknown;
				inlineData?: { mimeType?: string; data?: string };
				functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
				functionResponse?: { name: string; response?: unknown; id?: string };
			};
			if (typeof part?.text === 'string') {
				textChunks.push(part.text);
			} else if (part?.inlineData?.mimeType?.startsWith('image/') && part.inlineData.data) {
				images.push({ mimeType: part.inlineData.mimeType, base64: part.inlineData.data });
			} else if (part?.inlineData?.mimeType) {
				// Mirror buildChatRequest's current-turn handling so resumed sessions
				// don't silently drop PDF/audio/video context the model never sees.
				throw new Error(
					`${providerName} only supports image attachments; conversation history contains ${part.inlineData.mimeType}. ` +
						`Switch to the Gemini provider for PDF, audio, or video input.`
				);
			} else if (part?.functionCall) {
				toolCalls.push({
					name: part.functionCall.name,
					args: part.functionCall.args || {},
					id: part.functionCall.id,
					partIndex,
				});
			} else if (part?.functionResponse) {
				toolResponses.push({
					name: part.functionResponse.name,
					response: part.functionResponse.response,
					id: part.functionResponse.id,
					partIndex,
				});
			}
		}

		if (!textChunks.length && !images.length && !toolCalls.length && !toolResponses.length) return null;

		return {
			role,
			text: textChunks.join(role === 'assistant' ? '\n' : '\n\n').trim(),
			hasText: textChunks.length > 0,
			images,
			toolCalls,
			toolResponses,
		};
	}

	// Internal shape: { role, text } or { role, message }
	if ('role' in record) {
		const text = getLegacyEntryText(record);
		if (typeof text !== 'string' || !text.trim()) return null;
		const role = record.role === 'model' || record.role === 'assistant' ? 'assistant' : 'user';
		// Deliberately un-trimmed: the legacy tail has always emitted the stored
		// text verbatim, and only the blank check above trims.
		return { role, text, hasText: true, images: [], toolCalls: [], toolResponses: [] };
	}

	return null;
}
