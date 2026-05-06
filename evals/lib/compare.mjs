#!/usr/bin/env node
/**
 * Compare two eval result files and report differences.
 *
 * CLI usage:
 *   node evals/lib/compare.mjs <baseline.json> [<current.json>]
 *
 * If only one argument is given, compares against the latest file in
 * evals/results/.
 *
 * The module also exports building blocks used by run.mjs for the
 * automatic baseline-compare step that runs after every eval:
 *
 *   - compareResults(baseline, current)   → structured comparison
 *   - printDetailedDiff(comparison)       → verbose stdout (CLI default)
 *   - printRegressionSummary(comparison)  → brief regressions-only view
 *   - getBaselinePath(...)                → filesystem path for a (provider, model) baseline
 *   - loadBaseline(...)                   → read+parse a baseline if one exists
 */

import { readFile, readdir, access } from 'node:fs/promises';
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
// Reliability aggregates that flag a *regression* worth blocking on. Mean rates
// and turn/cost movements are useful context but are not on this list — they
// move with prompt tweaks and model nondeterminism without indicating a real
// quality drop.
const REGRESSION_AGG_KEYS = new Set(['pass_k_rate', 'solve_k_rate']);
const PER_TASK_LOWER_IS_BETTER = new Set(['turns', 'cost_usd', 'loop_fires']);
const PER_TASK_HIGHER_IS_BETTER = new Set(['cache_ratio']);

// Metrics whose meaning depends on the active provider. Pricing tables and
// cache semantics are not portable across providers (Ollama is free + has no
// implicit cache; Gemini bills per token + caches), so cross-provider
// comparison reports omit these rather than report misleading deltas.
const CROSS_PROVIDER_AGG_KEYS = new Set(['mean_cache_ratio', 'mean_cost_usd', 'total_cost_usd']);
const CROSS_PROVIDER_TASK_KEYS = new Set(['cache_ratio', 'cost_usd']);

function isMetricRegression(key, before, after) {
	if (before === null || after === null) return false;
	if (PER_TASK_LOWER_IS_BETTER.has(key) && after > before) return true;
	if (PER_TASK_HIGHER_IS_BETTER.has(key) && after < before) return true;
	return false;
}

function fmtDelta(before, after) {
	if (before === null && after === null) return 'n/a';
	if (before === null) return `n/a → ${after}`;
	if (after === null) return `${before} → n/a`;
	const diff = after - before;
	const sign = diff > 0 ? '+' : '';
	const pct = before !== 0 ? ` (${sign}${Math.round((diff / before) * 100)}%)` : '';
	return `${before} → ${after}${pct}`;
}

function fmtPercentDelta(before, after) {
	if (before === null || after === null) return fmtDelta(before, after);
	const diff = after - before;
	if (Math.abs(diff) < 0.05) return `${before}% → ${after}% (=)`;
	const sign = diff > 0 ? '+' : '';
	return `${before}% → ${after}% (${sign}${diff.toFixed(1)}pp)`;
}

async function latestResult(evalsDir) {
	const resultsDir = join(evalsDir, 'results');
	const files = await readdir(resultsDir);
	const jsonFiles = files.filter((f) => f.endsWith('.json')).sort();
	if (jsonFiles.length === 0) throw new Error('No result files in evals/results/');
	return join(resultsDir, jsonFiles[jsonFiles.length - 1]);
}

/**
 * Sanitize a model id for use as part of a baseline filename. Replaces
 * filesystem-unsafe characters (slash, colon — the latter shows up in
 * Ollama tags like `gemma3:27b`) with hyphens. Lowercases for consistency.
 */
