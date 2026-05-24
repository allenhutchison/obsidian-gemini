#!/usr/bin/env node
/**
 * Measure a candidate LLM-as-judge against the human-labelled calibration set
 * built in #870. Reports overall agreement, a confusion matrix (FP / FN),
 * and a per-tuple disagreement list. Informs the judge-model decision (#871).
 *
 * Usage:
 *   npm run eval:calibrate-judge                          # default model (env or fallback)
 *   npm run eval:calibrate-judge -- --model=gemini-2.5-pro
 *   npm run eval:calibrate-judge -- --calibration=<path>  # alternate calibration file
 *   npm run eval:calibrate-judge -- --json                # machine-readable summary
 *
 * The candidate must reach the harness's standard judge surface (currently
 * Gemini via `EVAL_JUDGE_API_KEY` or the running plugin's key). A cross-vendor
 * judge needs the provider plumbing tracked in #872 before it can be measured
 * by this tool.
 */

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createJudge } from './lib/judge.mjs';
import { evaluateJudgeAgainstCalibration } from './lib/judge-eval.mjs';

const EVALS_DIR = resolve(import.meta.dirname);

function parseArgs() {
	const args = process.argv.slice(2);
	const get = (name) => {
		const a = args.find((x) => x.startsWith(`--${name}=`));
		return a ? a.slice(`--${name}=`.length) : null;
	};
	return {
		model: get('model'),
		calibrationPath: get('calibration'),
		json: args.includes('--json'),
	};
}

function pct(n) {
	return `${(n * 100).toFixed(1)}%`;
}

function printSummary(result, modelId) {
	console.log(`\n=== Judge agreement on calibration set ===`);
	console.log(`Judge model:    ${modelId}`);
	console.log(`Tuples total:   ${result.total}`);
	console.log(`Evaluated:      ${result.evaluated}`);
	console.log(`  unlabelled:   ${result.skipped_unlabelled}`);
	console.log(`  judge-error:  ${result.skipped_judge_error}`);
	console.log(`  call errors:  ${result.judge_call_errors}`);
	console.log('');
	console.log(`Agreement:      ${result.agreed}/${result.evaluated} (${pct(result.accuracy)})`);
	console.log(`Disagreements:  ${result.disagreed}`);
	console.log(`  false +:      ${result.false_positives}  (judge YES, human NO)`);
	console.log(`  false −:      ${result.false_negatives}  (judge NO,  human YES)`);

	if (result.disagreements.length > 0) {
		console.log('\n=== Per-tuple disagreements ===');
		for (const d of result.disagreements) {
			const tag = d.kind === 'false_positive' ? 'FP' : 'FN';
			console.log(`  ${tag}  ${d.id}  (judge=${d.judge_verdict ? 'YES' : 'NO'}, human=${d.human_label})`);
		}
	}
}

async function main() {
	const { model, calibrationPath, json } = parseArgs();
	const calPath = calibrationPath ? resolve(calibrationPath) : join(EVALS_DIR, 'calibration', 'judge-calibration.json');

	let calibration;
	try {
		calibration = JSON.parse(await readFile(calPath, 'utf8'));
	} catch (err) {
		console.error(`Failed to load calibration set at ${calPath}: ${err.message}`);
		console.error(`(Run \`npm run eval:calibrate-extract\` against a sweep result to build one.)`);
		process.exit(1);
	}

	const judge = await createJudge({ model });
	if (!judge) {
		console.error(
			'No judge available. Set EVAL_JUDGE_API_KEY to a Gemini API key, or have one configured in the running plugin.'
		);
		process.exit(1);
	}

	const result = await evaluateJudgeAgainstCalibration(calibration, judge);

	if (json) {
		console.log(JSON.stringify({ model: judge.modelId, ...result }, null, 2));
	} else {
		printSummary(result, judge.modelId);
	}
}

main().catch((err) => {
	console.error(err.message);
	process.exit(1);
});
