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
	'pass_rate',
	'solve_rate',
	'mean_turns',
	'p95_turns',
	'mean_cache_ratio',
	'mean_cost_usd',
	'total_cost_usd',
	'total_loop_fires',
];

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
		const flag = key.includes('cost') || key.includes('loop') ? (c > b ? ' ⚠' : '') : c < b ? ' ⚠' : '';
		console.log(`  ${key.padEnd(22)} ${fmtDelta(b, c)}${flag}`);
	}

	// Per-task comparison
	console.log('\nPer-task changes:');
	const baseTaskMap = new Map(baseline.tasks.map((t) => [t.id, t]));
	for (const ct of current.tasks) {
		const bt = baseTaskMap.get(ct.id);
		if (!bt) {
			console.log(`  [NEW] ${ct.id}: solved=${ct.solved}, turns=${ct.metrics.turns}`);
			continue;
		}
		const changes = [];
		if (bt.solved !== ct.solved) changes.push(`solved: ${bt.solved} → ${ct.solved}`);
		for (const key of METRIC_KEYS) {
			const b = bt.metrics[key] ?? 0;
			const c = ct.metrics[key] ?? 0;
			if (Math.abs(b - c) > 0.001) changes.push(`${key}: ${fmtDelta(b, c)}`);
		}
		if (changes.length > 0) {
			console.log(`  ${ct.id}: ${changes.join(', ')}`);
		}
	}

	// Tasks in baseline but not in current
	for (const bt of baseline.tasks) {
		if (!current.tasks.find((ct) => ct.id === bt.id)) {
			console.log(`  [REMOVED] ${bt.id}`);
		}
	}

	console.log('');
}

main().catch((err) => {
	console.error(err.message);
	process.exit(1);
});
