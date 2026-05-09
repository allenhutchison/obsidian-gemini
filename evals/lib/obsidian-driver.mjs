/**
 * Thin wrapper around the `obsidian` CLI for driving agent sessions.
 * All Obsidian interaction runs through `obsidian eval code="..."`.
 */

import { runWithTimeout } from './spawn-with-timeout.mjs';

const OBSIDIAN_BIN = 'obsidian';
const EVAL_TIMEOUT_MS = 10_000;

/**
 * Run a JavaScript expression inside the live Obsidian process via CLI.
 * Returns the stringified result.
 *
 * The CLI may interleave log lines (e.g. `[Gemini Scribe] …`) before the
 * actual reply line, so we locate the line beginning with `=> ` and treat
 * everything from there to the end of stdout as the reply value. This
 * preserves multi-line reply support (when the returned value contains
 * real newlines) while filtering out plugin/console log noise.
 *
 * Uses `runWithTimeout` (not `execFile`) for the underlying spawn — the
 * default `execFile` timeout sends SIGTERM and waits for the child to
 * exit, but we observed during the multi-model baselines (#776) that
 * the obsidian CLI sometimes ignores SIGTERM and keeps the parent
 * blocked forever. `runWithTimeout` escalates to SIGKILL after a grace
 * window so the parent always settles within bounded time.
 */
export async function obsidianEval(code, { timeoutMs = EVAL_TIMEOUT_MS } = {}) {
	const result = await runWithTimeout(OBSIDIAN_BIN, ['eval', `code=${code}`], { timeoutMs });
	// Surface CLI failures before parsing. A real failure (auth, plugin not
	// loaded, malformed eval) tends to land on stderr with a non-zero exit;
	// without this guard we'd fall through to the "=> reply" parser and
	// throw a confusing "did not return a reply" error that obscures the
	// actual cause.
	if (result.code !== 0 || result.signal !== null) {
		const stderrTail = result.stderr ? ` Stderr: ${result.stderr.slice(0, 300)}` : '';
		throw new Error(`obsidian eval failed (exit=${result.code}, signal=${result.signal}).${stderrTail}`);
	}
	const lines = result.stdout.split('\n');
	const replyIdx = lines.findIndex((l) => l.startsWith('=>'));
	if (replyIdx === -1) {
		throw new Error(`obsidian eval did not return a "=>" reply. Stdout was:\n${result.stdout.slice(0, 500)}`);
	}
	const replyLines = lines.slice(replyIdx);
	replyLines[0] = replyLines[0].slice(2); // strip leading "=>"
	return replyLines.join('\n').trim();
}

/**
 * Read a single key from the plugin's in-memory settings.
 *
 * Returns whatever is currently on `plugin.settings[key]` (including null
 * or undefined for unset keys). Does not touch disk — pairs with `setSetting`
 * to apply transient overrides for an eval run.
 */
export async function getSetting(key) {
	const keyLiteral = JSON.stringify(key);
	const result = await obsidianEval(
		`JSON.stringify(app.plugins.plugins['gemini-scribe'].settings[${keyLiteral}] ?? null)`
	);
	return JSON.parse(result);
}

/**
 * Mutate a single key on the plugin's in-memory settings without persisting.
 *
 * Used for transient eval-run overrides (e.g. `--model=` flag). Does NOT
 * call `saveSettings()` — that would trigger a full plugin reinit, which
 * is overkill for keys like `chatModelName` that are read fresh from
 * `plugin.settings` per-request.
 */
export async function setSetting(key, value) {
	const keyLiteral = JSON.stringify(key);
	const valueLiteral = JSON.stringify(value);
	await obsidianEval(
		`(() => {
    app.plugins.plugins['gemini-scribe'].settings[${keyLiteral}] = ${valueLiteral};
    return '"set"';
  })()`
	);
}

/**
 * Verify the plugin is loaded and the agent view is available.
 */
export async function verifyPlugin() {
	const result = await obsidianEval(`(() => {
    const p = app.plugins.plugins['gemini-scribe'];
    if (!p) return JSON.stringify({ ok: false, error: 'plugin not loaded' });
    if (!p.agentView) return JSON.stringify({ ok: false, error: 'agent view not found' });
    return JSON.stringify({ ok: true, version: p.manifest.version });
  })()`);
	return JSON.parse(result);
}

/**
 * Create a fresh agent session with the given title.
 * Returns { sessionId, historyPath }.
 */
