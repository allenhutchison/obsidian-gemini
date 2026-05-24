import { describe, it, expect, vi } from 'vitest';
import { evaluateJudgeAgainstCalibration } from '../../evals/lib/judge-eval.mjs';

// Compact helper for synthetic calibration tuples — only the fields the
// evaluator reads (the file schema has more; null defaults mirror the
// post-#870 file format).
function tuple(opts: {
	id?: string;
	taskId?: string;
	criteria?: string;
	response?: string;
	humanLabel?: 'YES' | 'NO' | null;
	judgeError?: string | null;
}) {
	return {
		id: opts.id ?? 't::1::0',
		task_id: opts.taskId ?? 't',
		user_message: 'um',
		criteria: opts.criteria ?? 'covers X',
		response: opts.response ?? 'response',
		automated_verdict: false,
		judge_error: opts.judgeError ?? null,
		human_label: opts.humanLabel ?? null,
	};
}

function cal(tuples: any[]) {
	return { version: 1, tuples };
}

describe('evaluateJudgeAgainstCalibration — counting basics', () => {
	it('counts agreement, FP, FN; computes accuracy = agreed / evaluated', async () => {
		const judge = vi.fn(async (_c: string, ctx: any) => ctx.responseText === 'good');
		const calibration = cal([
			tuple({ id: 'a', response: 'good', humanLabel: 'YES' }), // judge YES / human YES → agree
			tuple({ id: 'b', response: 'bad', humanLabel: 'NO' }), //  judge NO  / human NO  → agree
			tuple({ id: 'c', response: 'good', humanLabel: 'NO' }), //  judge YES / human NO  → FP
			tuple({ id: 'd', response: 'bad', humanLabel: 'YES' }), //  judge NO  / human YES → FN
		]);
		const r = await evaluateJudgeAgainstCalibration(calibration, judge);
		expect(r.total).toBe(4);
		expect(r.evaluated).toBe(4);
		expect(r.agreed).toBe(2);
		expect(r.disagreed).toBe(2);
		expect(r.false_positives).toBe(1);
		expect(r.false_negatives).toBe(1);
		expect(r.accuracy).toBeCloseTo(0.5, 5);
	});

	it('labels each disagreement with kind and original tuple context', async () => {
		const judge = vi.fn(async () => true); // always YES
		const r = await evaluateJudgeAgainstCalibration(
			cal([
				tuple({ id: 'fp', taskId: 'tx', criteria: 'crit', response: 'r', humanLabel: 'NO' }),
				tuple({ id: 'agree', humanLabel: 'YES' }),
			]),
			judge
		);
		expect(r.disagreements).toHaveLength(1);
		expect(r.disagreements[0]).toMatchObject({
			id: 'fp',
			task_id: 'tx',
			criterion: 'crit',
			response: 'r',
			human_label: 'NO',
			judge_verdict: true,
			kind: 'false_positive',
		});
	});

	it('returns accuracy=0 (not NaN) when nothing is comparable', async () => {
		const judge = vi.fn(async () => true);
		const r = await evaluateJudgeAgainstCalibration(cal([tuple({ humanLabel: null })]), judge);
		expect(r.evaluated).toBe(0);
		expect(r.accuracy).toBe(0);
		expect(judge).not.toHaveBeenCalled();
	});
});

describe('evaluateJudgeAgainstCalibration — skipping behaviour', () => {
	it('skips unlabelled tuples (human_label === null)', async () => {
		const judge = vi.fn(async () => true);
		const r = await evaluateJudgeAgainstCalibration(
			cal([tuple({ humanLabel: 'YES' }), tuple({ humanLabel: null }), tuple({ humanLabel: null })]),
			judge
		);
		expect(r.evaluated).toBe(1);
		expect(r.skipped_unlabelled).toBe(2);
		expect(judge).toHaveBeenCalledTimes(1);
	});

	it('skips tuples whose original automated judge errored (no fair comparison)', async () => {
		const judge = vi.fn(async () => true);
		const r = await evaluateJudgeAgainstCalibration(
			cal([
				tuple({ humanLabel: 'YES' }),
				tuple({ humanLabel: 'YES', judgeError: 'no judge available' }),
				tuple({ humanLabel: 'NO', judgeError: '429 rate limit' }),
			]),
			judge
		);
		expect(r.evaluated).toBe(1);
		expect(r.skipped_judge_error).toBe(2);
		expect(judge).toHaveBeenCalledTimes(1);
	});

	it('treats an empty-string judge_error as no error (defensive)', async () => {
		const judge = vi.fn(async () => true);
		const r = await evaluateJudgeAgainstCalibration(cal([tuple({ humanLabel: 'YES', judgeError: '' as any })]), judge);
		expect(r.evaluated).toBe(1);
		expect(r.skipped_judge_error).toBe(0);
	});
});

describe('evaluateJudgeAgainstCalibration — judge call failures', () => {
	it('counts judge call errors separately and does not let them skew accuracy', async () => {
		let calls = 0;
		const judge = async () => {
			calls++;
			if (calls === 2) throw new Error('429 rate limit');
			return true;
		};
		const r = await evaluateJudgeAgainstCalibration(
			cal([
				tuple({ id: 'a', humanLabel: 'YES' }), // judge YES → agree
				tuple({ id: 'b', humanLabel: 'YES' }), // judge throws → counted as error, NOT a disagreement
				tuple({ id: 'c', humanLabel: 'NO' }), //  judge YES → FP
			]),
			judge
		);
		expect(r.judge_call_errors).toBe(1);
		expect(r.evaluated).toBe(2);
		expect(r.agreed).toBe(1);
		expect(r.disagreed).toBe(1);
		expect(r.accuracy).toBeCloseTo(0.5, 5);
	});

	it('coerces a truthy non-boolean verdict (defensive)', async () => {
		const judge = vi.fn(async () => 1 as any);
		const r = await evaluateJudgeAgainstCalibration(cal([tuple({ humanLabel: 'YES' })]), judge);
		expect(r.agreed).toBe(1);
		expect(r.disagreed).toBe(0);
	});
});

describe('evaluateJudgeAgainstCalibration — edge cases', () => {
	it('handles an empty calibration', async () => {
		const r = await evaluateJudgeAgainstCalibration(
			{ tuples: [] } as any,
			vi.fn(async () => true)
		);
		expect(r.total).toBe(0);
		expect(r.evaluated).toBe(0);
		expect(r.accuracy).toBe(0);
	});

	it('handles a missing tuples array', async () => {
		const r = await evaluateJudgeAgainstCalibration(
			{} as any,
			vi.fn(async () => true)
		);
		expect(r.total).toBe(0);
	});

	it('treats a truthy non-array `tuples` as empty (does not throw on for…of)', async () => {
		// A malformed calibration file could expose `tuples` as a string or an
		// object — both are truthy but not iterable. Without the Array.isArray
		// guard the runtime for…of would throw.
		const judge = vi.fn(async () => true);
		expect((await evaluateJudgeAgainstCalibration({ tuples: 'oops' } as any, judge)).total).toBe(0);
		expect((await evaluateJudgeAgainstCalibration({ tuples: { 0: 'tuple' } } as any, judge)).total).toBe(0);
		expect(judge).not.toHaveBeenCalled();
	});
});
