import { describe, it, expect } from 'vitest';
import { aggregateTaskRuns, computeAggregates } from '../../evals/lib/reporter.mjs';

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
		expect(agg.by_difficulty.T1.total_tasks).toBe(1);
		expect(agg.by_difficulty.T1.solve_k_rate).toBe(100);
		expect(agg.by_difficulty.T3.total_tasks).toBe(2);
		expect(agg.by_difficulty.T3.solve_k_count).toBe(1);
		expect(agg.by_difficulty.T3.solve_k_rate).toBe(50);
	});

	it('buckets untagged tasks under "untagged"', () => {
		const agg = computeAggregates([aggregateTaskRuns('legacy', [run(true, true)])]);
		expect(agg.by_difficulty.untagged.total_tasks).toBe(1);
	});

	it('returns an empty breakdown for no tasks', () => {
		expect(computeAggregates([]).by_difficulty).toEqual({});
	});
});
