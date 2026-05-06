import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	compareResults,
	getBaselinePath,
	loadBaseline,
	printRegressionSummary,
	sanitizeModelForFilename,
} from '../../evals/lib/compare.mjs';

function makeResult(overrides: any = {}) {
	return {
		run_id: '2026-05-06T12:00:00.000Z',
		git_sha: 'abc123',
		model: 'gemini-2.5-flash-lite',
		provider: 'gemini',
		tasks: [],
		aggregate: {
			total_tasks: 0,
			n_runs: 3,
			total_runs: 0,
			pass_k_rate: 100,
			solve_k_rate: 100,
			mean_pass_rate: 100,
			mean_solve_rate: 100,
			flaky_task_count: 0,
			mean_turns: 1,
			p95_turns: 1,
			mean_cache_ratio: 0.5,
			mean_cost_usd: 0.01,
			total_cost_usd: 0.03,
			total_loop_fires: 0,
		},
		...overrides,
	};
}

function makeTask(id: string, solvedCount: number, n: number, metrics: any = {}) {
	return {
		id,
		n_runs: n,
		passed_count: solvedCount,
		solved_count: solvedCount,
		pass_k: solvedCount === n,
		solve_k: solvedCount === n,
		flaky: solvedCount > 0 && solvedCount < n,
		metrics: {
			turns: 2,
			tool_calls: 1,
			cache_ratio: 0.5,
			cost_usd: 0.01,
			loop_fires: 0,
			...metrics,
		},
		runs: [],
	};
}

describe('sanitizeModelForFilename', () => {
	it('lowercases and replaces filesystem-unsafe chars', () => {
		expect(sanitizeModelForFilename('Gemini-2.5-Flash-Lite')).toBe('gemini-2.5-flash-lite');
		expect(sanitizeModelForFilename('gemma3:27b')).toBe('gemma3-27b');
		expect(sanitizeModelForFilename('vendor/model')).toBe('vendor-model');
	});

	it('handles missing/empty model id', () => {
		expect(sanitizeModelForFilename(undefined)).toBe('unknown');
		expect(sanitizeModelForFilename(null)).toBe('unknown');
		expect(sanitizeModelForFilename('')).toBe('unknown');
	});
});

describe('getBaselinePath', () => {
	it('joins provider and sanitized model under <evalsDir>/baselines', () => {
		const path = getBaselinePath('/tmp/evals', 'ollama', 'gemma3:27b');
		expect(path).toBe('/tmp/evals/baselines/ollama-gemma3-27b.json');
	});

	it('defaults provider to gemini when missing', () => {
		const path = getBaselinePath('/tmp/evals', undefined as any, 'gemini-2.5-flash');
		expect(path).toBe('/tmp/evals/baselines/gemini-gemini-2.5-flash.json');
	});
});

describe('loadBaseline', () => {
	let tmp: string;
	beforeEach(async () => {
		tmp = await mkdtemp(join(tmpdir(), 'eval-compare-test-'));
		await mkdir(join(tmp, 'baselines'));
	});
	afterEach(async () => {
		await rm(tmp, { recursive: true, force: true });
	});

	it('returns null when the baseline file does not exist', async () => {
		const result = await loadBaseline(tmp, 'gemini', 'gemini-2.5-flash-lite');
		expect(result).toBeNull();
	});

	it('returns parsed content when the baseline file exists', async () => {
		const path = join(tmp, 'baselines', 'gemini-gemini-2.5-flash-lite.json');
		await writeFile(path, JSON.stringify({ run_id: 'x', tasks: [], aggregate: {} }));
		const result = await loadBaseline(tmp, 'gemini', 'gemini-2.5-flash-lite');
		expect(result?.path).toBe(path);
		expect(result?.content.run_id).toBe('x');
	});

	it('throws on malformed baseline rather than treating it as missing', async () => {
		const path = join(tmp, 'baselines', 'gemini-gemini-2.5-flash-lite.json');
		await writeFile(path, 'not json');
		await expect(loadBaseline(tmp, 'gemini', 'gemini-2.5-flash-lite')).rejects.toThrow();
	});
});

