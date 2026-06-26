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
// Target resolution (highest precedence first):
//   1. TEST_VAULT_PLUGIN_DIR — an exact plugin folder. Escape hatch; bypasses
//      scanning. Validated against the plugin id (see below) so a typo or a
//      stale path can't silently install into a folder Obsidian never loads.
//   2. TEST_VAULT_DIR — a vault ROOT (the folder that contains `.obsidian/`).
//      Preferred when your test vault lives somewhere other than the default:
//      it scans `<root>/.obsidian/plugins` the same robust way as the default,
//      so duplicate/renamed folders are still handled and reported.
//   3. Default — `~/Obsidian/Test Vault`.
//
// Vault scanning (options 2 and 3): the plugin folder is found by reading every
// `<vault>/.obsidian/plugins/*/manifest.json` and matching on `id`, NOT on
// folder name — Obsidian keys plugins by manifest id and a vault folder may be
// named anything (e.g. `obsidian-gemini`). If several folders declare the id,
// ALL are updated (Obsidian loads only one and which is not knowable from
// outside it) and the duplicates are reported. If none exist yet (fresh vault),
// the canonical `<id>` folder is created.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const files = ['main.js', 'manifest.json', 'styles.css'];

// Sentinels distinguishing "no manifest.json at all" from "manifest present but
// unreadable/malformed". The exact-dir override must fail closed on the latter
// (a corrupt manifest must not be mistaken for a fresh folder and overwritten),
// while the vault scan stays tolerant of unrelated plugins' broken manifests.
const MANIFEST_ABSENT = Symbol('manifest-absent');
const MANIFEST_INVALID = Symbol('manifest-invalid');

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
 * Read a plugin folder's manifest id. Returns the id string, or a sentinel:
 * MANIFEST_ABSENT (no manifest.json) / MANIFEST_INVALID (present but unparseable
 * or missing a non-empty `id`).
 */
function readManifestId(pluginDir) {
	const manifestPath = join(pluginDir, 'manifest.json');
	if (!existsSync(manifestPath)) return MANIFEST_ABSENT;
	try {
		const id = JSON.parse(readFileSync(manifestPath, 'utf8')).id;
		return typeof id === 'string' && id ? id : MANIFEST_INVALID;
	} catch {
		return MANIFEST_INVALID;
	}
}

/**
 * Scan a vault root's plugins directory for folders whose manifest declares
 * `id`. Returns matching plugin-dir paths (possibly several), or the canonical
 * `<id>` folder on a fresh vault. Exits if the vault/plugins dir is missing.
 */
function scanVault(vaultRoot, id, { sourceLabel }) {
	const pluginsDir = join(vaultRoot, '.obsidian', 'plugins');
	if (!existsSync(pluginsDir)) {
		console.error(
			`Test vault plugins directory not found: ${pluginsDir}\n` +
				`(resolved from ${sourceLabel}). Open the vault in Obsidian at least once, ` +
				`or set TEST_VAULT_DIR / TEST_VAULT_PLUGIN_DIR.`
		);
		process.exit(1);
	}

	const matches = [];
	for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const dir = join(pluginsDir, entry.name);
		// Sentinels never equal the id string, so absent/invalid manifests are
		// simply skipped here — a broken unrelated plugin won't abort the scan.
		if (readManifestId(dir) === id) matches.push(dir);
	}

	if (matches.length === 0) {
		// Fresh vault — the plugin has never been installed. Create the canonical
		// `<id>` folder.
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

/**
 * Resolve which plugin folder(s) to install into. See the precedence list in the
 * header comment.
 */
function resolveDestinations(id) {
	const pluginDirOverride = process.env.TEST_VAULT_PLUGIN_DIR;
	if (pluginDirOverride) {
		if (!existsSync(dirname(pluginDirOverride))) {
			console.error(`Parent directory not found: ${dirname(pluginDirOverride)}. Check TEST_VAULT_PLUGIN_DIR.`);
			process.exit(1);
		}
		// Guard against pointing at the wrong place. Fail closed when the target
		// holds a different plugin (typo/stale path) OR an unreadable manifest (we
		// can't verify it's ours, so we won't overwrite it). A target with no
		// manifest yet (genuinely fresh folder) is allowed but called out, since the
		// most common mistake is aiming at a vault Obsidian doesn't actually load.
		const existing = readManifestId(pluginDirOverride);
		if (existing === MANIFEST_INVALID) {
			console.error(
				`TEST_VAULT_PLUGIN_DIR has an unreadable/invalid manifest.json: ${pluginDirOverride}\n` +
					`Refusing to overwrite — can't confirm it's the ${id} plugin. Fix or remove the ` +
					`manifest, or point at the correct folder.`
			);
			process.exit(1);
		}
		if (typeof existing === 'string' && existing !== id) {
			console.error(
				`TEST_VAULT_PLUGIN_DIR points at a folder for a different plugin ` +
					`(found id "${existing}", expected "${id}"): ${pluginDirOverride}`
			);
			process.exit(1);
		}
		if (existing === MANIFEST_ABSENT) {
			console.warn(
				`Warning: TEST_VAULT_PLUGIN_DIR has no existing ${id} manifest: ${pluginDirOverride}\n` +
					`Installing anyway. If Obsidian isn't picking up changes, confirm this is the ` +
					`folder the OPEN vault loads (prefer TEST_VAULT_DIR to scan a vault root by id).\n`
			);
		}
		return [pluginDirOverride];
	}

	const vaultDirOverride = process.env.TEST_VAULT_DIR;
	if (vaultDirOverride) {
		return scanVault(vaultDirOverride, id, { sourceLabel: 'TEST_VAULT_DIR' });
	}

	return scanVault(join(homedir(), 'Obsidian', 'Test Vault'), id, { sourceLabel: 'the default ~/Obsidian/Test Vault' });
}
