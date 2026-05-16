/**
 * Output-matcher evaluation for eval task rubrics.
 *
 * Two reasons this lives in its own module:
 *   1. It's the natural integration point for richer rubric grammar (#713).
 *      Today supports `contains`, `regex`, and `judge`; new matchers slot in here.
 *   2. The unit tests can drive it without standing up the full scorer.
 *
 * Grammar:
 *
 *   { type: 'contains', value: 'literal' }                       — substring match
 *   { type: 'contains', value: ['form-A', 'form-B', 'form-C'] }  — any-of substring match
 *   { type: 'regex',    value: 'pattern', flags: 'i' }           — regex match (flags optional)
 *   { type: 'regex',    value: ['p1', 'p2'], flags: 'i' }        — any-of regex match
 *   { type: 'judge',    criteria: 'covers X and Y' }             — LLM-as-judge YES/NO
 *
 * Array forms exist because both `find-tagged-notes` and similar wikilink-style
 * tasks have multiple correct surface forms ("Neural Networks" vs
 * "[[neural-networks]]") and a literal-only matcher penalizes phrasing without
 * penalizing behavior.
 *
 * The `judge` matcher is the escape hatch for prose-heavy tasks where the
 * answer can be expressed many ways (multi-file summaries, "what topics
 * appear in these notes," etc.). It opts the rubric into a separate
 * pinned-model API call — see `judge.mjs` for the contract.
 */

/**
 * Normalize a scalar-or-array matcher value into an array for uniform checks.
 *
 * @param {unknown} value - Matcher value from task JSON.
 * @returns {unknown[]} The original array, or a single-item array for scalars.
 */
function asArray(value) {
	return Array.isArray(value) ? value : [value];
}

/**
 * Evaluate a literal substring matcher against the model response.
 *
 * @param {unknown} value - String or string array accepted by the matcher.
 * @param {string} response - Final model response text.
 * @returns {boolean} True when any candidate string appears in the response.
 */
function evaluateContains(value, response) {
	const candidates = asArray(value).filter((v) => typeof v === 'string');
	if (candidates.length === 0) return false;
	return candidates.some((c) => response.includes(c));
}

/**
 * Evaluate a regex matcher against the model response.
 *
 * Invalid patterns fail closed so malformed task JSON cannot produce a solve.
 *
 * @param {unknown} value - Regex pattern string or array of pattern strings.
 * @param {string | undefined} flags - JavaScript regex flags from task JSON.
 * @param {string} response - Final model response text.
 * @returns {boolean} True when any valid pattern matches the response.
 */
function evaluateRegex(value, flags, response) {
	const patterns = asArray(value).filter((v) => typeof v === 'string');
	if (patterns.length === 0) return false;
	return patterns.some((p) => {
		try {
			return new RegExp(p, flags ?? '').test(response);
		} catch {
			return false;
		}
	});
}

/**
 * Check whether a task rubric contains at least one LLM-as-judge matcher.
 *
 * @param {object} task - Eval task definition.
 * @returns {boolean} True when any output matcher has `type: 'judge'`.
 */
export const taskHasJudgeMatcher = (task) => (task.outputMatchers || []).some((m) => m?.type === 'judge');

/**
 * Evaluate every matcher against `responseText`. All matchers must pass for
 * the rubric to be satisfied — within a single matcher, an array `value` is
 * any-of (logical OR).
 *
 * `judgeFn`, when provided, is called for `judge` matchers with
 * `(criteria, { userMessage, responseText })` and must resolve to a boolean.
 * If a `judge` matcher appears and `judgeFn` is null/undefined, the
 * matcher fails — callers can detect "no judge available" via the returned
 * `judgeAttempted` / `judgeAvailable` flags rather than silently passing.
 *
 * Returns `{ pass, judgeAttempted, judgeAvailable, judgeSkipped }`:
 *   - `pass`: true iff every matcher matched.
 *   - `judgeAttempted`: true iff at least one matcher was a `judge`.
 *   - `judgeAvailable`: true iff a judgeFn was supplied (and could be invoked).
 *   - `judgeSkipped`: true iff a `judge` matcher appeared but no judgeFn was supplied.
 */
export async function evaluateMatchers(matchers, ctx, judgeFn) {
	const list = matchers || [];
	const responseText = typeof ctx?.responseText === 'string' ? ctx.responseText : '';
	const userMessage = typeof ctx?.userMessage === 'string' ? ctx.userMessage : '';

	let pass = true;
	let judgeAttempted = false;
	const judgeAvailable = typeof judgeFn === 'function';

	for (const m of list) {
		if (m.type === 'contains') {
			if (!evaluateContains(m.value, responseText)) pass = false;
			continue;
		}
		if (m.type === 'regex') {
			if (!evaluateRegex(m.value, m.flags, responseText)) pass = false;
			continue;
		}
		if (m.type === 'judge') {
			judgeAttempted = true;
			if (!judgeAvailable) {
				pass = false;
				continue;
			}
			try {
				const verdict = await judgeFn(m.criteria, { userMessage, responseText });
				if (!verdict) pass = false;
			} catch {
				// A judge-call failure (network, API error) must not look like a pass.
				// The harness logs the error; the matcher conservatively fails.
				pass = false;
			}
			continue;
		}
		// Unknown matcher type — conservatively fail rather than silently pass,
		// so a typo in a task file doesn't invent free solves.
		pass = false;
	}

	return { pass, judgeAttempted, judgeAvailable, judgeSkipped: judgeAttempted && !judgeAvailable };
}
