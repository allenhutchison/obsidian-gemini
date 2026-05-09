import { describe, it, expect } from 'vitest';
import { runWithTimeout, SIGKILL_GRACE_MS } from '../../evals/lib/spawn-with-timeout.mjs';

const NODE = process.execPath;

/**
 * Spawn `node -e <script>` so tests can drive child behavior precisely
 * (exit codes, output, ignoring signals) without depending on Obsidian.
 */
function nodeScript(script: string): [string, string[]] {
	return [NODE, ['-e', script]];
}

describe('runWithTimeout — happy path', () => {
	it('resolves with stdout/stderr when the child exits cleanly', async () => {
		const [bin, args] = nodeScript(`process.stdout.write("hello"); process.stderr.write("warn");`);
		const result = await runWithTimeout(bin, args, { timeoutMs: 5_000 });
		expect(result.stdout).toBe('hello');
		expect(result.stderr).toBe('warn');
		expect(result.code).toBe(0);
		expect(result.signal).toBeNull();
	});

	it('handles a multi-line reply', async () => {
		// Use process.stdout.write so literals in this fixture string don't
		// trip the repo's logger-only CI gate (the gate is text-based and
		// matches inside string literals).
		const [bin, args] = nodeScript(`process.stdout.write("line1\\nline2\\n");`);
		const result = await runWithTimeout(bin, args, { timeoutMs: 5_000 });
		expect(result.stdout).toContain('line1\n');
		expect(result.stdout).toContain('line2\n');
	});
});

describe('runWithTimeout — timeout escalation', () => {
	it('rejects with a timeout error when the child exceeds the deadline', async () => {
		// Sleeps 30s — well past our 200ms budget. The default SIGTERM should
		// kill it cleanly (node exits on SIGTERM), so escalation isn't needed.
		const [bin, args] = nodeScript(`setTimeout(() => process.exit(0), 30000);`);
		const start = Date.now();
		await expect(runWithTimeout(bin, args, { timeoutMs: 200 })).rejects.toThrow(/timed out after 200ms/);
		const elapsed = Date.now() - start;
		// Should land within timeoutMs + grace, plus a generous fudge for
		// process startup / event loop latency.
		expect(elapsed).toBeLessThan(200 + SIGKILL_GRACE_MS + 1500);
	});

	it('escalates to SIGKILL when the child ignores SIGTERM (this is the #776 case)', async () => {
		// Install a SIGTERM handler that does nothing — process stays alive
		// after SIGTERM. Only SIGKILL can stop it, which is exactly the
		// behavior we observed against the obsidian CLI in #776.
		const [bin, args] = nodeScript(`process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);`);
		const start = Date.now();
		await expect(runWithTimeout(bin, args, { timeoutMs: 200 })).rejects.toThrow(/escalated to SIGKILL/);
		const elapsed = Date.now() - start;
		// Must settle within the SIGTERM deadline + grace window (with
		// reasonable margin for process startup + event-loop scheduling).
		expect(elapsed).toBeLessThan(200 + SIGKILL_GRACE_MS + 1500);
		// And the bound is tight enough that the previous (no-escalation)
		// behavior would have hung indefinitely; assert we're well under
		// any time it would have taken to "naturally" exit.
		expect(elapsed).toBeLessThan(5_000);
	}, 10_000);
});

describe('runWithTimeout — output ceiling', () => {
	it('rejects when combined stdout+stderr exceeds maxOutputBytes', async () => {
		// Write 200 KB of stdout — well above our 10 KB cap.
		const [bin, args] = nodeScript(`process.stdout.write("x".repeat(200000)); setTimeout(() => process.exit(0), 100);`);
		await expect(runWithTimeout(bin, args, { timeoutMs: 5_000, maxOutputBytes: 10_000 })).rejects.toThrow(
			/exceeded 10000 bytes of output/
		);
	});

	it('does not trip the ceiling for output strictly under the limit', async () => {
		const [bin, args] = nodeScript(`process.stdout.write("x".repeat(500));`);
		const result = await runWithTimeout(bin, args, { timeoutMs: 5_000, maxOutputBytes: 1000 });
		expect(result.stdout.length).toBe(500);
	});
});

describe('runWithTimeout — error paths', () => {
	it('rejects when the binary does not exist', async () => {
		await expect(runWithTimeout('/this/path/does/not/exist/xyz123', [], { timeoutMs: 2_000 })).rejects.toThrow();
	});

	it('non-zero exit codes are reported, not treated as errors', async () => {
		// `runWithTimeout` resolves on close regardless of exit code — the
		// caller decides what to do with non-zero. Mirrors how `obsidianEval`
		// inspects stdout content rather than exit code.
		const [bin, args] = nodeScript(`process.exit(7);`);
		const result = await runWithTimeout(bin, args, { timeoutMs: 5_000 });
		expect(result.code).toBe(7);
	});
});
