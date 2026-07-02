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
 *
 * `taskOrId` accepts either a bare task id (legacy / unit-test callers) or
 * the full task object — when given the object, `difficulty` and `category`
 * are carried onto the TaskResult so the reporter can break solve rate down
 * by difficulty tier (the view that exposes model separation).
 */
export function aggregateTaskRuns(taskOrId, runs) {
	const task = typeof taskOrId === 'string' ? { id: taskOrId } : taskOrId || {};
	const taskId = task.id;
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
	// `tool_list` is intentionally not lifted to the aggregate. Aggregating a
	// scalar like `tool_calls` as the mean across runs is meaningful, but a
	// tool *sequence* can't be averaged — and using `runs[0]`'s sequence
	// produced a confusing shape mismatch when runs had different lengths
	// (e.g., aggregate `tool_calls=5` next to a 6-element `tool_list` from
	// run 0). Per-run tool_list arrays remain available on `runs[i].metrics`.

	return {
		id: taskId,
		difficulty: task.difficulty ?? null,
		category: task.category ?? null,
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
		by_difficulty: {},
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

	// Break solve^k down by difficulty tier — the view that shows whether the
	// suite actually separates model classes (a tier where every model solves
	// or no model solves is miscalibrated and worth revising).
	const byDifficulty = {};
	for (const t of taskResults) {
		const tier = t.difficulty || 'untagged';
		const bucket = (byDifficulty[tier] ||= { total_tasks: 0, solve_k_count: 0, solved_cells: 0, run_cells: 0 });
		bucket.total_tasks += 1;
		if (t.solve_k) bucket.solve_k_count += 1;
		bucket.solved_cells += t.solved_count;
		bucket.run_cells += t.n_runs ?? 1;
	}
	for (const bucket of Object.values(byDifficulty)) {
		bucket.solve_k_rate = round((bucket.solve_k_count / bucket.total_tasks) * 100, 1);
		bucket.mean_solve_rate = bucket.run_cells === 0 ? 0 : round((bucket.solved_cells / bucket.run_cells) * 100, 1);
	}

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
		by_difficulty: byDifficulty,
	};
}

/**
 * Build the full result object.
 *
 * `runId` is supplied by the runner so the result file and the transcript
 * directory share one identifier; it falls back to the current time for
 * standalone callers (e.g. unit tests).
 */
export function buildResult(taskResults, gitSha, modelName, provider, runId) {
	return {
		run_id: runId || new Date().toISOString(),
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
 * Render a side-by-side markdown comparison of several per-model eval results
 * (the `--models=A,B,C` sweep). One column per model; each task contributes a
 * `solved/n` row, followed by bold summary rows (solve^k rate, mean solve
 * rate, pass^k rate, mean turns, total cost). Pure — returns the markdown
 * string so the runner can both print it and write it to disk.
 *
 * @param {Array<object>} results - buildResult() objects, one per model, in sweep order.
 * @returns {string} Markdown document (trailing newline included).
 */
export function formatComparisonMarkdown(results) {
	if (!Array.isArray(results) || results.length === 0) return '_No results to compare._\n';

	const models = results.map((r) => r.model || 'unknown');
	const k = results[0].aggregate?.n_runs ?? 1;

	// Union of task ids across all results, preserving first-seen order so the
	// table row order is stable even if a later model ran a different subset.
	const taskIds = [];
	const seen = new Set();
	for (const r of results) {
		for (const t of r.tasks) {
			if (!seen.has(t.id)) {
				seen.add(t.id);
				taskIds.push(t.id);
			}
		}
	}

	const header = ['Task', ...models];
	const lines = [];
	lines.push('# Eval model comparison');
	lines.push('');
	lines.push(`Provider: ${results[0].provider || 'gemini'} · ${k} run${k === 1 ? '' : 's'} per task`);
	lines.push('');
	lines.push(`| ${header.join(' | ')} |`);
	lines.push(`| ${header.map(() => '---').join(' | ')} |`);

	// Per-task solve^k cell (solved_count/n_runs), flagged when flaky.
	for (const id of taskIds) {
		const row = [id];
		for (const r of results) {
			const t = r.tasks.find((x) => x.id === id);
			if (!t) {
				row.push('—');
				continue;
			}
			row.push(`${t.solved_count}/${t.n_runs}${t.flaky ? ' ⚠' : ''}`);
		}
		lines.push(`| ${row.join(' | ')} |`);
	}

	const summaryRow = (label, fn) => `| **${label}** | ${results.map((r) => fn(r.aggregate || {})).join(' | ')} |`;
	lines.push(summaryRow(`solve^${k} rate`, (a) => `${a.solve_k_rate ?? 0}%`));
	lines.push(summaryRow('mean solve rate', (a) => `${a.mean_solve_rate ?? 0}%`));
	lines.push(summaryRow(`pass^${k} rate`, (a) => `${a.pass_k_rate ?? 0}%`));
	lines.push(summaryRow('mean turns', (a) => `${a.mean_turns ?? 0}`));
	lines.push(summaryRow('total cost', (a) => (a.total_cost_usd ? `$${a.total_cost_usd.toFixed(4)}` : 'free')));

	return lines.join('\n') + '\n';
}

/**
 * Write the model-comparison markdown (from `formatComparisonMarkdown`) to
 * evals/results/comparison-<runId>.md.
 *
 * @param {Array<object>} results - buildResult() objects, one per model.
 * @param {string} evalsDir
 * @param {string} runId - Shared sweep id, used in the filename.
 * @returns {Promise<string>} Path to the written markdown file.
 */
export async function writeComparisonTable(results, evalsDir, runId) {
	const resultsDir = join(evalsDir, 'results');
	const stamp = (runId || new Date().toISOString()).replace(/[:.]/g, '-');
	const outPath = join(resultsDir, `comparison-${stamp}.md`);
	try {
		await mkdir(resultsDir, { recursive: true });
		await writeFile(outPath, formatComparisonMarkdown(results));
		return outPath;
	} catch (err) {
		throw new Error(`Failed to write eval comparison table to ${outPath}: ${err.message}`, { cause: err });
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
	// Solve^k broken down by difficulty tier — sorted so T1..T4 read top-down.
	const tiers = Object.keys(a.by_difficulty || {}).sort();
	if (tiers.length > 0) {
		console.log('');
		console.log('Solve^k by difficulty:');
		for (const tier of tiers) {
			const d = a.by_difficulty[tier];
			console.log(
				`  ${tier.padEnd(10)} ${String(d.solve_k_count).padStart(2)}/${d.total_tasks} tasks  ` +
					`(solve^${k} ${d.solve_k_rate}%, mean ${d.mean_solve_rate}%)`
			);
		}
		console.log('');
	}
	console.log(`Mean turns:     ${a.mean_turns} (p95: ${a.p95_turns})`);
	const meanCacheStr = a.mean_cache_ratio === null ? 'n/a' : `${Math.round(a.mean_cache_ratio * 100)}%`;
	console.log(`Mean cache:     ${meanCacheStr}`);
	console.log(`Mean cost:      $${a.mean_cost_usd.toFixed(4)} per run`);
	console.log(`Total cost:     $${a.total_cost_usd.toFixed(4)} (${a.total_runs} runs)`);
	console.log(`Loop fires:     ${a.total_loop_fires}`);
	console.log('');
}
