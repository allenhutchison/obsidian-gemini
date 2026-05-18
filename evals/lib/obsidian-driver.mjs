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
 * Populate the current agent session's shelf with the given vault paths so
 * subsequent turns receive the rendered file content via `perTurnContext`,
 * mirroring the user-facing drag-and-drop / @-mention flow.
 *
 * Must be called AFTER createSession() so `agentView.currentSession` and
 * `agentView.shelf` reference the session under test. Throws if a path
 * doesn't resolve to a vault TFile — that's an eval-task authoring error,
 * not something the harness should silently paper over.
 *
 * Used by tasks that test context-chip behavior (e.g. "context-from-shelf"):
 * the file lives on disk via setupFixtures, then this routine threads it
 * into the agent context the same way the user would.
 */
export async function addContextFiles(paths) {
	if (!Array.isArray(paths) || paths.length === 0) return;
	const pathsLiteral = JSON.stringify(paths);
	await obsidianEval(
		`(async () => {
    const p = app.plugins.plugins['gemini-scribe'];
    const session = p.agentView?.currentSession;
    if (!session) throw new Error('addContextFiles: no current session — call createSession() first');
    const paths = ${pathsLiteral};
    const missing = [];
    for (const path of paths) {
      const file = app.vault.getAbstractFileByPath(path);
      if (!file) { missing.push(path); continue; }
      p.agentView.addContextFileToShelf(file);
      // Also persist into the session context so loadSession round-trips
      // would hydrate the shelf — same code path as the user's @ pick.
      p.agentView.context?.addFileToContext(file, session);
    }
    if (missing.length) throw new Error('addContextFiles: not found in vault: ' + missing.join(', '));
    return JSON.stringify({ shelf: p.agentView.shelf.getItems().map(i => i.path).filter(Boolean) });
  })()`,
		{ timeoutMs: 10_000 }
	);
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
 * Place files at arbitrary vault paths before a task runs.
 *
 * Unlike `setupFixtures` (which always targets `eval-scratch/`), this writes
 * to caller-chosen paths so tasks can pre-seed plugin state that lives outside
 * the scratch folder — e.g. `AGENTS.md` for memory tests, an `Agent-Sessions/`
 * history file for recall tests, or a `Skills/<name>/SKILL.md` package.
 *
 * `entries` is an array of `{ path, content }`. Parent folders are created as
 * needed. Returns `{ manifest, error }` where `manifest` records, per seeded
 * path, whether the file pre-existed and (if so) its original content — so
 * `cleanup` can restore an overwritten file instead of deleting a real user
 * file. On partial failure the manifest still covers everything seeded so far
 * and `error` carries the message; the caller cleans up, then surfaces it.
 */
export async function setupExtraFiles(entries) {
	if (!Array.isArray(entries) || entries.length === 0) return { manifest: [], error: null };
	const result = await obsidianEval(
		`(async () => {
    const vault = app.vault;
    const entries = ${JSON.stringify(entries)};
    const manifest = [];
    try {
      for (const e of entries) {
        const parts = e.path.split('/');
        parts.pop();
        let dir = '';
        for (const part of parts) {
          dir = dir ? dir + '/' + part : part;
          if (!vault.getAbstractFileByPath(dir)) await vault.createFolder(dir);
        }
        const existing = vault.getAbstractFileByPath(e.path);
        if (existing) {
          // Capture the original before overwriting. If the read fails we must
          // NOT modify the file — we would be unable to restore it on cleanup.
          // Letting the error propagate to the outer catch is fail-closed: the
          // entry never reaches the manifest and the runner surfaces the error.
          const original = await vault.read(existing);
          manifest.push({ path: e.path, preExisted: true, originalContent: original });
          await vault.modify(existing, e.content);
        } else {
          manifest.push({ path: e.path, preExisted: false, originalContent: null });
          await vault.create(e.path, e.content);
        }
      }
      return JSON.stringify({ manifest, error: null });
    } catch (err) {
      return JSON.stringify({ manifest, error: err instanceof Error ? err.message : String(err) });
    }
  })()`,
		{ timeoutMs: 15_000 }
	);
	return JSON.parse(result);
}

/**
 * Snapshot the post-run state of the given vault paths for `vaultAssertions`.
 *
 * Returns `{ [path]: { exists, content, frontmatter } }`. Missing files report
 * `exists: false`. Frontmatter comes from `metadataCache`, which has settled by
 * the time the harness reads it (several CLI round-trips happen after the turn
 * ends). Pure assertion evaluation lives in `vault-assertions.mjs`.
 */
export async function readVaultState(paths) {
	if (!Array.isArray(paths) || paths.length === 0) return {};
	const pathsLiteral = JSON.stringify(paths);
	const result = await obsidianEval(
		`(async () => {
    const out = {};
    for (const path of ${pathsLiteral}) {
      const file = app.vault.getAbstractFileByPath(path);
      if (!file || !('extension' in file)) {
        out[path] = { exists: false, content: null, frontmatter: null };
        continue;
      }
      let content = null;
      try { content = await app.vault.read(file); } catch { content = null; }
      const cache = app.metadataCache.getFileCache(file);
      out[path] = { exists: true, content, frontmatter: (cache && cache.frontmatter) || null };
    }
    return JSON.stringify(out);
  })()`,
		{ timeoutMs: 15_000 }
	);
	return JSON.parse(result);
}

/**
 * Send a message to the agent via the programmatic API.
 * Returns after dispatch; the runner waits for `turnEnd` / `turnError` via
 * the event collector. Do not await the full agent turn inside this eval call:
 * keeping a CLI child open for the whole model request is what made sweeps
 * vulnerable to mid-suite CLI bridge hangs (#778).
 */
export async function sendMessage(text) {
	// JSON.stringify produces a safely quoted/escaped JS string literal that can
	// be inlined directly into the eval code, avoiding hand-rolled escaping.
	const textLiteral = JSON.stringify(text);
	await obsidianEval(
		`(async () => {
    const p = app.plugins.plugins['gemini-scribe'];
    const sendToken = (window.__evalLastDispatchToken ?? 0) + 1;
    window.__evalLastDispatchToken = sendToken;
    window.__evalLastSendError = null;
    const run = p.agentView.sendMessageProgrammatically(${textLiteral});
    run.catch((err) => {
      if (window.__evalLastDispatchToken === sendToken) {
        window.__evalLastSendError = err instanceof Error ? err.message : String(err);
      }
    });
    return '"sent"';
  })()`,
		{ timeoutMs: 15_000 }
	);
}

/**
 * Read and clear the last async send failure captured by sendMessage().
 */
export async function readAndClearLastSendError() {
	const result = await obsidianEval(
		`(() => {
    const error = window.__evalLastSendError ?? null;
    window.__evalLastSendError = null;
    return JSON.stringify(error);
  })()`,
		{ timeoutMs: 2_000 }
	);
	return JSON.parse(result);
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
 * Clean up eval artifacts: scratch folder, session history, and any files
 * placed outside `eval-scratch/` by `setupExtraFiles`.
 *
 * `setupManifest` is the array returned by `setupExtraFiles` —
 * `{ path, preExisted, originalContent }` per seeded file. A path the seeding
 * step *created* is deleted; a path that *pre-existed* is restored to its
 * original content rather than deleted, so a memory / recall / skill task
 * never destroys a real user file (e.g. an `AGENTS.md` already in the vault).
 */
export async function cleanup(sessionHistoryPath, setupManifest = []) {
	const pathLiteral = JSON.stringify(sessionHistoryPath || '');
	const manifestLiteral = JSON.stringify(Array.isArray(setupManifest) ? setupManifest : []);
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
    // Undo setup files placed outside eval-scratch: restore overwritten files,
    // delete files the harness created.
    for (const m of ${manifestLiteral}) {
      const f = vault.getAbstractFileByPath(m.path);
      if (!f) continue;
      if (m.preExisted) {
        if (typeof m.originalContent === 'string') await vault.modify(f, m.originalContent);
      } else {
        await vault.delete(f, true);
      }
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
