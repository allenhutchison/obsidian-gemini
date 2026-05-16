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
	addContextFiles,
	sendMessage,
	readAndClearLastSendError,
	cancelAgent,
	cleanup,
	getLastModelResponse,
	obsidianEval,
	getSetting,
	setSetting,
} from './lib/obsidian-driver.mjs';
import { installCollector, peekCollector, readAndClearCollector, removeCollector } from './lib/collector.mjs';
import { scoreTask } from './lib/scorer.mjs';
import { aggregateTaskRuns, buildResult, writeResults, printSummary } from './lib/reporter.mjs';
import { compareResults, loadBaseline, printRegressionSummary, getBaselinePath } from './lib/compare.mjs';
import { createJudge } from './lib/judge.mjs';
import { summarizeProgress, formatProgressLine, progressChanged } from './lib/progress.mjs';
import { waitForTurnCompletion } from './lib/turn-waiter.mjs';

const EVALS_DIR = resolve(import.meta.dirname);

const DEFAULT_REPEAT = 3;
// Default per-task wall-clock budget. Tasks may override via `timeoutMs`. Hits
// the timeout path in runTask and counts as a non-pass for `pass^k`.
const DEFAULT_TASK_TIMEOUT_MS = 5 * 60 * 1000;
// How often the progress poller wakes up to read window.__evalCollector. ~2s
// keeps the operator's "is this thing alive?" feedback loop short without
// hammering the obsidian CLI bridge.
const PROGRESS_POLL_INTERVAL_MS = 2_000;
function parseArgs() {
	const args = process.argv.slice(2);
	const repeatArg = args.find((a) => a.startsWith('--repeat='))?.split('=')[1];
	const repeat = repeatArg ? parseInt(repeatArg, 10) : DEFAULT_REPEAT;
	if (!Number.isInteger(repeat) || repeat < 1) {
		throw new Error(`--repeat must be a positive integer, got "${repeatArg}"`);
	}
	// Use slice(1).join('=') so model ids containing '=' (none today, but
	// future-proof for things like cross-region prefixes) survive the split.
	const modelArg = args.find((a) => a.startsWith('--model='));
	const model = modelArg ? modelArg.slice('--model='.length) : null;
	if (model !== null && model.length === 0) {
		throw new Error('--model requires a non-empty value');
	}
	return {
		taskFilter: args.find((a) => a.startsWith('--task='))?.split('=')[1] || null,
		keepArtifacts: args.includes('--keep-artifacts'),
		repeat,
		model,
	};
}

// Module-scoped state shared with signal handlers so a Ctrl-C mid-run can:
//   - Restore the chat-model override (otherwise the user's plugin keeps the
//     eval's model long after the harness is gone).
//   - Cancel the in-flight agent loop in the plugin (otherwise tools keep
//     firing in the background).
//   - Clean the in-progress task's scratch files + session history (otherwise
//     eval-scratch leaks into the user's vault).
//   - Print a "N of M tasks completed" summary so the operator knows where
//     the run stopped.
let originalChatModel = null;
let modelWasOverridden = false;
let currentTaskInfo = null; // { taskId, sessionInfo, runIndex, repeat } when a task is mid-flight
let completedTaskCount = 0;
let totalPlannedTasks = 0;
let interruptInProgress = false;

async function restoreChatModel() {
	if (!modelWasOverridden) return;
	try {
		await setSetting('chatModelName', originalChatModel);
	} catch (err) {
		console.error(`Failed to restore chatModelName: ${err.message}`);
	}
	modelWasOverridden = false;
}

async function handleInterrupt(signal, exitCode) {
	// Re-entry guard: a second Ctrl-C arrives while we're still cleaning up
	// from the first. Without this the cleanup awaits race against each other.
	if (interruptInProgress) return;
	interruptInProgress = true;

	const inflight = currentTaskInfo;
	const completedLabel =
		totalPlannedTasks > 0 ? `${completedTaskCount} of ${totalPlannedTasks}` : `${completedTaskCount}`;
	console.log(`\n=== Interrupted (${signal}): ${completedLabel} tasks completed ===`);

	try {
		if (inflight) {
			const runLabel = inflight.repeat > 1 ? ` [run ${inflight.runIndex + 1}/${inflight.repeat}]` : '';
			console.log(`  in progress: ${inflight.taskId}${runLabel} — cancelling and cleaning up`);
			try {
				await cancelAgent();
			} catch (err) {
				console.warn(`  cancel warning: ${err.message}`);
			}
			try {
				await cleanup(inflight.sessionInfo?.historyPath);
			} catch (err) {
				console.warn(`  cleanup warning: ${err.message}`);
			}
		}
	} finally {
		// Always-run section. `runTask`'s finally would normally call
		// `removeCollector()`, but `process.exit` below skips that — so this
		// block has to fire even if the in-flight cleanup above threw, or we
		// leak `window.__evalCollector` and ~6 subscribers onto the agent
		// event bus until the user reloads the plugin (#777). The structural
		// `finally` is the contract: anything load-bearing for next-run state
		// goes here, not before the `try`.
		try {
			await removeCollector();
		} catch (err) {
			console.warn(`  collector cleanup warning: ${err.message}`);
		}
		await restoreChatModel();
		process.exit(exitCode);
	}
}

