/**
 * Event-bus collector. Installs a temporary subscriber inside Obsidian
 * (via eval) that captures agent lifecycle events into a global array.
 * The runner reads and clears the array after each task.
 */

import { obsidianEval } from './obsidian-driver.mjs';

/**
 * Install the event collector on the plugin's agent event bus.
 * Captured events are pushed to `window.__evalCollector`.
 */
export async function installCollector() {
	await obsidianEval(`(() => {
    window.__evalCollector = [];
    window.__evalUnsubscribers = window.__evalUnsubscribers || [];
    // Clean up any previous collectors
    for (const unsub of window.__evalUnsubscribers) unsub();
    window.__evalUnsubscribers = [];

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
            serializable.result = { success: v.success, error: v.error || undefined };
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
