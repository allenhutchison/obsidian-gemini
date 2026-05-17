#!/usr/bin/env node
// Copies the current worktree's built plugin artifacts (main.js, manifest.json,
// styles.css) into the test vault's plugin directory.
//
// Why this exists: with multiple git worktrees each producing their own build,
// a single symlink in the test vault binds it to one worktree — usually the
// wrong one. This script lets `npm run install:test-vault` from inside any
// worktree push that worktree's build into the vault. Pair it with the
// `hot-reload` community plugin (an empty `.hotreload` file in the plugin
// directory) for live reloads on rebuild.
//
// Target resolution (no TEST_VAULT_PLUGIN_DIR override):
//   The plugin folder is found by scanning <vault>/.obsidian/plugins/* for a
//   manifest.json whose `id` matches this plugin — NOT by assuming a folder
//   name. Obsidian keys plugins by manifest id, and a vault folder may be named
//   anything (e.g. `obsidian-gemini`). Installing into a hardcoded `gemini-scribe`
//   folder silently misses a differently-named folder Obsidian actually loads.
//   If several folders declare the id, all are updated (Obsidian loads only one
//   and which is not knowable from outside it) and the duplicates are reported.
//   If none exist yet (fresh vault), the canonical `<id>` folder is created.
//
// Override the destination with TEST_VAULT_PLUGIN_DIR (an exact plugin dir) if
// your test vault is elsewhere — that bypasses the scan.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const files = ['main.js', 'manifest.json', 'styles.css'];

// Verify build artifacts exist in the current worktree.
const missing = files.filter((f) => !existsSync(f));
if (missing.length > 0) {
	console.error(`Missing build artifacts: ${missing.join(', ')}. Run 'npm run build' first.`);
	process.exit(1);
}

// Read the id from the artifact we're about to copy, so the script can never
// drift from the actual plugin id.
let pluginId;
try {
	pluginId = JSON.parse(readFileSync('manifest.json', 'utf8')).id;
} catch (err) {
	console.error(`Could not read plugin id from manifest.json: ${err.message}`);
	process.exit(1);
}
if (!pluginId) {
	console.error('manifest.json has no "id" field.');
	process.exit(1);
}

const destinations = resolveDestinations(pluginId);

for (const dest of destinations) {
	mkdirSync(dest, { recursive: true });
	for (const file of files) {
		copyFileSync(file, join(dest, file));
	}
	console.log(`Installed ${files.join(', ')} → ${dest}`);
}

console.log('\nReload the plugin in Obsidian (or use the hot-reload plugin) to pick up changes.');

/**
 * Resolve which plugin folder(s) to install into.
 * - TEST_VAULT_PLUGIN_DIR, if set, is used verbatim (no scanning).
 * - Otherwise scan the test vault's plugins directory for folders whose
 *   manifest.json declares `id`, falling back to the canonical `<id>` folder
 *   on a fresh vault.
 */
function resolveDestinations(id) {
	const override = process.env.TEST_VAULT_PLUGIN_DIR;
	if (override) {
		if (!existsSync(dirname(override))) {
			console.error(`Parent directory not found: ${dirname(override)}. Check TEST_VAULT_PLUGIN_DIR.`);
			process.exit(1);
		}
		return [override];
	}

	const pluginsDir = join(homedir(), 'Obsidian', 'Test Vault', '.obsidian', 'plugins');
	if (!existsSync(pluginsDir)) {
		console.error(
			`Test vault plugins directory not found: ${pluginsDir}.\n` +
				`Set TEST_VAULT_PLUGIN_DIR, or open the test vault in Obsidian at least once.`
		);
		process.exit(1);
	}

	const matches = [];
	for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const manifestPath = join(pluginsDir, entry.name, 'manifest.json');
		if (!existsSync(manifestPath)) continue;
		try {
			if (JSON.parse(readFileSync(manifestPath, 'utf8')).id === id) {
				matches.push(join(pluginsDir, entry.name));
			}
		} catch {
			// A folder with an unreadable manifest isn't ours — skip it.
		}
	}

	if (matches.length === 0) {
		// Fresh vault — the plugin has never been installed. Create the
		// canonical `<id>` folder.
		return [join(pluginsDir, id)];
	}

	if (matches.length > 1) {
		console.warn(
			`Warning: ${matches.length} folders in the test vault declare id "${id}":\n` +
				matches.map((m) => `  - ${m}`).join('\n') +
				`\nObsidian loads only one of them. Installing into all so the running copy is ` +
				`fresh — but delete the stale folder(s) to avoid confusion.\n`
		);
	}

	return matches;
}
