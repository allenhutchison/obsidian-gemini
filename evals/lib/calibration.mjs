/**
 * Extract `judge`-matcher calibration tuples from a sweep result for #870.
 *
 * Each tuple is the evidence a human needs to second-guess the automated
 * LLM-as-judge: the task prompt, the judge criterion, the agent's response,
 * and what the automated judge actually said. The human marks YES/NO; the
 * resulting gold set drives judge-accuracy measurement (#871) and judge-
 * model comparisons.
 *
 * The extractor is pure — no FS I/O — so tests can drive it without
 * standing up a sweep. The CLI in `calibrate-extract.mjs` does the file I/O.
 */

/**
 * @typedef {object} CalibrationTuple
 * @property {string} id - Stable identifier: `<task_id>::<run_index>::<matcher_index>`.
 * @property {string} task_id
 * @property {string} user_message - The prompt the agent received.
 * @property {string} criteria - The judge matcher's criterion text.
 * @property {string} response - The agent's final response (frozen per run by #869).
 * @property {boolean} automated_verdict - What the LLM-as-judge said for this run.
 * @property {string|null} judge_error - Non-null when the automated judge didn't really judge (e.g. no key, API error); the response is still labellable but the agreement comparison is not meaningful.
 * @property {("YES"|"NO"|null)} human_label - Filled in during the one-time labelling pass.
 */

/**
 * Build the calibration file content from a result JSON and a task lookup.
 *
 * @param {object} resultJson - Parsed eval result file (top-level: run_id, git_sha, provider, model, tasks, aggregate).
 * @param {Map<string, {userMessage?: string}> | Record<string, {userMessage?: string}>} taskById
 *   Per-task metadata keyed by task id. Used to inject `userMessage` since the
 *   result schema doesn't carry it.
 * @returns {{version: number, generated_at: string, source: object, tuples: CalibrationTuple[]}}
 */
export function extractCalibrationTuples(resultJson, taskById) {
	const getTaskMeta = (id) => {
		if (taskById instanceof Map) return taskById.get(id) || {};
		return (taskById && taskById[id]) || {};
	};

	const tuples = [];
	for (const task of resultJson?.tasks || []) {
		const userMessage = getTaskMeta(task.id).userMessage ?? '';
		let runIndex = 0;
		for (const run of task.runs || []) {
			runIndex++;
			const details = run.solve_details?.matcher_details || [];
			// `matcher_details` preserves the order of `outputMatchers`, so the
			// index here is stable across re-extracts unless the task itself
			// adds/removes matchers — at which point a fresh sweep is needed
			// anyway.
			details.forEach((detail, i) => {
				if (detail?.type !== 'judge') return;
				tuples.push({
					id: `${task.id}::${runIndex}::${i}`,
					task_id: task.id,
					user_message: userMessage,
					criteria: detail.criteria ?? '',
					response: run.response_text ?? '',
					automated_verdict: Boolean(detail.verdict),
					judge_error: typeof detail.error === 'string' ? detail.error : null,
					human_label: null,
				});
			});
		}
	}

	return {
		version: 1,
		generated_at: new Date().toISOString(),
		source: {
			run_id: resultJson?.run_id ?? null,
			git_sha: resultJson?.git_sha ?? null,
			provider: resultJson?.provider ?? null,
			model: resultJson?.model ?? null,
		},
		tuples,
	};
}
