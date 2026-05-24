/**
 * Measure how often a candidate LLM-as-judge agrees with the human-labelled
 * gold set committed in `evals/calibration/judge-calibration.json` (#870).
 *
 * The judge under test is the same shape as the harness's runtime judge —
 * an async function `(criterion, { userMessage, responseText }) => boolean`.
 * `createJudge()` in `judge.mjs` already returns that shape; this module is
 * provider-agnostic by construction, so a cross-vendor judge (#872) drops in
 * without changes here.
 *
 * Outputs are designed to inform #871's decision: an overall agreement rate,
 * a confusion matrix (FP / FN), and a list of the disagreements with enough
 * context to eyeball *why* the judge flipped.
 */

/**
 * @typedef {object} JudgeEvalResult
 * @property {number} total - All tuples in the calibration file.
 * @property {number} evaluated - Tuples with a non-null `human_label` and no `judge_error` (i.e., comparable).
 * @property {number} skipped_unlabelled - Tuples skipped because `human_label === null`.
 * @property {number} skipped_judge_error - Tuples skipped because the original automated judge errored; their `human_label` may also be null and is not informative against ground truth.
 * @property {number} judge_call_errors - Tuples where this run's judge call threw or rejected.
 * @property {number} agreed - Tuples where this judge agrees with the human label.
 * @property {number} disagreed - Tuples where this judge disagrees with the human label.
 * @property {number} accuracy - `agreed / evaluated`, or 0 when `evaluated === 0`.
 * @property {number} false_positives - Judge said YES, human said NO.
 * @property {number} false_negatives - Judge said NO, human said YES.
 * @property {Array<{id: string, task_id: string, criterion: string, response: string, human_label: string, judge_verdict: boolean, kind: 'false_positive'|'false_negative'}>} disagreements
 */

/**
 * Run `judgeFn` against every comparable tuple in `calibration` and aggregate.
 *
 * "Comparable" = `human_label` is YES or NO and the original `judge_error` is
 * null. Unlabelled tuples are skipped (the gold set may grow over time);
 * tuples whose automated judge errored are skipped from accuracy because
 * there's no automated-vs-human pair to compare under the same evaluator
 * (the failure was an upstream API/auth issue, not a judging decision).
 *
 * Judge call failures are surfaced as a separate count rather than failing
 * the run — a 429 mid-sweep should not poison the agreement rate. The caller
 * decides whether to retry or accept partial coverage.
 *
 * @param {{tuples: Array<object>}} calibration - Parsed `judge-calibration.json`.
 * @param {(criterion: string, ctx: {userMessage: string, responseText: string}) => Promise<boolean>} judgeFn
 * @returns {Promise<JudgeEvalResult>}
 */
export async function evaluateJudgeAgainstCalibration(calibration, judgeFn) {
	const tuples = Array.isArray(calibration?.tuples) ? calibration.tuples : [];
	const result = {
		total: tuples.length,
		evaluated: 0,
		skipped_unlabelled: 0,
		skipped_judge_error: 0,
		judge_call_errors: 0,
		agreed: 0,
		disagreed: 0,
		accuracy: 0,
		false_positives: 0,
		false_negatives: 0,
		disagreements: [],
	};

	for (const t of tuples) {
		if (t.human_label !== 'YES' && t.human_label !== 'NO') {
			result.skipped_unlabelled++;
			continue;
		}
		if (typeof t.judge_error === 'string' && t.judge_error.length > 0) {
			result.skipped_judge_error++;
			continue;
		}

		let verdict;
		try {
			verdict = Boolean(await judgeFn(t.criteria, { userMessage: t.user_message, responseText: t.response }));
		} catch {
			// A judge call failure here is operational (rate limit, network).
			// We surface it via the count but don't let it skew agreement; the
			// reviewer can re-run if needed.
			result.judge_call_errors++;
			continue;
		}

		result.evaluated++;
		const humanYes = t.human_label === 'YES';
		if (verdict === humanYes) {
			result.agreed++;
		} else {
			result.disagreed++;
			const kind = verdict ? 'false_positive' : 'false_negative';
			if (verdict) result.false_positives++;
			else result.false_negatives++;
			result.disagreements.push({
				id: t.id,
				task_id: t.task_id,
				criterion: t.criteria,
				response: t.response,
				human_label: t.human_label,
				judge_verdict: verdict,
				kind,
			});
		}
	}

	result.accuracy = result.evaluated > 0 ? result.agreed / result.evaluated : 0;
	return result;
}
