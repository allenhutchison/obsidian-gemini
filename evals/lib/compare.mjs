#!/usr/bin/env node
/**
 * Compare two eval result files and report differences.
 *
 * Usage:
 *   node evals/lib/compare.mjs <baseline.json> [<current.json>]
 *
 * If only one argument is given, compares against the latest file in
 * evals/results/.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const METRIC_KEYS = ['turns', 'cache_ratio', 'cost_usd', 'loop_fires', 'tool_calls'];
const AGG_KEYS = [
	'pass_k_rate',
	'solve_k_rate',
	'mean_pass_rate',
	'mean_solve_rate',
	'flaky_task_count',
	'mean_turns',
	'p95_turns',
	'mean_cache_ratio',
	'mean_cost_usd',
	'total_cost_usd',
	'total_loop_fires',
];
const LOWER_IS_BETTER = new Set([
	'flaky_task_count',
	'mean_turns',
	'p95_turns',
	'mean_cost_usd',
	'total_cost_usd',
	'total_loop_fires',
]);
const HIGHER_IS_BETTER = new Set([
	'pass_k_rate',
	'solve_k_rate',
	'mean_pass_rate',
	'mean_solve_rate',
	'mean_cache_ratio',
]);
// Per-task metric directionality. tool_calls is intentionally absent — more
// or fewer tool calls isn't a regression on its own (it depends on the task).
const PER_TASK_LOWER_IS_BETTER = new Set(['turns', 'cost_usd', 'loop_fires']);
const PER_TASK_HIGHER_IS_BETTER = new Set(['cache_ratio']);

function isMetricRegression(key, before, after) {
	if (PER_TASK_LOWER_IS_BETTER.has(key) && after > before) return true;
	if (PER_TASK_HIGHER_IS_BETTER.has(key) && after < before) return true;
	return false;
}

function fmtDelta(before, after) {
	const diff = after - before;
	const sign = diff > 0 ? '+' : '';
	const pct = before !== 0 ? ` (${sign}${Math.round((diff / before) * 100)}%)` : '';
	return `${before} → ${after}${pct}`;
}

async function latestResult(evalsDir) {
	const resultsDir = join(evalsDir, 'results');
	const files = await readdir(resultsDir);
	const jsonFiles = files.filter((f) => f.endsWith('.json')).sort();
	if (jsonFiles.length === 0) throw new Error('No result files in evals/results/');
	return join(resultsDir, jsonFiles[jsonFiles.length - 1]);
}

async function main() {
	const args = process.argv.slice(2);
	if (args.length < 1) {
		console.error('Usage: node evals/lib/compare.mjs <baseline.json> [<current.json>]');
		process.exit(1);
	}

	const evalsDir = resolve(import.meta.dirname, '..');
	const baselinePath = resolve(args[0]);
	const currentPath = args[1] ? resolve(args[1]) : await latestResult(evalsDir);

	const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
	const current = JSON.parse(await readFile(currentPath, 'utf8'));

	console.log(`\n=== Eval Comparison ===`);
	console.log(`Baseline: ${baseline.run_id} (${baseline.git_sha})`);
	console.log(`Current:  ${current.run_id} (${current.git_sha})\n`);

	// Aggregate comparison
	console.log('Aggregates:');
	for (const key of AGG_KEYS) {
		const b = baseline.aggregate[key] ?? 0;
		const c = current.aggregate[key] ?? 0;
		let flag = '';
		if (LOWER_IS_BETTER.has(key) && c > b) flag = ' ⚠';
		else if (HIGHER_IS_BETTER.has(key) && c < b) flag = ' ⚠';
		console.log(`  ${key.padEnd(22)} ${fmtDelta(b, c)}${flag}`);
	}

	// Per-task comparison. Solved/passed are per-task-run counts; treat any
	// drop in count as a regression (e.g. 3/3 → 2/3 is flakiness appearing,
	// 2/3 → 0/3 is a harder regression).
	console.log('\nPer-task changes:');
	const baseTaskMap = new Map(baseline.tasks.map((t) => [t.id, t]));
	const currentTaskMap = new Map(current.tasks.map((t) => [t.id, t]));
	for (const ct of current.tasks) {
		const bt = baseTaskMap.get(ct.id);
		const cN = ct.n_runs ?? 1;
		const cSolved = ct.solved_count ?? (ct.solved ? 1 : 0);
		const cPassed = ct.passed_count ?? (ct.passed ? 1 : 0);
		if (!bt) {
			console.log(`  [NEW] ${ct.id}: solved ${cSolved}/${cN}, turns ${ct.metrics.turns}`);
			continue;
		}
		const bN = bt.n_runs ?? 1;
		const bSolved = bt.solved_count ?? (bt.solved ? 1 : 0);
		const bPassed = bt.passed_count ?? (bt.passed ? 1 : 0);
		const changes = [];
		if (bSolved !== cSolved || bN !== cN) {
			const marker = cSolved / cN < bSolved / bN ? '⚠ ' : '';
			changes.push(`${marker}solved: ${bSolved}/${bN} → ${cSolved}/${cN}`);
		}
		if (bPassed !== cPassed || bN !== cN) {
			const marker = cPassed / cN < bPassed / bN ? '⚠ ' : '';
			changes.push(`${marker}passed: ${bPassed}/${bN} → ${cPassed}/${cN}`);
		}
		for (const key of METRIC_KEYS) {
			const b = bt.metrics[key] ?? 0;
			const c = ct.metrics[key] ?? 0;
			if (Math.abs(b - c) > 0.001) {
				const marker = isMetricRegression(key, b, c) ? '⚠ ' : '';
				changes.push(`${marker}${key}: ${fmtDelta(b, c)}`);
			}
		}
		if (changes.length > 0) {
			console.log(`  ${ct.id}: ${changes.join(', ')}`);
		}
	}

	// Tasks in baseline but not in current
	for (const bt of baseline.tasks) {
		if (!currentTaskMap.has(bt.id)) {
			console.log(`  [REMOVED] ${bt.id}`);
		}
	}

	console.log('');
}

main().catch((err) => {
	console.error(err.message);
	process.exit(1);
});
