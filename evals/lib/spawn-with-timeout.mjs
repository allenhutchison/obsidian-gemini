/**
 * Spawn a child process with a hard timeout that escalates to SIGKILL.
 *
 * Why this exists: `execFile` (with the built-in `timeout` option) sends
 * SIGTERM when the deadline fires and then waits for the child to exit.
 * If the child ignores SIGTERM, the parent's promise never resolves —
 * which is exactly the failure mode we observed against the Obsidian CLI
 * during the multi-model baseline runs (#776). Stale CLI children sat at
 * 0 CPU, the parent harness waited forever, and a 21-run sweep would
 * stall mid-suite.
 *
 * `runWithTimeout` wraps `spawn` with a two-stage cancellation:
 *
 *   1. At `timeoutMs`, send SIGTERM and start a `SIGKILL_GRACE_MS` timer.
 *   2. If the child is still alive after the grace window, send SIGKILL.
 *
 * SIGKILL can't be ignored by user-space code, so the parent's promise
 * is guaranteed to settle within `timeoutMs + SIGKILL_GRACE_MS`. This
 * isolates the CLI-bridge wedging behavior from the rest of the harness.
 *
 * The helper is intentionally generic (takes any bin + args), so the
 * unit tests can drive it with `node -e "setTimeout(...)"` instead of
 * needing a real Obsidian instance.
 */

import { spawn } from 'node:child_process';

/** How long after SIGTERM we wait before escalating to SIGKILL. */
export const SIGKILL_GRACE_MS = 1_000;

/**
 * Default ceiling on combined stdout + stderr bytes the parent will buffer.
 * Mirrors execFile's historical 1 MB `maxBuffer` default. Beyond this we
 * SIGKILL the child and reject — a noisy or wedged child mustn't OOM the
 * harness before the timeout path fires.
 */
export const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

/**
 * Run `bin args` and resolve with `{ stdout, stderr, code, signal }` once
 * the child exits cleanly. On timeout, rejects with a descriptive Error
 * after the SIGTERM → SIGKILL escalation. On output exceeding
 * `maxOutputBytes`, kills the child immediately with SIGKILL and rejects.
 *
 * @param {string} bin - Executable to spawn
 * @param {string[]} args - Arguments
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=10000] - Hard deadline for child completion
 * @param {string|null} [opts.stdinData=null] - Optional bytes to write to stdin (then closed)
 * @param {number} [opts.maxOutputBytes=1048576] - Combined stdout+stderr ceiling
 * @returns {Promise<{ stdout: string, stderr: string, code: number|null, signal: string|null }>}
 */
export function runWithTimeout(
	bin,
	args,
	{ timeoutMs = 10_000, stdinData = null, maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES } = {}
) {
	return new Promise((resolve, reject) => {
		const child = spawn(bin, args, {
			stdio: [stdinData === null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
		});

		if (stdinData !== null) {
			child.stdin.end(stdinData);
		}

		let stdout = '';
		let stderr = '';
		let outputBytes = 0;
		let timedOut = false;
		let escalated = false;
		let outputExceeded = false;
		let killTimer = null;

		child.stdout.setEncoding('utf-8');
		child.stderr.setEncoding('utf-8');

		// Drop chunks once we've crossed maxOutputBytes; the kill is in flight,
		// further accumulation just wastes memory while we wait for `close`.
		const accumulate = (which) => (chunk) => {
			if (outputExceeded) return;
			outputBytes += Buffer.byteLength(chunk, 'utf-8');
			if (outputBytes > maxOutputBytes) {
				outputExceeded = true;
				try {
					child.kill('SIGKILL');
				} catch {
					// Already gone; close event will fire shortly.
				}
				return;
			}
			if (which === 'stdout') stdout += chunk;
			else stderr += chunk;
		};
		child.stdout.on('data', accumulate('stdout'));
		child.stderr.on('data', accumulate('stderr'));

		// Settle on `exit` rather than `close`. `close` only fires once every
		// stdio handle has closed, which can lag the process death by an
		// unbounded amount when the child has spawned long-lived helpers
		// that inherit its stdio — obsidian's Electron app has exactly that
		// shape. Using `exit` keeps the documented `timeoutMs +
		// SIGKILL_GRACE_MS` settlement bound load-bearing.
		//
		// `settled` guards against double-settlement when both `error` and
		// `exit` fire (rare but possible on spawn failure into immediate
		// exit), and against race conditions if a future change reintroduces
		// a `close` listener.
		let settled = false;
		const settle = (action) => {
			if (settled) return;
			settled = true;
			clearTimeout(termTimer);
			if (killTimer) clearTimeout(killTimer);
			action();
		};

		const termTimer = setTimeout(() => {
			timedOut = true;
			try {
				child.kill('SIGTERM');
			} catch {
				// Child may already be exiting; harmless.
			}
			// Escalate to SIGKILL if SIGTERM was ignored. `exitCode` and
			// `signalCode` are both null while the child is still running;
			// either becomes non-null on actual exit.
			killTimer = setTimeout(() => {
				if (child.exitCode === null && child.signalCode === null) {
					escalated = true;
					try {
						child.kill('SIGKILL');
					} catch {
						// Already gone; the exit event will fire shortly anyway.
					}
				}
			}, SIGKILL_GRACE_MS);
		}, timeoutMs);

		child.on('error', (err) => {
			settle(() => reject(err));
		});

		child.on('exit', (code, signal) => {
			settle(() => {
				if (outputExceeded) {
					return reject(
						new Error(`Command \`${bin} ${args.join(' ')}\` exceeded ${maxOutputBytes} bytes of output and was killed.`)
					);
				}
				if (timedOut) {
					const escalation = escalated ? ' (escalated to SIGKILL)' : '';
					const stderrTail = stderr ? ` Stderr: ${stderr.slice(0, 300)}` : '';
					return reject(
						new Error(`Command \`${bin} ${args.join(' ')}\` timed out after ${timeoutMs}ms${escalation}.${stderrTail}`)
					);
				}
				resolve({ stdout, stderr, code, signal });
			});
		});
	});
}
