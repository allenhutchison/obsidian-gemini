/**
 * One-time settings migrations that run in `ObsidianGemini.loadSettings`.
 *
 * These are pure helpers (mutate the merged settings in place, return whether a
 * change was applied) so the caller can persist + log once and so the migration
 * logic is unit-testable without standing up a full plugin instance. They detect
 * the pre-migration shape from the raw persisted data (pre-merge) rather than the
 * merged settings, whose defaults already backfill new fields.
 */

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
