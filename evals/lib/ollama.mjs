/**
 * Minimal Ollama CLI helpers for the eval harness's model-orchestration mode
 * (#716). These shell out to the local `ollama` binary to inspect and control
 * which model is resident in memory, so a model-swap eval run doesn't
 * double-load (bring the new model up while the old one is still resident) and
 * so the first *timed* task excludes cold-start model-load latency.
 *
 * Every helper degrades gracefully when `ollama` isn't installed or reachable:
 * it logs a one-line warning and behaves as a no-op rather than aborting the
 * run. A Gemini run has no ollama server, and the harness must still work there
 * — these paths are only exercised when the active provider is Ollama.
 */

import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';

const execFileAsync = promisify(execFile);

const OLLAMA_BIN = process.env.OLLAMA_BIN || 'ollama';

function runOllama(args, { timeoutMs = 30_000 } = {}) {
	return execFileSync(OLLAMA_BIN, args, {
		encoding: 'utf8',
		timeout: timeoutMs,
		stdio: ['ignore', 'pipe', 'pipe'],
	});
}

// Async variant for the one potentially slow call (warmup): a cold-start model
// load can take many seconds, and a synchronous exec would block the event loop
// the whole time — starving the SIGINT/SIGTERM handlers that restore the
// operator's settings on Ctrl-C. `ollama ps`/`stop` stay synchronous (sub-second).
async function runOllamaAsync(args, { timeoutMs = 30_000 } = {}) {
	const { stdout } = await execFileAsync(OLLAMA_BIN, args, { encoding: 'utf8', timeout: timeoutMs });
	return stdout;
}

const firstLine = (message) => String(message ?? '').split('\n')[0];

/**
 * Return the model names currently resident in the Ollama server (the NAME
 * column of `ollama ps`). Empty array if nothing is loaded or if the ollama
 * CLI isn't available.
 */
export function ollamaResidentModels() {
	let out;
	try {
		out = runOllama(['ps']);
	} catch (err) {
		console.warn(`  [ollama] 'ollama ps' unavailable (${firstLine(err.message)}) — skipping resident-model check.`);
		return [];
	}
	// `ollama ps` prints a header row (NAME  ID  SIZE  PROCESSOR  UNTIL) then one
	// row per resident model. Take the first whitespace-delimited column of each
	// non-header, non-empty line.
	const lines = out
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean);
	if (lines.length <= 1) return []; // header only (or empty) => nothing resident
	return lines
		.slice(1)
		.map((line) => line.split(/\s+/)[0])
		.filter(Boolean);
}

/**
 * Ask Ollama to unload a resident model. Best-effort — a failure is logged and
 * swallowed; `waitForOllamaUnload` is the real gate on whether it cleared.
 */
export function ollamaStop(model) {
	try {
		runOllama(['stop', model]);
	} catch (err) {
		console.warn(`  [ollama] 'ollama stop ${model}' failed: ${firstLine(err.message)}`);
	}
}

/**
 * Poll `ollama ps` until `model` is no longer resident (or the timeout hits).
 * Returns true if the model unloaded, false on timeout.
 */
export async function waitForOllamaUnload(model, { timeoutMs = 120_000, pollMs = 2_000 } = {}) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (!ollamaResidentModels().includes(model)) return true;
		await sleep(pollMs);
	}
	return false;
}

/**
 * Unload every resident model that isn't `target` and wait for each to clear,
 * so the target loads into a clean slot instead of alongside the prior model.
 * No-op when `target` is already the only resident model or nothing is
 * resident. Returns the list of models it unloaded.
 */
export async function ensureResidentModel(target, { timeoutMs, pollMs } = {}) {
	const resident = ollamaResidentModels();
	const toUnload = resident.filter((m) => m !== target);
	for (const m of toUnload) {
		console.log(`  [ollama] unloading resident model '${m}' before loading '${target}'...`);
		ollamaStop(m);
		const cleared = await waitForOllamaUnload(m, { timeoutMs, pollMs });
		if (!cleared) {
			console.warn(`  [ollama] '${m}' still resident after wait — continuing anyway.`);
		}
	}
	return toUnload;
}

/**
 * Load `model` into memory with a throwaway generation so the first timed task
 * doesn't pay the cold-start load. Returns the warmup duration in ms, or 0 if
 * warmup was skipped because ollama is unavailable.
 */
export async function warmupOllamaModel(model) {
	const start = Date.now();
	try {
		// A tiny prompt is enough to force the model resident; the response is
		// discarded. Generous timeout — a large model's first load can be slow.
		// Async so the (potentially long) load doesn't block SIGINT cleanup.
		await runOllamaAsync(['run', model, 'Reply with the single word: ready'], { timeoutMs: 300_000 });
	} catch (err) {
		console.warn(
			`  [ollama] warmup for '${model}' failed: ${firstLine(err.message)} — first task may include load time.`
		);
		return 0;
	}
	return Date.now() - start;
}
