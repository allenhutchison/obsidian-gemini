#!/usr/bin/env node
/**
 * Extract judge-matcher calibration tuples from a sweep result and write them
 * to `evals/calibration/judge-calibration.json` for human labelling (#870).
 *
 * Usage:
 *   npm run eval:calibrate-extract                   # extract from the latest result
 *   npm run eval:calibrate-extract -- --from=<path>  # extract from a specific result
 *   npm run eval:calibrate-extract -- --out=<path>   # write to a non-default path
 *   npm run eval:calibrate-extract -- --force        # overwrite an existing calibration file
 *
 * Refuses to overwrite an existing calibration file by default — the file is
 * one-time human-labelled work, and a fresh extract would wipe the labels.
 * `--force` is the only way past this guard.
 */

import { readFile, readdir, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { extractCalibrationTuples } from './lib/calibration.mjs';

const EVALS_DIR = resolve(import.meta.dirname);

function parseArgs() {
	const args = process.argv.slice(2);
	const get = (name) => {
		const a = args.find((x) => x.startsWith(`--${name}=`));
		return a ? a.slice(`--${name}=`.length) : null;
	};
	return {
		from: get('from'),
		out: get('out'),
		force: args.includes('--force'),
	};
}

async function latestResult() {
	const resultsDir = join(EVALS_DIR, 'results');
	const files = await readdir(resultsDir);
	const jsonFiles = files.filter((f) => f.endsWith('.json')).sort();
	if (jsonFiles.length === 0) {
		throw new Error('No result files in evals/results/. Run `npm run eval` first.');
	}
	return join(resultsDir, jsonFiles[jsonFiles.length - 1]);
}

async function loadTaskMessages() {
	const tasksDir = join(EVALS_DIR, 'tasks');
	const files = (await readdir(tasksDir)).filter((f) => f.endsWith('.json'));
	const byId = new Map();
	for (const f of files) {
		const t = JSON.parse(await readFile(join(tasksDir, f), 'utf8'));
		if (t?.id) byId.set(t.id, { userMessage: t.userMessage });
	}
	return byId;
}

async function fileExists(path) {
	try {
		await stat(path);
		return true;
	} catch (e) {
		if (e.code === 'ENOENT') return false;
		throw e;
	}
}

async function main() {
	const { from, out, force } = parseArgs();
	const sourcePath = from ? resolve(from) : await latestResult();
	const outPath = out ? resolve(out) : join(EVALS_DIR, 'calibration', 'judge-calibration.json');

	if (!force && (await fileExists(outPath))) {
		console.error(`Refusing to overwrite ${outPath} (existing human labels would be lost). Pass --force to overwrite.`);
		process.exit(1);
	}

	const resultJson = JSON.parse(await readFile(sourcePath, 'utf8'));
	const taskById = await loadTaskMessages();
	const calibration = extractCalibrationTuples(resultJson, taskById);

	await mkdir(dirname(outPath), { recursive: true });
	await writeFile(outPath, JSON.stringify(calibration, null, 2) + '\n');

	const taskCount = new Set(calibration.tuples.map((t) => t.task_id)).size;
	console.log(`Extracted ${calibration.tuples.length} judge tuple(s) across ${taskCount} task(s):`);
	console.log(`  source:   ${sourcePath}`);
	console.log(`  model:    ${calibration.source.provider}/${calibration.source.model}`);
	console.log(`  git_sha:  ${calibration.source.git_sha}`);
	console.log(`  out:      ${outPath}`);
	if (calibration.tuples.length === 0) {
		console.log('\nNo judge tuples found — did the sweep include tasks with `judge` output matchers?');
	} else {
		console.log('\nNext step: edit the file and set each tuple\'s `human_label` to "YES" or "NO".');
	}
}

main().catch((err) => {
	console.error(err.message);
	process.exit(1);
});
