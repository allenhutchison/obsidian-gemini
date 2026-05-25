/**
 * VitePress data loader for the published eval results table (#875).
 *
 * Reads every committed baseline under `evals/baselines/` at docs-build time
 * and emits a compact per-baseline summary. The baselines themselves carry
 * full per-task evidence (post-#869) which is far more than the rendered
 * table needs, so this loader projects down to the headline numbers + the
 * provenance fields the table column set calls out.
 *
 * Loader contract: VitePress invokes `load()` once per build (and re-runs
 * when any watched file changes). The page consumes the result via
 * `import { data } from './evals.data.mts'`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASELINES_DIR = path.resolve(__dirname, '../evals/baselines');

export interface DifficultyBreakdown {
	total_tasks: number;
	solve_k_count: number;
	solve_k_rate: number;
	mean_solve_rate: number;
}

export interface BaselineSummary {
	/** Human-readable model id (as reported by the harness) */
	model: string;
	/** Provider id (gemini, ollama, …) */
	provider: string;
	/** k in pass^k / solve^k — how many repeats per task */
	n_runs: number;
	/** Total tasks scored in this baseline (the suite size at the time of sweep) */
	total_tasks: number;
	/** % of tasks where ALL k runs passed (no harness errors / no timeouts) */
	pass_k_rate: number;
	/** % of tasks where ALL k runs solved (passed AND satisfied the full rubric) */
	solve_k_rate: number;
	/** Per-tier breakdown — keys are difficulty tiers (T1…T4, or "untagged") */
	by_difficulty: Record<string, DifficultyBreakdown>;
	/** ISO timestamp of the originating sweep (the harness's run_id) */
	run_id: string;
	/** Commit SHA the harness was built from when the sweep ran */
	git_sha: string;
	/** Source filename, useful for debugging which file produced this row */
	source: string;
}

/**
 * Extract a single baseline file's headline numbers. Defensive against
 * partial files — missing fields collapse to safe defaults so the table
 * still renders the rest of the row.
 */
function summarize(filePath: string): BaselineSummary | null {
	let raw: any;
	try {
		raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
	} catch (err) {
		// A malformed baseline shouldn't break the entire docs build — the
		// other rows are still valuable. Skip with a warning.
		console.warn(`[evals.data.mts] skipping ${filePath}: ${(err as Error).message}`);
		return null;
	}
	const agg = raw?.aggregate ?? {};
	const byDifficultyRaw = agg.by_difficulty ?? {};
	const byDifficulty: Record<string, DifficultyBreakdown> = {};
	for (const [tier, entry] of Object.entries(byDifficultyRaw as Record<string, any>)) {
		byDifficulty[tier] = {
			total_tasks: entry?.total_tasks ?? 0,
			solve_k_count: entry?.solve_k_count ?? 0,
			solve_k_rate: entry?.solve_k_rate ?? 0,
			mean_solve_rate: entry?.mean_solve_rate ?? 0,
		};
	}
	return {
		model: raw?.model ?? 'unknown',
		provider: raw?.provider ?? 'unknown',
		n_runs: agg.n_runs ?? 0,
		total_tasks: agg.total_tasks ?? 0,
		pass_k_rate: agg.pass_k_rate ?? 0,
		solve_k_rate: agg.solve_k_rate ?? 0,
		by_difficulty: byDifficulty,
		run_id: raw?.run_id ?? '',
		git_sha: raw?.git_sha ?? '',
		source: path.basename(filePath),
	};
}

export default {
	watch: ['../evals/baselines/*.json'],
	load(): BaselineSummary[] {
		let files: string[];
		try {
			files = fs.readdirSync(BASELINES_DIR).filter((f) => f.endsWith('.json'));
		} catch (err) {
			// No baselines committed yet — render an empty table rather than
			// failing the build.
			console.warn(`[evals.data.mts] no baselines directory at ${BASELINES_DIR}`);
			return [];
		}
		const rows = files
			.map((f) => summarize(path.join(BASELINES_DIR, f)))
			.filter((r): r is BaselineSummary => r !== null);
		// Sort by solve_k_rate descending — the most useful headline first.
		// Ties (or zeros) fall back to provider/model for deterministic output.
		rows.sort((a, b) => {
			if (b.solve_k_rate !== a.solve_k_rate) return b.solve_k_rate - a.solve_k_rate;
			if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
			return a.model.localeCompare(b.model);
		});
		return rows;
	},
};
