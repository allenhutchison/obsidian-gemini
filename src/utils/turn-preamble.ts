/**
 * Per-turn time preamble prepended to outgoing user messages so the model
 * has accurate "now" awareness without embedding a volatile timestamp in the
 * (cached) system prompt. The preamble is persisted in history verbatim so
 * replay is bit-identical to what the model originally saw — a prerequisite
 * for Gemini implicit-cache alignment on session resume.
 *
 * The regex requires the literal `[Current date and time: ...]` header
 * followed by the exact `\n\n` separator the sender writes. This keeps
 * benign bracketed text a user might paste from being mistakenly stripped.
 */
const TURN_PREAMBLE_REGEX = /^\[Current date and time: [^\]\n]+\]\n\n/;

export function buildTurnPreamble(timestamp: string): string {
	return `[Current date and time: ${timestamp}]\n\n`;
}

export function stripTurnPreamble(text: string): string {
	return text.replace(TURN_PREAMBLE_REGEX, '');
}
