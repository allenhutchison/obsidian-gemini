#!/usr/bin/env node
/**
 * Promote an eval result to the blessed baseline for its (provider, model).
 *
 * Usage:
 *   node evals/lib/bless.mjs                  # bless the latest result
 *   node evals/lib/bless.mjs <result.json>    # bless a specific result file
 *
 * Writes the chosen result to `evals/baselines/<provider>-<model>.json`.
 * Existing baselines are overwritten — use git to recover prior baselines.
 */

import { copyFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { getBaselinePath } from './compare.mjs';

async function latestResult(evalsDir) {
	const resultsDir = join(evalsDir, 'results');
	const files = await readdir(resultsDir);
	const jsonFiles = files.filter((f) => f.endsWith('.json')).sort();
	if (jsonFiles.length === 0) throw new Error('No result files in evals/results/');
	return join(resultsDir, jsonFiles[jsonFiles.length - 1]);
}

async function main() {
	const evalsDir = resolve(import.meta.dirname, '..');
	const args = process.argv.slice(2);
	const sourcePath = args[0] ? resolve(args[0]) : await latestResult(evalsDir);

	const raw = await readFile(sourcePath, 'utf8');
	const result = JSON.parse(raw);

	const baselinePath = getBaselinePath(evalsDir, result.provider, result.model);
	await mkdir(dirname(baselinePath), { recursive: true });
	await copyFile(sourcePath, baselinePath);

	console.log(`Blessed ${result.provider || 'gemini'} / ${result.model || 'unknown'}:`);
	console.log(`  source:   ${sourcePath}`);
	console.log(`  baseline: ${baselinePath}`);
	console.log(`  git_sha:  ${result.git_sha || '(unknown)'}`);
}

main().catch((err) => {
	console.error(err.message);
	process.exit(1);
});
