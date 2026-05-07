/**
 * Mid-task progress reporting helpers.
 *
 * `summarizeProgress` is the pure piece — turns a captured-events array
 * plus per-turn timing into a stable shape that's easy to test. The runner
 * calls it from a polling loop while `sendMessage` is in flight, so the
 * operator gets a visible "the eval is alive" signal during slow models
 * (the original motivation for this work was a 31b Ollama model that
 * looked indistinguishable from a hang for many minutes).
 *
 * Numbers are presented as integer seconds. ETA is omitted when we can't
 * compute it (no completed turns yet, or no `maxTurns` budget on the task)
 * — better silent than wrong.
 */

/**
 * Parse the per-turn state out of a captured-events array.
 *
 * @param {object[]} events - Captured collector events
 * @param {number} startTimeMs - Wall-clock start of the task
 * @param {number} nowMs - Current wall-clock time
 * @param {number} [maxTurns] - Optional turn budget for ETA
 * @returns {{ turn: number, toolCalls: number, elapsedSec: number, avgTurnSec: number|null, etaSec: number|null }}
 */
export function summarizeProgress(events, startTimeMs, nowMs, maxTurns) {
	const list = events || [];
	const turns = list.filter((e) => e?.event === 'apiResponseReceived').length;
	const toolCalls = list.filter((e) => e?.event === 'toolExecutionComplete').length;
	const elapsedMs = Math.max(0, nowMs - startTimeMs);

	const avgTurnMs = turns > 0 ? elapsedMs / turns : null;
	let etaSec = null;
	if (typeof maxTurns === 'number' && maxTurns > 0 && avgTurnMs !== null && turns > 0 && turns < maxTurns) {
		etaSec = Math.round(((maxTurns - turns) * avgTurnMs) / 1000);
	}

	return {
		turn: turns,
		toolCalls,
		elapsedSec: Math.round(elapsedMs / 1000),
		avgTurnSec: avgTurnMs === null ? null : Math.round(avgTurnMs / 1000),
		etaSec,
	};
}

/**
 * Format a progress summary as a human-readable line. Returned as a string
 * so the caller can decide whether to print it (e.g. only on change).
 */
export function formatProgressLine(summary) {
	const parts = [`turn ${summary.turn}`, `${summary.toolCalls} tool calls`, `${summary.elapsedSec}s elapsed`];
	if (summary.etaSec !== null) parts.push(`ETA ${summary.etaSec}s`);
	return `  [${parts.join(' | ')}]`;
}

/**
 * Decide whether a new progress summary represents enough change vs the
 * previously-printed one to warrant re-printing. Reduces noise during
 * "tool burst" periods where elapsed seconds tick up but turn / tool
 * counts haven't moved.
 */
export function progressChanged(prev, next) {
	if (!prev) return next.turn > 0 || next.toolCalls > 0;
	return prev.turn !== next.turn || prev.toolCalls !== next.toolCalls;
}
