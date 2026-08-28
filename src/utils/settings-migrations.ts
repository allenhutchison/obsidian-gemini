/**
 * One-time settings migrations that run in `ObsidianGemini.loadSettings`.
 *
 * These are pure helpers (mutate the merged settings in place, return whether a
 * change was applied) so the caller can persist + log once and so the migration
 * logic is unit-testable without standing up a full plugin instance. They detect
 * the pre-migration shape from the raw persisted data (pre-merge) rather than the
 * merged settings, whose defaults already backfill new fields.
 */

import { normalizePath } from 'obsidian';

/**
 * Default-on rollout for the Interactions API transport (#1017).
 *
 * The transport shipped opt-in with `useInteractionsApi` defaulting to `false`,
 * so existing installs persisted `false`. This flips them to the new default
 * exactly once. A dedicated marker (`useInteractionsApiMigrated`) guards re-runs
 * so a user who later turns the transport back off is respected on subsequent
 * loads; new installs are seeded with the marker via `DEFAULT_SETTINGS` and skip
 * this entirely.
 *
 * @param settings - freshly merged settings (mutated in place)
 * @param rawData - raw persisted data as loaded from disk, pre-merge
 */
export function migrateInteractionsApiDefault(
	settings: { useInteractionsApi: boolean; useInteractionsApiMigrated?: boolean },
	rawData: Record<string, unknown> | null | undefined
): boolean {
	if (rawData && rawData.useInteractionsApi === false && !rawData.useInteractionsApiMigrated) {
		settings.useInteractionsApi = true;
		settings.useInteractionsApiMigrated = true;
		return true;
	}
	return false;
}

/**
 * Normalize the state-folder setting (`settings.historyFolder`) at the settings
 * boundary (#1374).
 *
 * The state folder is set from a free-text field and is the argument
 * `isPathInFolder` is built on: `path === folder || path.startsWith(folder + '/')`.
 * A persisted trailing (or duplicate/leading) slash makes both arms dead —
 * containment reports that nothing lives inside the folder — so every exclusion
 * built on the setting silently stops excluding (file mention modal, tool
 * guards) and every `${historyFolder}/...` path doubles its slash.
 *
 * Normalizing here (not inside `isPathInFolder`) keeps the predicate pure and
 * fixes both the containment checks and the path building in one place; the
 * load-time call covers vaults that already persisted a malformed value.
 *
 * @param settings - settings object with the `historyFolder` field (mutated in place)
 * @returns true if the value was malformed and has been rewritten
 */
export function normalizeStateFolderPath(settings: { historyFolder: string }): boolean {
	if (!settings.historyFolder) {
		return false;
	}
	// normalizePath leaves surrounding whitespace untouched on some inputs;
	// trim explicitly so the result is unambiguous.
	const candidate = settings.historyFolder.trim();
	if (!candidate) {
		return false;
	}
	const normalized = normalizePath(candidate);
	if (normalized === settings.historyFolder) {
		return false;
	}
	settings.historyFolder = normalized;
	return true;
}
