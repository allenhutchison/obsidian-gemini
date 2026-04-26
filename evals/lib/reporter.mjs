/**
 * Produces a JSON results file and a human-readable stdout summary.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

function percentile(arr, p) {
	if (arr.length === 0) return 0;
	const sorted = [...arr].sort((a, b) => a - b);
	const idx = Math.ceil((p / 100) * sorted.length) - 1;
	return sorted[Math.max(0, idx)];
}

function mean(nums) {
	if (nums.length === 0) return 0;
	return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function round(n, places) {
	const factor = 10 ** places;
	return Math.round(n * factor) / factor;
}

/**
 * Aggregate N per-run scorer results for a single task into a TaskResult
 * with run-level detail preserved alongside cross-run aggregates. `pass_k`
 * / `solve_k` are the τ-bench-style reliability signals (true iff every
 * one of the N runs passed/solved). `flaky` is the in-between case —
 * some but not all runs solved.
 */
export function aggregateTaskRuns(taskId, runs) {
	const n = runs.length;
	const passedCount = runs.filter((r) => r.passed).length;
	const solvedCount = runs.filter((r) => r.solved).length;

	const metricKeys = [
		'turns',
		'tool_calls',
		'prompt_tokens',
		'cached_tokens',
		'cache_ratio',
		'output_tokens',
		'cost_usd',
		'loop_fires',
		'duration_ms',
	];
	const aggMetrics = {};
	for (const key of metricKeys) {
		// cache_ratio is null on providers without a cache (e.g. Ollama). Coercing
		// missing values to 0 here would make per-task rows show 0% instead of "-"
		// and let zero-cache providers pollute the per-task aggregate average.
		if (key === 'cache_ratio') {
			const values = runs.map((r) => r.metrics.cache_ratio).filter((v) => typeof v === 'number');
			aggMetrics.cache_ratio = values.length === 0 ? null : round(mean(values), 3);
			continue;
		}
		const values = runs.map((r) => r.metrics[key] ?? 0);
		aggMetrics[key] = round(mean(values), 6);
	}
	// tool_list is useful for debugging; keep the first run's so the shape
	// matches a single-run TaskResult for any downstream consumer.
	aggMetrics.tool_list = runs[0]?.metrics.tool_list ?? [];

	return {
		id: taskId,
		n_runs: n,
		passed_count: passedCount,
		solved_count: solvedCount,
		pass_k: passedCount === n,
		solve_k: solvedCount === n,
		flaky: solvedCount > 0 && solvedCount < n,
		metrics: aggMetrics,
		runs,
	};
}

/**
 * Compute aggregate metrics across all task results.
 */
export function computeAggregates(taskResults) {
	const total = taskResults.length;
	const empty = {
		total_tasks: 0,
		n_runs: 0,
		total_runs: 0,
		pass_k_rate: 0,
		solve_k_rate: 0,
		mean_pass_rate: 0,
		mean_solve_rate: 0,
		flaky_task_count: 0,
		mean_turns: 0,
		p95_turns: 0,
		mean_cache_ratio: 0,
		mean_cost_usd: 0,
		total_cost_usd: 0,
		total_loop_fires: 0,
	};
	if (total === 0) return empty;

	const nRuns = taskResults[0].n_runs ?? 1;
	const totalRuns = taskResults.reduce((a, t) => a + (t.n_runs ?? 1), 0);

	const passK = taskResults.filter((t) => t.pass_k).length;
	const solveK = taskResults.filter((t) => t.solve_k).length;
	const flakyCount = taskResults.filter((t) => t.flaky).length;

	// Mean rates: proportion of task×run cells that passed/solved.
	const passedCells = taskResults.reduce((a, t) => a + t.passed_count, 0);
	const solvedCells = taskResults.reduce((a, t) => a + t.solved_count, 0);

	// Perf metrics flattened across every task×run for p95 / means.
	const allRuns = taskResults.flatMap((t) => t.runs);
	const turns = allRuns.map((r) => r.metrics.turns);
	const costs = allRuns.map((r) => r.metrics.cost_usd);
	// Cache ratio is null on providers without a cache (e.g. Ollama). Drop those
	// from the mean so we don't average "no cache" with real cache hit rates,
	// and report null when no run had cache data at all.
	const cacheRatios = allRuns.map((r) => r.metrics.cache_ratio).filter((v) => typeof v === 'number');
	const meanCache = cacheRatios.length === 0 ? null : round(mean(cacheRatios), 3);
	const loopFires = allRuns.reduce((a, r) => a + r.metrics.loop_fires, 0);

	return {
		total_tasks: total,
		n_runs: nRuns,
		total_runs: totalRuns,
		pass_k_rate: round((passK / total) * 100, 1),
		solve_k_rate: round((solveK / total) * 100, 1),
		mean_pass_rate: round((passedCells / totalRuns) * 100, 1),
		mean_solve_rate: round((solvedCells / totalRuns) * 100, 1),
		flaky_task_count: flakyCount,
		mean_turns: round(mean(turns), 1),
		p95_turns: percentile(turns, 95),
		mean_cache_ratio: meanCache,
		mean_cost_usd: round(mean(costs), 6),
		total_cost_usd: round(
			costs.reduce((a, b) => a + b, 0),
			6
		),
		total_loop_fires: loopFires,
	};
}