describe('compareResults', () => {
	it('flags a solve_k_rate regression on the aggregates', () => {
		const baseline = makeResult({ aggregate: { ...makeResult().aggregate, solve_k_rate: 100 } });
		const current = makeResult({ aggregate: { ...makeResult().aggregate, solve_k_rate: 67 } });
		const cmp = compareResults(baseline, current);
		const solve = cmp.aggregates.find((a) => a.key === 'solve_k_rate')!;
		expect(solve.regressed).toBe(true);
		expect(cmp.regressedAggregates.map((a) => a.key)).toContain('solve_k_rate');
		expect(cmp.hasRegressions).toBe(true);
	});

	it('does not flag aggregate regressions for ancillary metrics', () => {
		// mean_turns going up isn't on the regression-block list.
		const baseline = makeResult({ aggregate: { ...makeResult().aggregate, mean_turns: 3 } });
		const current = makeResult({ aggregate: { ...makeResult().aggregate, mean_turns: 5 } });
		const cmp = compareResults(baseline, current);
		expect(cmp.regressedAggregates).toHaveLength(0);
		expect(cmp.hasRegressions).toBe(false);
	});

	it('flags a per-task solve regression when N stays the same', () => {
		const baseline = makeResult({ tasks: [makeTask('find-tagged', 3, 3)] });
		const current = makeResult({ tasks: [makeTask('find-tagged', 0, 3)] });
		const cmp = compareResults(baseline, current);
		expect(cmp.regressedTasks).toHaveLength(1);
		expect(cmp.regressedTasks[0].id).toBe('find-tagged');
		expect(cmp.regressedTasks[0].solveRegressed).toBe(true);
	});

	it('flags a flakiness onset (3/3 → 2/3) as a regression', () => {
		const baseline = makeResult({ tasks: [makeTask('summary', 3, 3)] });
		const current = makeResult({ tasks: [makeTask('summary', 2, 3)] });
		const cmp = compareResults(baseline, current);
		expect(cmp.regressedTasks).toHaveLength(1);
	});

	it('does not flag an improvement', () => {
		const baseline = makeResult({ tasks: [makeTask('summary', 1, 3)] });
		const current = makeResult({ tasks: [makeTask('summary', 3, 3)] });
		const cmp = compareResults(baseline, current);
		expect(cmp.regressedTasks).toHaveLength(0);
		expect(cmp.hasRegressions).toBe(false);
	});

	it('marks tasks added/removed but does not count them as regressions', () => {
		const baseline = makeResult({ tasks: [makeTask('a', 3, 3)] });
		const current = makeResult({ tasks: [makeTask('b', 3, 3)] });
		const cmp = compareResults(baseline, current);
		expect(cmp.tasks.find((t) => t.id === 'a')?.type).toBe('removed');
		expect(cmp.tasks.find((t) => t.id === 'b')?.type).toBe('new');
		expect(cmp.regressedTasks).toHaveLength(0);
	});

	it('omits cross-provider aggregates as not-applicable when providers differ', () => {
		const baseline = makeResult({ provider: 'gemini' });
		const current = makeResult({ provider: 'ollama' });
		const cmp = compareResults(baseline, current);
		expect(cmp.providersDiffer).toBe(true);
		const cost = cmp.aggregates.find((a) => a.key === 'mean_cost_usd')!;
		expect(cost.applicable).toBe(false);
	});
});

describe('printRegressionSummary', () => {
	let logSpy: ReturnType<typeof vi.spyOn>;
	beforeEach(() => {
		logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
	});
	afterEach(() => {
		logSpy.mockRestore();
	});

	it('reports "no regressions" on a clean comparison', () => {
		const baseline = makeResult({ tasks: [makeTask('a', 3, 3)] });
		const current = makeResult({ tasks: [makeTask('a', 3, 3)] });
		const had = printRegressionSummary(compareResults(baseline, current));
		expect(had).toBe(false);
		const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
		expect(output).toContain('No regressions');
	});

	it('renders the headline with the actual run count (pass^3, not pass^k)', () => {
		const baseline = makeResult({ tasks: [makeTask('a', 3, 3)] });
		const current = makeResult({ tasks: [makeTask('a', 3, 3)] });
		printRegressionSummary(compareResults(baseline, current));
		const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
		expect(output).toContain('pass^3');
		expect(output).toContain('solve^3');
		// Defensive: ensure we don't fall back to literal "k" when run count is known.
		expect(output).not.toMatch(/pass\^k\s/);
		expect(output).not.toMatch(/solve\^k\s/);
	});

	it('lists regressed tasks with their solved-count drop', () => {
		const baseline = makeResult({ tasks: [makeTask('find-tagged', 3, 3), makeTask('summary', 3, 3)] });
		const current = makeResult({ tasks: [makeTask('find-tagged', 0, 3), makeTask('summary', 3, 3)] });
		const had = printRegressionSummary(compareResults(baseline, current));
		expect(had).toBe(true);
		const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
		expect(output).toContain('find-tagged');
		expect(output).toContain('3/3 → 0/3');
		expect(output).not.toContain('summary:');
	});
});