export async function createSession(title) {
	const titleLiteral = JSON.stringify(title);
	const result = await obsidianEval(
		`(async () => {
    const p = app.plugins.plugins['gemini-scribe'];
    // Empty requireConfirmation so the session metadata doesn't ask for
    // confirmation. (The real gate is settings.toolPermissions, which we
    // bypass via allowedWithoutConfirmation below.)
    const session = await p.sessionManager.createAgentSession(${titleLiteral}, { requireConfirmation: [] });
    // Use AgentView.loadSession (the public method) — it updates both the
    // session controller AND AgentView's own currentSession field. Calling
    // the controller's loadSession directly leaves AgentView.currentSession
    // pointing at the previously-loaded session, so messages get persisted
    // to the wrong session and the harness reads back stale history.
    await p.agentView.loadSession(session);
    // Pre-approve every registered tool for this session so write_file /
    // delete_file / fetch_url etc. don't pop a UI confirmation mid-eval.
    // loadSession() clears this set, so it must run AFTER the load.
    for (const tool of p.toolRegistry?.getAllTools?.() || []) {
      p.agentView.allowToolWithoutConfirmation(tool.name);
    }
    return JSON.stringify({ sessionId: session.id, historyPath: session.historyPath });
  })()`,
		{ timeoutMs: 15_000 }
	);
	return JSON.parse(result);
}

/**
 * Copy fixture files into the vault's eval-scratch folder.
 * fixtureFiles is an array of { name, content } objects.
 */
export async function setupFixtures(files) {
	await obsidianEval(
		`(async () => {
    const vault = app.vault;
    const folder = 'eval-scratch';
    const existing = vault.getAbstractFileByPath(folder);
    if (!existing) await vault.createFolder(folder);
    const files = ${JSON.stringify(files)};
    for (const f of files) {
      const path = folder + '/' + f.name;
      const existingFile = vault.getAbstractFileByPath(path);
      if (existingFile) await vault.modify(existingFile, f.content);
      else await vault.create(path, f.content);
    }
    return '"fixtures ready"';
  })()`,
		{ timeoutMs: 15_000 }
	);
}

/**
 * Send a message to the agent via the programmatic API.
 * Returns immediately — use waitForTurnEnd() to wait.
 */
export async function sendMessage(text) {
	// JSON.stringify produces a safely quoted/escaped JS string literal that can
	// be inlined directly into the eval code, avoiding hand-rolled escaping.
	const textLiteral = JSON.stringify(text);
	await obsidianEval(
		`(async () => {
    const p = app.plugins.plugins['gemini-scribe'];
    await p.agentView.sendMessageProgrammatically(${textLiteral});
    return '"sent"';
  })()`,
		{ timeoutMs: 300_000 }
	);
}

/**
 * Ask the running plugin to cancel the in-flight agent run. Best-effort —
 * calls AgentView's cancellation hook if available; swallows errors so the
 * caller can continue with cleanup even if the plugin has already moved on.
 *
 * Used both by the per-task timeout path (to stop the agent before scoring
 * the partial state) and by the SIGINT handler (to avoid leaving an
 * orphaned agent loop chewing on tools after the harness exits).
 */
export async function cancelAgent() {
	try {
		await obsidianEval(
			`(() => {
        const p = app.plugins.plugins['gemini-scribe'];
        try {
          if (p?.agentView?.cancelCurrentRun) p.agentView.cancelCurrentRun();
          else if (p?.agentView?.cancel) p.agentView.cancel();
          return '"cancelled"';
        } catch { return '"cancel-failed"'; }
      })()`,
			{ timeoutMs: 5_000 }
		);
	} catch {
		// Squash — best-effort by design.
	}
}

/**
 * Clean up eval artifacts: scratch folder and session history.
 */
export async function cleanup(sessionHistoryPath) {
	const pathLiteral = JSON.stringify(sessionHistoryPath || '');
	await obsidianEval(
		`(async () => {
    const vault = app.vault;
    // Delete scratch folder recursively
    const scratch = vault.getAbstractFileByPath('eval-scratch');
    if (scratch) await vault.delete(scratch, true);
    // Delete session history
    const histPath = ${pathLiteral};
    if (histPath) {
      const hist = vault.getAbstractFileByPath(histPath);
      if (hist) await vault.delete(hist);
    }
    return '"cleaned"';
  })()`,
		{ timeoutMs: 15_000 }
	);
}

/**
 * Read the last model response text from the current session.
 */
export async function getLastModelResponse() {
	const result = await obsidianEval(
		`(async () => {
    const p = app.plugins.plugins['gemini-scribe'];
    const session = p.agentView?.session?.getCurrentSession?.() ||
      p.agentView?.currentSession;
    if (!session) return JSON.stringify({ text: '' });
    const history = await p.sessionHistory.getHistoryForSession(session);
    const modelEntries = history.filter(e => e.role === 'model');
    const last = modelEntries[modelEntries.length - 1];
    return JSON.stringify({ text: last?.message || '' });
  })()`,
		{ timeoutMs: 10_000 }
	);
	return JSON.parse(result).text;
}
