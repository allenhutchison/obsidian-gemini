import { describe, it, expect } from 'vitest';
import { extractCalibrationTuples } from '../../evals/lib/calibration.mjs';

// Compact helpers for building synthetic result fixtures. The extractor walks
// `tasks[i].runs[j].solve_details.matcher_details` (post-#869 schema), so each
// test wires up just enough of that nesting to exercise one behavior.

function judgeDetail(criteria: string, verdict: boolean, error?: string) {
	const d: any = { type: 'judge', criteria, verdict };
	if (error !== undefined) d.error = error;
	return d;
}

function containsDetail(value: string, verdict: boolean) {
	return { type: 'contains', value, verdict };
}

function run(opts: { response: string; details: any[] }) {
	return {
		response_text: opts.response,
		solve_details: { matcher_details: opts.details },
	};
}

function result(opts: { tasks: any[]; run_id?: string; git_sha?: string; provider?: string; model?: string }) {
	return {
		run_id: opts.run_id ?? '2026-05-22T00:00:00.000Z',
		git_sha: opts.git_sha ?? 'abc123',
		provider: opts.provider ?? 'gemini',
		model: opts.model ?? 'gemini-3.1-flash-lite',
		tasks: opts.tasks,
	};
}

describe('extractCalibrationTuples — basic shape', () => {
	it('emits one tuple per judge matcher per run, attaching user_message from the task lookup', () => {
		const r = result({
			tasks: [{ id: 't1', runs: [run({ response: 'hello', details: [judgeDetail('covers X', true)] })] }],
		});
		const out = extractCalibrationTuples(r, { t1: { userMessage: 'do the thing' } });
		expect(out.tuples).toHaveLength(1);
		expect(out.tuples[0]).toEqual({
			id: 't1::1::0',
			task_id: 't1',
			user_message: 'do the thing',
			criteria: 'covers X',
			response: 'hello',
			automated_verdict: true,
			judge_error: null,
			human_label: null,
		});
	});

	it('records source provenance and a default null judge_error', () => {
		const r = result({
			tasks: [{ id: 't1', runs: [run({ response: 'x', details: [judgeDetail('c', false)] })] }],
			run_id: '2026-05-22T01:02:03.456Z',
			git_sha: 'deadbeef',
			provider: 'ollama',
			model: 'gemma4:latest',
		});
		const out = extractCalibrationTuples(r, {});
		expect(out.source).toEqual({
			run_id: '2026-05-22T01:02:03.456Z',
			git_sha: 'deadbeef',
			provider: 'ollama',
			model: 'gemma4:latest',
		});
		expect(out.version).toBe(1);
		expect(out.tuples[0].judge_error).toBeNull();
	});
});

describe('extractCalibrationTuples — filtering and indexing', () => {
	it('only emits tuples for judge matchers (skips contains/regex/etc.)', () => {
		const r = result({
			tasks: [
				{
					id: 't1',
					runs: [
						run({
							response: 'r',
							details: [containsDetail('foo', true), judgeDetail('covers X', true), containsDetail('bar', false)],
						}),
					],
				},
			],
		});
		const out = extractCalibrationTuples(r, { t1: { userMessage: 'u' } });
		expect(out.tuples).toHaveLength(1);
		expect(out.tuples[0].id).toBe('t1::1::1');
		expect(out.tuples[0].criteria).toBe('covers X');
	});

	it('preserves the original matcher index even when interleaved with non-judge matchers', () => {
		const r = result({
			tasks: [
				{
					id: 't1',
					runs: [
						run({
							response: 'r',
							details: [
								containsDetail('a', true),
								judgeDetail('c1', true),
								containsDetail('b', true),
								judgeDetail('c2', false),
							],
						}),
					],
				},
			],
		});
		const out = extractCalibrationTuples(r, {});
		expect(out.tuples.map((t) => t.id)).toEqual(['t1::1::1', 't1::1::3']);
	});

	it('uses 1-based run indices and emits a tuple per repeated run', () => {
		const r = result({
			tasks: [
				{
					id: 't1',
					runs: [
						run({ response: 'r1', details: [judgeDetail('c', true)] }),
						run({ response: 'r2', details: [judgeDetail('c', false)] }),
						run({ response: 'r3', details: [judgeDetail('c', true)] }),
					],
				},
			],
		});
		const out = extractCalibrationTuples(r, {});
		expect(out.tuples.map((t) => [t.id, t.response, t.automated_verdict])).toEqual([
			['t1::1::0', 'r1', true],
			['t1::2::0', 'r2', false],
			['t1::3::0', 'r3', true],
		]);
	});
});

describe('extractCalibrationTuples — error & edge cases', () => {
	it('surfaces the judge_error string when the automated judge failed (so humans can still label but downstream eval can flag it)', () => {
		const r = result({
			tasks: [{ id: 't1', runs: [run({ response: 'r', details: [judgeDetail('c', false, 'no judge available')] })] }],
		});
		const out = extractCalibrationTuples(r, {});
		expect(out.tuples[0].judge_error).toBe('no judge available');
		expect(out.tuples[0].automated_verdict).toBe(false);
		expect(out.tuples[0].human_label).toBeNull();
	});

	it('emits no tuples when matcher_details is empty (failed/timed-out runs short-circuited matching)', () => {
		const r = result({ tasks: [{ id: 't1', runs: [{ response_text: '', solve_details: { matcher_details: [] } }] }] });
		expect(extractCalibrationTuples(r, {}).tuples).toEqual([]);
	});

	it('emits no tuples when no task has judge matchers', () => {
		const r = result({
			tasks: [{ id: 't1', runs: [run({ response: 'r', details: [containsDetail('foo', true)] })] }],
		});
		expect(extractCalibrationTuples(r, {}).tuples).toEqual([]);
	});

	it('accepts a Map as the task lookup', () => {
		const lookup = new Map([['t1', { userMessage: 'mapped' }]]);
		const r = result({
			tasks: [{ id: 't1', runs: [run({ response: 'r', details: [judgeDetail('c', true)] })] }],
		});
		const out = extractCalibrationTuples(r, lookup);
		expect(out.tuples[0].user_message).toBe('mapped');
	});

	it('falls back to empty user_message when the task lookup has no entry', () => {
		const r = result({
			tasks: [{ id: 'unknown', runs: [run({ response: 'r', details: [judgeDetail('c', true)] })] }],
		});
		const out = extractCalibrationTuples(r, {});
		expect(out.tuples[0].user_message).toBe('');
	});

	it('coerces non-boolean detail.verdict to a boolean automated_verdict', () => {
		// Defensive: a malformed detail (truthy/falsy non-boolean) should still
		// produce a clean boolean in the calibration file.
		const r = result({
			tasks: [
				{
					id: 't1',
					runs: [
						run({
							response: 'r',
							details: [{ type: 'judge', criteria: 'c', verdict: 1 as any }],
						}),
					],
				},
			],
		});
		const out = extractCalibrationTuples(r, {});
		expect(out.tuples[0].automated_verdict).toBe(true);
	});

	it('handles a missing tasks array gracefully', () => {
		expect(extractCalibrationTuples({} as any, {}).tuples).toEqual([]);
	});
});
