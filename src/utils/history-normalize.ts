import type { Content } from '@google/genai';

/**
 * Legacy read-side decode helpers for stored conversation-history entries.
 *
 * A stored entry may predate the canonical `{ role, parts }` `Content` shape and
 * instead carry its text in a top-level `text` or `message` field. Historically
 * this backward-compat rule was re-implemented from scratch at five call sites
 * across three modules (the Gemini/Ollama API clients and the context manager),
 * each casting to an ad-hoc `Content & { text?; message? }` shape. This leaf
 * module owns that shape and the decode precedence in one place so the sites stay
 * consistent. It never imports back into `api/` or `services/`.
 *
 * Two precedence variants exist because the historical sites did not agree:
 * - {@link getLegacyEntryText} uses **nullish** precedence (`text ?? message`) —
 *   the API-replay paths treat an explicit empty-string `text` as intentional.
 * - {@link getLegacyEntryTextTruthy} uses **truthiness** precedence
 *   (`text || message`) — the context-manager sites fall back to `message` when
 *   `text` is an empty string.
 * The two differ only when `text === ''`; the split is preserved deliberately.
 */

/** Minimal structural shape a raw `Record<string, unknown>` entry satisfies. */
export interface LegacyTextCarrier {
	text?: unknown;
	message?: unknown;
}

/** A history entry as seen by the decode helpers: canonical `Content` or a legacy carrier. */
type LegacyEntry = Content | LegacyTextCarrier;

function readLegacyFields(entry: LegacyEntry): LegacyTextCarrier {
	return entry as LegacyTextCarrier;
}

/**
 * Extract the text of a legacy history entry using **nullish** precedence
 * (`text ?? message`): an explicit empty-string `text` is returned as-is and does
 * NOT fall back to `message`. Use on the API-replay paths (Gemini/Ollama). Returns
 * `undefined` when neither field carries a string.
 */
export function getLegacyEntryText(entry: LegacyEntry): string | undefined {
	const { text, message } = readLegacyFields(entry);
	const value = text ?? message;
	return typeof value === 'string' ? value : undefined;
}

/**
 * Extract the text of a legacy history entry using **truthiness** precedence
 * (`text || message`): an empty-string `text` falls back to `message`. Use where
 * the historical behavior branched on truthiness (context-manager sanitize /
 * summarize / boundary-scan). Differs from {@link getLegacyEntryText} only when
 * `text === ''`. Returns `undefined` when neither field carries a non-empty string.
 */
export function getLegacyEntryTextTruthy(entry: LegacyEntry): string | undefined {
	const { text, message } = readLegacyFields(entry);
	const value = text || message;
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Normalize a stored history entry to a `Content`, tolerating the two legacy
 * shapes (`{ role, text }`, `{ role, message }`) alongside canonical
 * `{ role, parts }`. Role coercion is provider-specific, so the caller supplies
 * it (e.g. Gemini's user/model coercion). Returns `null` for unrecognized entries.
 */
export function normalizeToContent(
	entry: Content,
	coerceRole: (role: string | undefined) => 'user' | 'model'
): Content | null {
	// Require `parts` to actually be an array before treating the entry as
	// canonical — a malformed `{ parts: null }` entry must fall through to the
	// legacy branch (so a co-present `text`/`message` is still recovered) rather
	// than pass through, matching the sibling guard in `context-manager.ts`.
	if ('role' in entry && Array.isArray((entry as { parts?: unknown }).parts)) {
		return entry;
	}
	if ('role' in entry && ('text' in entry || 'message' in entry)) {
		const role = (entry as { role?: string }).role;
		return { role: coerceRole(role), parts: [{ text: getLegacyEntryText(entry) ?? '' }] };
	}
	return null;
}