process.on('SIGINT', () => handleInterrupt('SIGINT', 130));
process.on('SIGTERM', () => handleInterrupt('SIGTERM', 143));

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

async function getProvider() {
	const result = await obsidianEval("app.plugins.plugins['gemini-scribe'].settings.provider || 'gemini'");
	return result.replace(/^["']|["']$/g, '');
}

async function runTask(task, keepArtifacts, provider, judgeFn) {
	const title = `[eval] ${task.id}`;
	console.log(`  "${task.description}"`);

	let sessionInfo;
	const startTime = Date.now();
	const taskTimeoutMs = task.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS;
	let timedOut = false;

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

		// Publish current task to module state so the SIGINT handler can find
		// the historyPath / sessionId for cleanup.
		if (currentTaskInfo) currentTaskInfo.sessionInfo = sessionInfo;

		// 2b. Optional: populate the session's context shelf with vault files.
		// Mirrors the user's drag-and-drop / @-mention flow so tasks can
		// exercise the perTurnContext path. Paths must resolve in the vault
		// (i.e. fixture files must already be present from step 1).
		if (Array.isArray(task.contextFiles) && task.contextFiles.length > 0) {
			console.log(`  Adding ${task.contextFiles.length} context file(s) to shelf...`);
			await addContextFiles(task.contextFiles);
		}

		// 3. Install collector
		await installCollector();

		// 4. Dispatch the user message, then observe terminal state via the
		// collector. `sendMessage` intentionally returns after dispatch instead
		// of holding an `obsidian eval` child open for the whole model turn; long
		// sweeps used to wedge when that CLI child got stuck after the plugin had
		// already emitted `turnEnd` (#778).
		console.log(`  Sending message... (budget ${Math.round(taskTimeoutMs / 1000)}s)`);
		await sendMessage(task.userMessage);
		const sendError = await readAndClearLastSendError();
		if (sendError) {
			await cancelAgent();
			throw new Error(`sendMessageProgrammatically failed: ${sendError}`);
		}

		let lastSummary = null;
		const waitResult = await waitForTurnCompletion({
			peekEvents: peekCollector,
			timeoutMs: taskTimeoutMs,
			pollIntervalMs: PROGRESS_POLL_INTERVAL_MS,
			onPoll: (events) => {
				const summary = summarizeProgress(events, startTime, Date.now(), task.maxTurns);
				if (progressChanged(lastSummary, summary)) {
					console.log(formatProgressLine(summary));
					lastSummary = summary;
				}
			},
		});

		if (!waitResult.completed) {
			timedOut = true;
			console.log(`  task exceeded ${Math.round(taskTimeoutMs / 1000)}s budget — cancelling agent.`);
			await cancelAgent();
		} else {
			console.log(`  Turn completed.`);
		}

		// 5. Read events and model response. Prefer the last snapshot from the
		// wait loop if a final read hits a transient CLI hiccup; the collector is
		// only an observability buffer, and scoring stale terminal events is
		// better than converting a completed model turn into a harness ERROR.
		let events;
		try {
			events = await readAndClearCollector();
		} catch (err) {
			if (!waitResult.completed) throw err;
			console.warn(`  Collector read warning: ${err.message}`);
			events = waitResult.events;
		}

		const modelResponse = timedOut ? '' : await getLastModelResponse();
		const durationMs = Date.now() - startTime;

		// 6. Score
		const modelName = await getModelName();
		const result = await scoreTask(task, events, modelResponse, modelName, durationMs, provider, judgeFn);
		if (timedOut) result.timedOut = true;
		const costStr = provider === 'ollama' ? 'free' : `$${result.metrics.cost_usd.toFixed(4)}`;
		const verdict = timedOut ? 'TIMEOUT' : result.solved ? 'SOLVED' : result.passed ? 'PASSED (not solved)' : 'FAILED';
		console.log(`  ${verdict} — ${result.metrics.turns} turns, ${result.metrics.tool_calls} tool calls, ${costStr}`);

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
				cached_tokens: provider === 'ollama' ? null : 0,
				cache_ratio: provider === 'ollama' ? null : 0,
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

/**
 * Look up the baseline for this run's (provider, model) and print a
 * regression summary if one exists. Missing baseline is informational, not
 * an error — the operator just hasn't run `eval:bless` yet.
 */
async function maybeCompareToBaseline(result) {
	let baseline;
	try {
		baseline = await loadBaseline(EVALS_DIR, result.provider, result.model);
	} catch (err) {
		console.warn(`\n[baseline] failed to load baseline: ${err.message}`);
		return;
	}
	if (!baseline) {
		const expected = getBaselinePath(EVALS_DIR, result.provider, result.model);
		console.log(`\n[baseline] no baseline at ${expected}`);
		console.log(`           run 'npm run eval:bless' to promote this result as the baseline.`);
		return;
	}
	const comparison = compareResults(baseline.content, result);
	printRegressionSummary(comparison);
}

async function main() {
	const { taskFilter, keepArtifacts, repeat, model } = parseArgs();
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

	// Apply the chat-model override BEFORE loading tasks so the result-file's
	// `model` field (read via getModelName at the end) reflects the override.
	if (model) {
		originalChatModel = await getSetting('chatModelName');
		await setSetting('chatModelName', model);
		modelWasOverridden = true;
		console.log(`Overriding chatModelName: ${originalChatModel ?? '(unset)'} → ${model}`);
	}

	try {
		// Load tasks
		const tasks = await loadTasks(taskFilter);
		if (tasks.length === 0) {
			console.error('No tasks found' + (taskFilter ? ` matching "${taskFilter}"` : '') + '.');
			process.exit(1);
		}
		console.log(`Running ${tasks.length} task(s) × ${repeat} run${repeat === 1 ? '' : 's'}...`);

		// Resolve provider once up front so per-run scoring stays consistent.
		const provider = await getProvider();

		// Initialize the LLM-as-judge once so prose-rubric tasks can opt in to
		// `{ type: 'judge', criteria: '...' }` matchers. The judge always uses a
		// pinned Gemini model (gemini-2.5-flash by default; `EVAL_JUDGE_MODEL`
		// env override) — independent of the system under test, so an Ollama
		// run still scores its prose tasks against a stable judge.
		const judgeFn = await createJudge();
		if (judgeFn) {
			console.log(`Judge: ${judgeFn.modelId}`);
		} else {
			const usingJudge = tasks.some((t) => (t.outputMatchers || []).some((m) => m?.type === 'judge'));
			if (usingJudge) {
				console.warn(
					'⚠ Tasks reference `judge` matchers but no Gemini API key is reachable; those matchers will fail.'
				);
			}
		}

		// Run tasks sequentially. Each task runs `repeat` times so we can report
		// pass^k reliability on top of per-run pass/solve rates. Module-scoped
		// task tracking lets the SIGINT handler print "N of M completed" and
		// clean up the in-progress task's scratch files.
		totalPlannedTasks = tasks.length * repeat;
		completedTaskCount = 0;
		const taskResults = [];
		for (const task of tasks) {
			const runs = [];
			for (let i = 0; i < repeat; i++) {
				const runLabel = repeat > 1 ? ` [run ${i + 1}/${repeat}]` : '';
				console.log(`\n--- Running: ${task.id}${runLabel} ---`);
				currentTaskInfo = { taskId: task.id, sessionInfo: null, runIndex: i, repeat };
				try {
					runs.push(await runTask(task, keepArtifacts, provider, judgeFn));
				} finally {
					currentTaskInfo = null;
					completedTaskCount += 1;
				}
			}
			taskResults.push(aggregateTaskRuns(task.id, runs));
		}

		// Build result, write, print
		const gitSha = getGitSha();
		const modelName = await getModelName();
		const result = buildResult(taskResults, gitSha, modelName, provider);
		const outPath = await writeResults(result, EVALS_DIR);
		printSummary(result);
		console.log(`Results written to: ${outPath}`);

		// Auto-compare against the blessed baseline for this (provider, model)
		// so the operator sees regressions without typing eval:compare.
		await maybeCompareToBaseline(result);
	} finally {
		await restoreChatModel();
	}
}

main().catch((err) => {
	console.error('Fatal:', err.message);
	process.exit(1);
});
