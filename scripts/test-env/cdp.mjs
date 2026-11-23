#!/usr/bin/env node
// Minimal Chrome DevTools Protocol client for the hidden test Obsidian started by
// scripts/test-env/launch.sh. Runs from Windows or WSL with Node 22+ (needs the
// global WebSocket and fetch).
//
//   node scripts/test-env/cdp.mjs eval <file.js>      evaluate a file's body (await allowed, `return` a value)
//   node scripts/test-env/cdp.mjs eval -e "<code>"    evaluate inline code
//   node scripts/test-env/cdp.mjs shot <out.png>      screenshot the main window
//   node scripts/test-env/cdp.mjs cdp <Method> [json] raw protocol call, e.g. Emulation.setDeviceMetricsOverride
//
// The code runs inside the Obsidian renderer, so `app`, `activeDocument` and
// `require('electron')` are in scope. Results are printed as JSON.
//
// Environment: CDP_PORT (default 9222).
//
// Safety guard: it refuses to do anything unless the connected vault contains the
// marker file written by reset-vault.sh and lives on the WSL filesystem. This keeps
// it from ever touching a real vault, even if the port belongs to another Obsidian.
import { readFileSync, writeFileSync } from 'node:fs';

const PORT = process.env.CDP_PORT ?? '9222';
const MARKER = '.gs-throwaway-vault';

const [, , mode, arg, arg2] = process.argv;
if (!['eval', 'shot', 'cdp'].includes(mode) || !arg) {
	console.error('Usage: cdp.mjs eval <file.js | -e code> | shot <out.png> | cdp <Method> [jsonParams]');
	process.exit(1);
}

let targets;
try {
	targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
} catch (error) {
	console.error(`No DevTools endpoint on 127.0.0.1:${PORT}; is launch.sh running?`, error.message);
	process.exit(1);
}
// The main workspace window. Pop-out windows (Settings in Obsidian 1.15+) are
// separate targets; reach them from the main window via `activeDocument` / `activeWindow`.
const page = targets.find((t) => t.type === 'page' && t.url.startsWith('app://obsidian.md/index.html'));
if (!page) {
	console.error('No Obsidian page target on port', PORT);
	process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
	ws.onopen = resolve;
	ws.onerror = reject;
});
let nextId = 0;
const pending = new Map();
ws.onmessage = (event) => {
	const msg = JSON.parse(event.data);
	if (msg.id && pending.has(msg.id)) {
		pending.get(msg.id)(msg);
		pending.delete(msg.id);
	}
};
const send = (method, params = {}) =>
	new Promise((resolve) => {
		const id = ++nextId;
		pending.set(id, resolve);
		ws.send(JSON.stringify({ id, method, params }));
	});

async function evaluate(expression) {
	const response = await send('Runtime.evaluate', {
		expression,
		awaitPromise: true,
		returnByValue: true,
		userGesture: true,
	});
	if (response.error) throw new Error(response.error.message);
	if (response.result?.exceptionDetails) {
		const details = response.result.exceptionDetails;
		throw new Error(details.exception?.description ?? details.text);
	}
	return response.result?.result?.value;
}

// Guard: only ever act on the throwaway vault. Waits up to ~15 s for the window to
// finish (re)loading, e.g. right after launch or app.emulateMobile().
const where = await evaluate(`(async () => {
	for (let i = 0; i < 75 && !globalThis.app?.vault?.adapter; i++) await new Promise((r) => setTimeout(r, 200));
	const adapter = globalThis.app?.vault?.adapter;
	if (!adapter) return null;
	return {
		name: app.vault.getName(),
		path: adapter.basePath ?? adapter.getBasePath?.(),
		marker: await adapter.exists(${JSON.stringify(MARKER)}),
	};
})()`);
const path = String(where?.path ?? '');
if (!where?.marker || !path.startsWith('/') || path.startsWith('/mnt/')) {
	console.error('Refusing: the connected vault is not the throwaway test vault:', where);
	ws.close();
	process.exit(2);
}

try {
	if (mode === 'eval') {
		const code = arg === '-e' ? arg2 : readFileSync(arg, 'utf8');
		const value = await evaluate(`(async () => { ${code}\n})()`);
		console.log(JSON.stringify(value, null, 2));
	} else if (mode === 'shot') {
		const response = await send('Page.captureScreenshot', { format: 'png' });
		writeFileSync(arg, Buffer.from(response.result.data, 'base64'));
		console.log('saved', arg);
	} else {
		// Note: overrides such as Emulation.* last only while this socket is open.
		const response = await send(arg, arg2 ? JSON.parse(arg2) : {});
		console.log(JSON.stringify(response.result ?? response.error));
	}
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
} finally {
	ws.close();
}
