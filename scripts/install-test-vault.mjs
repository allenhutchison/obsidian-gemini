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
// Override the destination with TEST_VAULT_PLUGIN_DIR if your test vault is
// elsewhere.

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const DEFAULT_DEST = join(homedir(), 'Obsidian', 'Test Vault', '.obsidian', 'plugins', 'gemini-scribe');
const dest = process.env.TEST_VAULT_PLUGIN_DIR ?? DEFAULT_DEST;
const files = ['main.js', 'manifest.json', 'styles.css'];

const missing = files.filter((f) => !existsSync(f));
if (missing.length > 0) {
	console.error(`Missing build artifacts: ${missing.join(', ')}. Run 'npm run build' first.`);
	process.exit(1);
}

if (!existsSync(dirname(dest))) {
	console.error(
		`Parent directory not found: ${dirname(dest)}. Check TEST_VAULT_PLUGIN_DIR, or ensure the test vault has been opened in Obsidian at least once.`
	);
	process.exit(1);
}

mkdirSync(dest, { recursive: true });

for (const file of files) {
	const target = join(dest, file);
	copyFileSync(file, target);
	console.log(`  ${file} → ${target}`);
}

console.log(`\nInstalled to ${dest}`);
console.log('Reload the plugin in Obsidian (or use the hot-reload plugin) to pick up changes.');
