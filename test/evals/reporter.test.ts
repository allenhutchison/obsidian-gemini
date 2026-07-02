import { describe, it, expect } from 'vitest';
import {
	aggregateTaskRuns,
	buildResult,
	computeAggregates,
	formatComparisonMarkdown,
} from '../../evals/lib/reporter.mjs';

function run(passed: boolean, solved: boolean) {
	return {
		passed,
		solved,
		metrics: {
			turns: 2,
			tool_calls: 1,
			prompt_tokens: 100,
			cached_tokens: 0,
			cache_ratio: 0,
			output_tokens: 50,
			cost_usd: 0.001,
			loop_fires: 0,
			duration_ms: 1000,
			tool_list: ['read_file'],
		},
	};
}

describe('aggregateTaskRuns — difficulty / category passthrough', () => {
	it('carries difficulty and category when given a task object', () => {
		const t = aggregateTaskRuns({ id: 'task-a', difficulty: 'T3', category: 'multi-hop' }, [
			run(true, true),
			run(true, true),
		]);
		expect(t.id).toBe('task-a');
		expect(t.difficulty).toBe('T3');
		expect(t.category).toBe('multi-hop');
		expect(t.solve_k).toBe(true);
	});

	it('still accepts a bare task id for legacy callers', () => {
		const t = aggregateTaskRuns('task-b', [run(true, false)]);
		expect(t.id).toBe('task-b');
		expect(t.difficulty).toBeNull();
		expect(t.category).toBeNull();
	});
});

describe('computeAggregates — by_difficulty breakdown', () => {
	it('groups solve^k rate by difficulty tier', () => {
		const taskResults = [
			aggregateTaskRuns({ id: 'a', difficulty: 'T1' }, [run(true, true), run(true, true)]),
			aggregateTaskRuns({ id: 'b', difficulty: 'T3' }, [run(true, true), run(true, true)]),
			aggregateTaskRuns({ id: 'c', difficulty: 'T3' }, [run(true, false), run(true, false)]),
		];
		const agg = computeAggregates(taskResults);
		const byDiff = agg.by_difficulty as any;
		expect(byDiff.T1.total_tasks).toBe(1);
		expect(byDiff.T1.solve_k_rate).toBe(100);
		expect(byDiff.T3.total_tasks).toBe(2);
		expect(byDiff.T3.solve_k_count).toBe(1);
		expect(byDiff.T3.solve_k_rate).toBe(50);
	});

	it('buckets untagged tasks under "untagged"', () => {
		const agg = computeAggregates([aggregateTaskRuns('legacy', [run(true, true)])]);
		expect((agg.by_difficulty as any).untagged.total_tasks).toBe(1);
	});

	it('returns an empty breakdown for no tasks', () => {
		expect(computeAggregates([]).by_difficulty).toEqual({});
	});
});

describe('buildResult — run id', () => {
	it('uses the supplied run id so the result and transcript dir correlate', () => {
		const result = buildResult([], 'abc123', 'gemini-2.5-flash', 'gemini', '2026-05-22T00:00:00.000Z');
		expect(result.run_id).toBe('2026-05-22T00:00:00.000Z');
	});

	it('falls back to the current time when no run id is supplied', () => {
		const result = buildResult([], 'abc123', 'gemini-2.5-flash', 'gemini');
		expect(typeof result.run_id).toBe('string');
		expect(Number.isNaN(Date.parse(result.run_id))).toBe(false);
	});
});

describe('formatComparisonMarkdown — model sweep table', () => {
	function resultFor(model: string, tasks: ReturnType<typeof aggregateTaskRuns>[]) {
		return buildResult(tasks, 'abc123', model, 'ollama', '2026-07-02T00:00:00.000Z');
	}

	it('renders one column per model with per-task solve cells and summary rows', () => {
		const tasksA = [
			aggregateTaskRuns({ id: 'find-tagged' }, [run(true, true), run(true, true)]),
			aggregateTaskRuns({ id: 'summarize' }, [run(true, true), run(true, false)]),
		];
		const md = formatComparisonMarkdown([resultFor('gemma4:latest', tasksA), resultFor('gemma4:26b', tasksA)]);

		// Header carries both model names.
		expect(md).toContain('| Task | gemma4:latest | gemma4:26b |');
		// Per-task solve cells, with the flaky flag on the 1/2 task.
		expect(md).toContain('| find-tagged | 2/2 | 2/2 |');
		expect(md).toContain('| summarize | 1/2 ⚠ | 1/2 ⚠ |');
		// Summary rows use the k from n_runs.
		expect(md).toContain('**solve^2 rate**');
		expect(md).toContain('**pass^2 rate**');
	});

	it('fills a dash for a task missing from one model and unions task ids in order', () => {
		const a = resultFor('model-a', [aggregateTaskRuns({ id: 'shared' }, [run(true, true)])]);
		const b = resultFor('model-b', [
			aggregateTaskRuns({ id: 'shared' }, [run(true, true)]),
			aggregateTaskRuns({ id: 'only-b' }, [run(true, true)]),
		]);
		const md = formatComparisonMarkdown([a, b]);
		expect(md).toContain('| shared | 1/1 | 1/1 |');
		// `only-b` ran only for model-b, so model-a's cell is an em dash.
		expect(md).toContain('| only-b | — | 1/1 |');
	});

	it('reports "free" total cost when spend is zero (local providers)', () => {
		const freeRun = { ...run(true, true), metrics: { ...run(true, true).metrics, cost_usd: 0 } };
		const md = formatComparisonMarkdown([resultFor('gemma4:latest', [aggregateTaskRuns({ id: 't' }, [freeRun])])]);
		expect(md).toContain('**total cost**');
		expect(md).toContain('free');
	});

	it('returns a placeholder for an empty result set', () => {
		expect(formatComparisonMarkdown([])).toContain('No results to compare');
	});
});
