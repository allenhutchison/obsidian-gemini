#!/usr/bin/env node
/**
 * Eval harness runner for Gemini Scribe agent sessions.
 *
 * Drives a live Obsidian instance via the CLI to execute agent tasks,
 * capture event-bus metrics, score against rubrics, and produce a
 * structured result file.
 *
 * Usage:
 *   npm run eval                        # Run all tasks
 *   npm run eval -- --task=find-tagged  # Run a single task (prefix match)
 *   npm run eval -- --keep-artifacts    # Don't clean up scratch files
 *
 * Prerequisites:
 *   - Obsidian desktop running with the gemini-scribe plugin enabled
 *   - Agent view visible (open the agent panel)
 *   - API key configured
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import {
	verifyPlugin,
	createSession,
	setupFixtures,
	sendMessage,
	cleanup,
	getLastModelResponse,
	obsidianEval,
} from './lib/obsidian-driver.mjs';
import { installCollector, readAndClearCollector, removeCollector } from './lib/collector.mjs';
import { scoreTask } from './lib/scorer.mjs';
import { aggregateTaskRuns, buildResult, writeResults, printSummary } from './lib/reporter.mjs';

const EVALS_DIR = resolve(import.meta.dirname);

const DEFAULT_REPEAT = 3;

function parseArgs() {
	const args = process.argv.slice(2);
	const repeatArg = args.find((a) => a.startsWith('--repeat='))?.split('=')[1];
	const repeat = repeatArg ? parseInt(repeatArg, 10) : DEFAULT_REPEAT;
	if (!Number.isInteger(repeat) || repeat < 1) {
		throw new Error(`--repeat must be a positive integer, got "${repeatArg}"`);
	}
	return {
		taskFilter: args.find((a) => a.startsWith('--task='))?.split('=')[1] || null,
		keepArtifacts: args.includes('--keep-artifacts'),
		repeat,
	};
}

async function loadTasks(filter) {
	const tasksDir = join(EVALS_DIR, 'tasks');
	const files = await readdir(tasksDir);
	const jsonFiles = files.filter((f) => f.endsWith('.json')).sort();

	const tasks = [];
	for (const f of jsonFiles) {
		const content = await readFile(join(tasksDir, f), 'utf8');
		const task = JSON.parse(content);
		if (filter && !task.id.startsWith(filter)) continue;
		tasks.push(task);
	}
	return tasks;
}

async function loadFixtureFiles(fixtureName) {
	if (!fixtureName) return [];
	const fixtureDir = join(EVALS_DIR, 'fixtures', fixtureName);
	let files;
	try {
		files = await readdir(fixtureDir);
	} catch (err) {
		// Missing fixture directory is fine — task simply has no fixtures.
		// Permission / I/O errors must surface so we don't silently produce
		// misleading eval results.
		if (err?.code === 'ENOENT') return [];
		throw new Error(`Failed to read fixture directory "${fixtureDir}": ${err.message}`);
	}

	const result = [];
	for (const name of files) {
		const content = await readFile(join(fixtureDir, name), 'utf8');
		result.push({ name, content });
	}
	return result;
}

function getGitSha() {
	try {
		return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
	} catch {
		return 'unknown';
	}
}

async function getModelName() {
	const result = await obsidianEval("app.plugins.plugins['gemini-scribe'].settings.chatModelName || 'unknown'");
	return result.replace(/^["']|["']$/g, '');
}

async function runTask(task, keepArtifacts) {
	const title = `[eval] ${task.id}`;
	console.log(`  "${task.description}"`);

	let sessionInfo;
	const startTime = Date.now();

	try {
		// 1. Setup fixtures
		const fixtureFiles = await loadFixtureFiles(task.fixture);
		if (fixtureFiles.length > 0) {
			console.log(`  Setting up ${fixtureFiles.length} fixture files...`);
			await setupFixtures(fixtureFiles);
		}

		// 2. Create session
		sessionInfo = await createSession(title);
		console.log(`  Session: ${sessionInfo.sessionId}`);

		// 3. Install collector
		await installCollector();

		// 4. Send the user message and wait for completion
		console.log(`  Sending message...`);
		await sendMessage(task.userMessage);
		console.log(`  Turn completed.`);

		// 5. Read events and model response
		const events = await readAndClearCollector();
		const modelResponse = await getLastModelResponse();
		const durationMs = Date.now() - startTime;

		// 6. Score
		const modelName = await getModelName();
		const result = scoreTask(task, events, modelResponse, modelName, durationMs);
		console.log(
			`  ${result.solved ? 'SOLVED' : result.passed ? 'PASSED (not solved)' : 'FAILED'} — ${result.metrics.turns} turns, ${result.metrics.tool_calls} tool calls, $${result.metrics.cost_usd.toFixed(4)}`
		);

		return result;
	} catch (err) {
		const durationMs = Date.now() - startTime;
		console.error(`  ERROR: ${err.message}`);
		return {
			id: task.id,
			passed: false,
			solved: false,
			metrics: {
				turns: 0,
				tool_calls: 0,
				prompt_tokens: 0,
				cached_tokens: 0,
				cache_ratio: 0,
				output_tokens: 0,
				cost_usd: 0,
				loop_fires: 0,
				duration_ms: durationMs,
				tool_list: [],
			},
			errors: [err.message],
			solve_details: { expected_tools_met: false, forbidden_tools_clean: true, matchers_pass: false },
		};
	} finally {
		// 7. Cleanup — must run even if session creation failed before sessionInfo
		// was assigned, otherwise eval-scratch leaks into subsequent runs.
		await removeCollector();
		if (!keepArtifacts) {
			try {
				await cleanup(sessionInfo?.historyPath);
			} catch (e) {
				console.warn(`  Cleanup warning: ${e.message}`);
			}
		}
	}
}

async function main() {
	const { taskFilter, keepArtifacts, repeat } = parseArgs();
	console.log('=== Gemini Scribe Eval Harness ===');

	// Verify prerequisites
	console.log('Verifying plugin...');
	const pluginStatus = await verifyPlugin();
	if (!pluginStatus.ok) {
		console.error(`Plugin check failed: ${pluginStatus.error}`);
		console.error('Make sure Obsidian is running with the gemini-scribe plugin enabled and the agent view open.');
		process.exit(1);
	}
	console.log(`Plugin v${pluginStatus.version} ready.`);

	// Load tasks
	const tasks = await loadTasks(taskFilter);
	if (tasks.length === 0) {
		console.error('No tasks found' + (taskFilter ? ` matching "${taskFilter}"` : '') + '.');
		process.exit(1);
	}
	console.log(`Running ${tasks.length} task(s) × ${repeat} run${repeat === 1 ? '' : 's'}...`);

	// Run tasks sequentially. Each task runs `repeat` times so we can report
	// pass^k reliability on top of per-run pass/solve rates.
	const taskResults = [];
	for (const task of tasks) {
		const runs = [];
		for (let i = 0; i < repeat; i++) {
			const runLabel = repeat > 1 ? ` [run ${i + 1}/${repeat}]` : '';
			console.log(`\n--- Running: ${task.id}${runLabel} ---`);
			runs.push(await runTask(task, keepArtifacts));
		}
		taskResults.push(aggregateTaskRuns(task.id, runs));
	}

	// Build result, write, print
	const gitSha = getGitSha();
	const modelName = await getModelName();
	const result = buildResult(taskResults, gitSha, modelName);
	const outPath = await writeResults(result, EVALS_DIR);
	printSummary(result);
	console.log(`Results written to: ${outPath}`);
}

main().catch((err) => {
	console.error('Fatal:', err.message);
	process.exit(1);
});