export function sanitizeModelForFilename(model) {
	return String(model || 'unknown')
		.toLowerCase()
		.replace(/[\\/:*?"<>|]/g, '-')
		.replace(/^-+|-+$/g, '');
}

/**
 * Resolve the on-disk baseline path for a (provider, model) pair under
 * `<evalsDir>/baselines/`. Format: `<provider>-<sanitized-model>.json`.
 * Following the issue spec — keeps the boundary explicit (e.g.
 * `gemini-gemini-2.5-flash-lite.json`, `ollama-gemma3-27b.json`).
 */
export function getBaselinePath(evalsDir, provider, model) {
	const safeProvider = String(provider || 'gemini').toLowerCase();
	const safeModel = sanitizeModelForFilename(model);
	return join(evalsDir, 'baselines', `${safeProvider}-${safeModel}.json`);
}

/**
 * Load and parse the baseline file matching a result's (provider, model),
 * or return null if no such baseline exists. Other I/O errors surface so a
 * corrupt baseline doesn't silently look like "no baseline."
 */
export async function loadBaseline(evalsDir, provider, model) {
	const path = getBaselinePath(evalsDir, provider, model);
	try {
		await access(path);
	} catch {
		return null;
	}
	const raw = await readFile(path, 'utf8');
	return { path, content: JSON.parse(raw) };
}

/**
 * Build a structured comparison between two eval result objects. Returns a
 * shape that's reusable both for the verbose CLI diff and the brief
 * regression summary the runner prints automatically.
 */
export function compareResults(baseline, current) {
	const providersDiffer = (baseline.provider || 'gemini') !== (current.provider || 'gemini');

	const aggregates = AGG_KEYS.map((key) => {
		const skipForProvider = providersDiffer && CROSS_PROVIDER_AGG_KEYS.has(key);
		const before = skipForProvider ? null : (baseline.aggregate?.[key] ?? null);
		const after = skipForProvider ? null : (current.aggregate?.[key] ?? null);
		const comparable = !skipForProvider && before !== null && after !== null;
		let regressed = false;
		let improved = false;
		if (comparable) {
			if (LOWER_IS_BETTER.has(key) && after > before) regressed = true;
			else if (HIGHER_IS_BETTER.has(key) && after < before) regressed = true;
			else if (LOWER_IS_BETTER.has(key) && after < before) improved = true;
			else if (HIGHER_IS_BETTER.has(key) && after > before) improved = true;
		}
		return { key, before, after, applicable: !skipForProvider, comparable, regressed, improved };
	});

	const baseTaskMap = new Map((baseline.tasks || []).map((t) => [t.id, t]));
	const currentTaskMap = new Map((current.tasks || []).map((t) => [t.id, t]));

	const tasks = [];
	for (const ct of current.tasks || []) {
		const cN = ct.n_runs ?? 1;
		const cSolved = ct.solved_count ?? (ct.solved ? 1 : 0);
		const cPassed = ct.passed_count ?? (ct.passed ? 1 : 0);
		const bt = baseTaskMap.get(ct.id);
		if (!bt) {
			tasks.push({
				id: ct.id,
				type: 'new',
				solved: { before: null, after: cSolved, n_after: cN },
				passed: { before: null, after: cPassed, n_after: cN },
				solveRegressed: false,
				passRegressed: false,
				metricChanges: [],
			});
			continue;
		}
		const bN = bt.n_runs ?? 1;
		const bSolved = bt.solved_count ?? (bt.solved ? 1 : 0);
		const bPassed = bt.passed_count ?? (bt.passed ? 1 : 0);

		// Solved/passed regression = solve rate as a fraction of N drops. This
		// catches both 3/3 → 0/3 (hard regression) and 3/3 → 2/3 (flaky onset)
		// even when N differs between runs.
		const solveRegressed = cSolved / cN < bSolved / bN;
		const passRegressed = cPassed / cN < bPassed / bN;

		const metricChanges = [];
		for (const key of METRIC_KEYS) {
			if (providersDiffer && CROSS_PROVIDER_TASK_KEYS.has(key)) continue;
			const b = bt.metrics?.[key];
			const c = ct.metrics?.[key];
			const bIsNull = b === null || b === undefined;
			const cIsNull = c === null || c === undefined;
			if (bIsNull && cIsNull) continue;
			if (bIsNull !== cIsNull) {
				metricChanges.push({ key, before: bIsNull ? null : b, after: cIsNull ? null : c, regressed: false });
				continue;
			}
			if (Math.abs(b - c) > 0.001) {
				metricChanges.push({ key, before: b, after: c, regressed: isMetricRegression(key, b, c) });
			}
		}
		const counts = bSolved !== cSolved || bPassed !== cPassed || bN !== cN || metricChanges.length > 0;
		tasks.push({
			id: ct.id,
			type: counts ? 'changed' : 'unchanged',
			solved: { before: bSolved, after: cSolved, n_before: bN, n_after: cN },
			passed: { before: bPassed, after: cPassed, n_before: bN, n_after: cN },
			solveRegressed,
			passRegressed,
			metricChanges,
		});
	}
	for (const bt of baseline.tasks || []) {
		if (!currentTaskMap.has(bt.id)) {
			const bN = bt.n_runs ?? 1;
			const bSolved = bt.solved_count ?? (bt.solved ? 1 : 0);
			tasks.push({
				id: bt.id,
				type: 'removed',
				solved: { before: bSolved, after: null, n_before: bN },
				passed: { before: null, after: null },
				// Removing a task from the suite is not a regression in scoring; the
				// operator removed it intentionally. Visible in the diff but no flag.
				solveRegressed: false,
				passRegressed: false,
				metricChanges: [],
			});
		}
	}

	const regressedAggregates = aggregates.filter((a) => a.regressed && REGRESSION_AGG_KEYS.has(a.key));
	const regressedTasks = tasks.filter((t) => t.solveRegressed || t.passRegressed);
	const hasRegressions = regressedAggregates.length > 0 || regressedTasks.length > 0;

	return {
		baseline: {
			run_id: baseline.run_id,
			git_sha: baseline.git_sha,
			model: baseline.model,
			provider: baseline.provider || 'gemini',
		},
		current: {
			run_id: current.run_id,
			git_sha: current.git_sha,
			model: current.model,
			provider: current.provider || 'gemini',
		},
		providersDiffer,
		aggregates,
		tasks,
		regressedAggregates,
		regressedTasks,
		hasRegressions,
	};
}

/**
 * Render the historical verbose diff (used by the CLI). Behavior matches
 * the pre-#717 output so existing operator muscle memory still works.
 */
export function printDetailedDiff(comparison) {
	console.log(`\n=== Eval Comparison ===`);
	console.log(`Baseline: ${comparison.baseline.run_id} (${comparison.baseline.git_sha})`);
	console.log(`Current:  ${comparison.current.run_id} (${comparison.current.git_sha})\n`);

	if (comparison.providersDiffer) {
		console.log(`Providers differ: ${comparison.baseline.provider} → ${comparison.current.provider}`);
		console.log('(cost and cache deltas are not directly comparable)\n');
	}
	console.log('Aggregates:');
	for (const agg of comparison.aggregates) {
		if (!agg.applicable) {
			console.log(`  ${agg.key.padEnd(22)} n/a (cross-provider)`);
			continue;
		}
		const flag = agg.regressed ? ' ⚠' : '';
		console.log(`  ${agg.key.padEnd(22)} ${fmtDelta(agg.before, agg.after)}${flag}`);
	}

	console.log('\nPer-task changes:');
	for (const task of comparison.tasks) {
		if (task.type === 'new') {
			console.log(`  [NEW] ${task.id}: solved ${task.solved.after}/${task.solved.n_after}`);
			continue;
		}
		if (task.type === 'removed') {
			console.log(`  [REMOVED] ${task.id}`);
			continue;
		}
		if (task.type === 'unchanged') continue;
		const changes = [];
		if (task.solved.before !== task.solved.after || task.solved.n_before !== task.solved.n_after) {
			const marker = task.solveRegressed ? '⚠ ' : '';
			changes.push(
				`${marker}solved: ${task.solved.before}/${task.solved.n_before} → ${task.solved.after}/${task.solved.n_after}`
			);
		}
		if (task.passed.before !== task.passed.after || task.passed.n_before !== task.passed.n_after) {
			const marker = task.passRegressed ? '⚠ ' : '';
			changes.push(
				`${marker}passed: ${task.passed.before}/${task.passed.n_before} → ${task.passed.after}/${task.passed.n_after}`
			);
		}
		for (const m of task.metricChanges) {
			const marker = m.regressed ? '⚠ ' : '';
			changes.push(`${marker}${m.key}: ${fmtDelta(m.before, m.after)}`);
		}
		if (changes.length > 0) {
			console.log(`  ${task.id}: ${changes.join(', ')}`);
		}
	}
	console.log('');
}

/**
 * Brief regressions-focused summary appended to `npm run eval` output.
 * Always shows headline pass^k/solve^k deltas; only enumerates tasks
 * with regressions or solve-count drops. Returns true iff regressions
 * were flagged.
 */
export function printRegressionSummary(comparison, baselineLabel) {
	const labelParts = [];
	if (comparison.baseline.git_sha) labelParts.push(comparison.baseline.git_sha);
	if (comparison.baseline.run_id) {
		// run_id is an ISO timestamp; keep just the date for readability.
		const datePart = comparison.baseline.run_id.split('T')[0];
		if (datePart) labelParts.push(datePart);
	}
	const label = baselineLabel || labelParts.join(' / ') || 'baseline';
	console.log(`\n=== Regression check vs baseline (${label}) ===`);

	const headline = ['pass_k_rate', 'solve_k_rate'];
	for (const key of headline) {
		const agg = comparison.aggregates.find((a) => a.key === key);
		if (!agg || !agg.applicable) continue;
		const k = comparison.current.n_runs ?? '';
		const labelKey = key === 'pass_k_rate' ? `pass^${k || 'k'}` : `solve^${k || 'k'}`;
		const flag = agg.regressed ? ' ⚠' : '';
		console.log(`  ${labelKey.padEnd(10)} ${fmtPercentDelta(agg.before, agg.after)}${flag}`);
	}

	if (comparison.regressedTasks.length > 0) {
		console.log('\n  Tasks with degraded solve/pass rate:');
		for (const t of comparison.regressedTasks) {
			const parts = [];
			if (t.solveRegressed) {
				parts.push(`solved ${t.solved.before}/${t.solved.n_before} → ${t.solved.after}/${t.solved.n_after}`);
			}
			if (t.passRegressed) {
				parts.push(`passed ${t.passed.before}/${t.passed.n_before} → ${t.passed.after}/${t.passed.n_after}`);
			}
			console.log(`    ${t.id}: ${parts.join(', ')}`);
		}
	} else if (!comparison.hasRegressions) {
		console.log('  No regressions vs baseline.');
	}
	console.log('');
	return comparison.hasRegressions;
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

	const comparison = compareResults(baseline, current);
	printDetailedDiff(comparison);
}

// Run as CLI only when invoked directly, not when imported.
const isDirect = import.meta.url === `file://${process.argv[1]}`;
if (isDirect) {
	main().catch((err) => {
		console.error(err.message);
		process.exit(1);
	});
}
