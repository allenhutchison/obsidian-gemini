/**
 * Thin wrapper around the `obsidian` CLI for driving agent sessions.
 * All Obsidian interaction runs through `obsidian eval code="..."`.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const OBSIDIAN_BIN = 'obsidian';
const EVAL_TIMEOUT_MS = 10_000;

/**
 * Run a JavaScript expression inside the live Obsidian process via CLI.
 * Returns the stringified result.
 */
export async function obsidianEval(code, { timeoutMs = EVAL_TIMEOUT_MS } = {}) {
	const { stdout } = await exec(OBSIDIAN_BIN, ['eval', `code=${code}`], {
		timeout: timeoutMs,
	});
	const raw = stdout.trim();
	if (raw.startsWith('=>')) return raw.slice(2).trim();
	return raw;
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
	const result = await obsidianEval(
		`(async () => {
    const p = app.plugins.plugins['gemini-scribe'];
    const session = await p.sessionManager.createAgentSession('${title}');
    // Load the session in the agent view
    await p.agentView?.session?.loadSession(session);
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
	const escapedFiles = JSON.stringify(files).replace(/'/g, "\\'").replace(/\\/g, '\\\\');
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
	const escaped = text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
	await obsidianEval(
		`(async () => {
    const p = app.plugins.plugins['gemini-scribe'];
    await p.agentView.sendMessageProgrammatically(\`${escaped}\`);
    return '"sent"';
  })()`,
		{ timeoutMs: 300_000 }
	);
}

/**
 * Clean up eval artifacts: scratch folder and session history.
 */
export async function cleanup(sessionHistoryPath) {
	await obsidianEval(
		`(async () => {
    const vault = app.vault;
    // Delete scratch folder recursively
    const scratch = vault.getAbstractFileByPath('eval-scratch');
    if (scratch) await vault.delete(scratch, true);
    // Delete session history
    if ('${sessionHistoryPath}') {
      const hist = vault.getAbstractFileByPath('${sessionHistoryPath}');
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
