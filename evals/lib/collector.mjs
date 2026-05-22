/**
 * Event-bus collector. Installs a temporary subscriber inside Obsidian
 * (via eval) that captures agent lifecycle events into a global array.
 * The runner reads and clears the array after each task.
 */

import { obsidianEval } from './obsidian-driver.mjs';

/**
 * Max characters of a tool result's `data` kept in a captured event. Tool
 * results can be whole files or full vault listings; the `obsidian eval` CLI
 * bridge caps total output at ~1 MB, so an untruncated result could overflow
 * the bridge and break the run. Truncation happens here, inside Obsidian,
 * before the data ever crosses the bridge.
 */
const TRANSCRIPT_DATA_LIMIT = 2048;

/**
 * Install the event collector on the plugin's agent event bus.
 * Captured events are pushed to `window.__evalCollector`.
 *
 * Tool results are reduced to `{ success, error, data, inlineDataOmitted }`:
 * `data` is stringified and truncated to `TRANSCRIPT_DATA_LIMIT`, and binary
 * `inlineData` (base64 blobs, useless in a transcript) is dropped, leaving
 * only its count. This keeps the captured stream — which #869 persists as the
 * per-run transcript — both informative and bounded.
 */
export async function installCollector() {
	await obsidianEval(`(() => {
    window.__evalCollector = [];
    window.__evalUnsubscribers = window.__evalUnsubscribers || [];
    // Clean up any previous collectors
    for (const unsub of window.__evalUnsubscribers) unsub();
    window.__evalUnsubscribers = [];

    const LIMIT = ${TRANSCRIPT_DATA_LIMIT};
    const sanitizeResult = (r) => {
      if (!r || typeof r !== 'object') return r;
      const out = { success: r.success, error: r.error || undefined };
      if (r.data !== undefined) {
        let s;
        try { s = typeof r.data === 'string' ? r.data : JSON.stringify(r.data); }
        catch (e) { s = '[unserializable]'; }
        out.data = s.length > LIMIT
          ? s.slice(0, LIMIT) + '... [+' + (s.length - LIMIT) + ' chars truncated]'
          : s;
      }
      if (Array.isArray(r.inlineData) && r.inlineData.length > 0) {
        out.inlineDataOmitted = r.inlineData.length;
      }
      return out;
    };

    const bus = app.plugins.plugins['gemini-scribe'].agentEventBus;
    const events = [
      'turnStart', 'turnEnd', 'turnError',
      'apiResponseReceived',
      'toolExecutionComplete', 'toolChainComplete'
    ];

    for (const name of events) {
      const unsub = bus.on(name, async (payload) => {
        const serializable = {};
        for (const [k, v] of Object.entries(payload)) {
          if (k === 'session') {
            serializable.sessionId = v.id;
          } else if (k === 'result' && v && typeof v === 'object') {
            serializable.result = sanitizeResult(v);
          } else if (k === 'toolResults' && Array.isArray(v)) {
            // toolChainComplete carries a batch of results; sanitize each so a
            // base64 inlineData blob can't overflow the CLI bridge.
            serializable.toolResults = v.map((tr) => ({
              toolName: tr.toolName,
              toolArguments: tr.toolArguments,
              result: sanitizeResult(tr.result)
            }));
          } else if (k === 'error' && v instanceof Error) {
            serializable.error = v.message;
          } else {
            serializable[k] = v;
          }
        }
        window.__evalCollector.push({
          event: name,
          timestamp: Date.now(),
          payload: serializable
        });
      }, 900);
      window.__evalUnsubscribers.push(unsub);
    }
    return '"collector installed"';
  })()`);
}

/**
 * Read all captured events without clearing them. Used by the progress
 * poller to render mid-run "[turn N | M tool calls | …]" lines while the
 * agent is still working — the final read+clear happens once the turn
 * actually ends.
 */
export async function peekCollector() {
	const raw = await obsidianEval(`(() => JSON.stringify(window.__evalCollector || []))()`);
	try {
		return JSON.parse(raw);
	} catch (err) {
		throw new Error(`Failed to parse collector events: ${err.message}. Raw output: ${raw.slice(0, 200)}`);
	}
}

/**
 * Read all captured events and clear the collector.
 * Returns an array of { event, timestamp, payload } objects.
 */
export async function readAndClearCollector() {
	const raw = await obsidianEval(`(() => {
    const events = window.__evalCollector || [];
    window.__evalCollector = [];
    return JSON.stringify(events);
  })()`);
	try {
		return JSON.parse(raw);
	} catch (err) {
		// obsidianEval can return error strings or other unexpected output if
		// the eval inside Obsidian crashes — surface the raw payload so the
		// caller knows why parsing failed.
		throw new Error(`Failed to parse collector events: ${err.message}. Raw output: ${raw.slice(0, 200)}`);
	}
}

/**
 * Uninstall all collector subscribers and clean up globals.
 */
export async function removeCollector() {
	await obsidianEval(`(() => {
    for (const unsub of (window.__evalUnsubscribers || [])) unsub();
    window.__evalUnsubscribers = [];
    delete window.__evalCollector;
    return '"collector removed"';
  })()`);
}