/**
 * Build the full result object.
 */
export function buildResult(taskResults, gitSha, modelName, provider) {
	return {
		run_id: new Date().toISOString(),
		git_sha: gitSha,
		model: modelName,
		provider: provider || 'gemini',
		tasks: taskResults,
		aggregate: computeAggregates(taskResults),
	};
}

/**
 * Write JSON results to evals/results/<timestamp>.json.
 */
export async function writeResults(result, evalsDir) {
	const resultsDir = join(evalsDir, 'results');
	const filename = `${result.run_id.replace(/[:.]/g, '-')}.json`;
	const outPath = join(resultsDir, filename);
	try {
		await mkdir(resultsDir, { recursive: true });
		await writeFile(outPath, JSON.stringify(result, null, 2));
		return outPath;
	} catch (err) {
		throw new Error(`Failed to write eval results for run ${result.run_id} to ${outPath}: ${err.message}`, {
			cause: err,
		});
	}
}

/**
 * Print a human-readable summary to stdout.
 */
export function printSummary(result) {
	const a = result.aggregate;
	console.log('\n=== Eval Run Summary ===');
	console.log(`Git SHA:  ${result.git_sha}`);
	console.log(`Provider: ${result.provider || 'gemini'}`);
	console.log(`Model:    ${result.model}`);
	console.log(`Tasks:    ${a.total_tasks} × ${a.n_runs} run${a.n_runs === 1 ? '' : 's'} = ${a.total_runs} total`);
	console.log('');

	// Per-task table
	console.log('Task                           Pass  Solve  Turns  Cache%  Cost($)  Loops');
	console.log('-'.repeat(80));
	for (const t of result.tasks) {
		const m = t.metrics;
		const n = t.n_runs;
		const passStr = `${t.passed_count}/${n}`.padStart(4);
		let solveStr = `${t.solved_count}/${n}`;
		if (t.flaky) solveStr += ' ⚠';
		else solveStr += '  ';
		const cacheStr = m.cache_ratio === null ? '  -  ' : `${Math.round(m.cache_ratio * 100)}%`;
		console.log(
			`${t.id.padEnd(30)} ${passStr}  ${solveStr.padStart(5)}  ${m.turns.toFixed(1).padStart(5)}  ${cacheStr.padStart(6)}  ${m.cost_usd.toFixed(4).padStart(7)}  ${String(Math.round(m.loop_fires)).padStart(5)}`
		);
	}

	console.log('-'.repeat(80));
	console.log('');
	const k = a.n_runs;
	// Reliable headline numbers: "all N runs of this task met the bar."
	console.log(`pass^${k} rate:     ${a.pass_k_rate}%  (mean ${a.mean_pass_rate}%)`);
	console.log(`solve^${k} rate:    ${a.solve_k_rate}%  (mean ${a.mean_solve_rate}%)`);
	if (a.flaky_task_count > 0) {
		const flakyNames = result.tasks
			.filter((t) => t.flaky)
			.map((t) => t.id)
			.join(', ');
		console.log(`Flaky tasks:    ${a.flaky_task_count} (${flakyNames})`);
	} else {
		console.log(`Flaky tasks:    0`);
	}
	console.log(`Mean turns:     ${a.mean_turns} (p95: ${a.p95_turns})`);
	const meanCacheStr = a.mean_cache_ratio === null ? 'n/a' : `${Math.round(a.mean_cache_ratio * 100)}%`;
	console.log(`Mean cache:     ${meanCacheStr}`);
	console.log(`Mean cost:      $${a.mean_cost_usd.toFixed(4)} per run`);
	console.log(`Total cost:     $${a.total_cost_usd.toFixed(4)} (${a.total_runs} runs)`);
	console.log(`Loop fires:     ${a.total_loop_fires}`);
	console.log('');
}
