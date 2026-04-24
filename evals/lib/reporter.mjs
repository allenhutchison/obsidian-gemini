/**
 * Produces a JSON results file and a human-readable stdout summary.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

function percentile(arr, p) {
	if (arr.length === 0) return 0;
	const sorted = [...arr].sort((a, b) => a - b);
	const idx = Math.ceil((p / 100) * sorted.length) - 1;
	return sorted[Math.max(0, idx)];
}

/**
 * Compute aggregate metrics across all task results.
 */
export function computeAggregates(taskResults) {
	const total = taskResults.length;
	if (total === 0) {
		return {
			total_tasks: 0,
			pass_rate: 0,
			solve_rate: 0,
			mean_turns: 0,
			p95_turns: 0,
			mean_cache_ratio: 0,
			mean_cost_usd: 0,
			total_cost_usd: 0,
			total_loop_fires: 0,
		};
	}

	const passed = taskResults.filter((r) => r.passed).length;
	const solved = taskResults.filter((r) => r.solved).length;
	const turns = taskResults.map((r) => r.metrics.turns);
	const costs = taskResults.map((r) => r.metrics.cost_usd);
	const cacheRatios = taskResults.map((r) => r.metrics.cache_ratio);

	return {
		total_tasks: total,
		pass_rate: Math.round((passed / total) * 100 * 10) / 10,
		solve_rate: Math.round((solved / total) * 100 * 10) / 10,
		mean_turns: Math.round((turns.reduce((a, b) => a + b, 0) / total) * 10) / 10,
		p95_turns: percentile(turns, 95),
		mean_cache_ratio: Math.round((cacheRatios.reduce((a, b) => a + b, 0) / total) * 1000) / 1000,
		mean_cost_usd: Math.round((costs.reduce((a, b) => a + b, 0) / total) * 1_000_000) / 1_000_000,
		total_cost_usd: Math.round(costs.reduce((a, b) => a + b, 0) * 1_000_000) / 1_000_000,
		total_loop_fires: taskResults.reduce((a, r) => a + r.metrics.loop_fires, 0),
	};
}

/**
 * Build the full result object.
 */
export function buildResult(taskResults, gitSha, modelName) {
	return {
		run_id: new Date().toISOString(),
		git_sha: gitSha,
		model: modelName,
		tasks: taskResults,
		aggregate: computeAggregates(taskResults),
	};
}

/**
 * Write JSON results to evals/results/<timestamp>.json.
 */
export async function writeResults(result, evalsDir) {
	const resultsDir = join(evalsDir, 'results');
	await mkdir(resultsDir, { recursive: true });
	const filename = `${result.run_id.replace(/[:.]/g, '-')}.json`;
	const outPath = join(resultsDir, filename);
	await writeFile(outPath, JSON.stringify(result, null, 2));
	return outPath;
}

/**
 * Print a human-readable summary to stdout.
 */
export function printSummary(result) {
	const a = result.aggregate;
	console.log('\n=== Eval Run Summary ===');
	console.log(`Git SHA: ${result.git_sha}`);
	console.log(`Model:   ${result.model}`);
	console.log(`Tasks:   ${a.total_tasks}`);
	console.log('');

	// Per-task table
	console.log('Task                          Pass  Solve  Turns  Cache%  Cost($)  Loops');
	console.log('-'.repeat(80));
	for (const t of result.tasks) {
		const m = t.metrics;
		const passStr = t.passed ? ' OK ' : 'FAIL';
		const solveStr = t.solved ? ' OK ' : 'FAIL';
		const cacheStr = `${Math.round(m.cache_ratio * 100)}%`;
		console.log(
			`${t.id.padEnd(30)} ${passStr}  ${solveStr}  ${String(m.turns).padStart(5)}  ${cacheStr.padStart(6)}  ${m.cost_usd.toFixed(4).padStart(7)}  ${String(m.loop_fires).padStart(5)}`
		);
	}

	console.log('-'.repeat(80));
	console.log('');
	console.log(`Pass rate:      ${a.pass_rate}%`);
	console.log(`Solve rate:     ${a.solve_rate}%`);
	console.log(`Mean turns:     ${a.mean_turns} (p95: ${a.p95_turns})`);
	console.log(`Mean cache:     ${Math.round(a.mean_cache_ratio * 100)}%`);
	console.log(`Mean cost:      $${a.mean_cost_usd.toFixed(4)}`);
	console.log(`Total cost:     $${a.total_cost_usd.toFixed(4)}`);
	console.log(`Loop fires:     ${a.total_loop_fires}`);
	console.log('');
}
