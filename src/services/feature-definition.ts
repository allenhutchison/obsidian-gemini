import type { TFile } from 'obsidian';
import type ObsidianGemini from '../main';
import { findFrontmatterEndOffset } from './skill-manager';
import { FeatureToolPolicy, parseToolPolicyFrontmatter } from '../types/tool-policy';
import { migrateLegacyToolCategoryArray } from './feature-policy-yaml';

/**
 * Shared scaffolding for the markdown-defined feature managers — HookManager
 * and ScheduledTaskManager. Both discover `<slug>.md` definition files under a
 * folder in the plugin state directory, parse YAML frontmatter into a typed
 * definition, and persist volatile per-entry runtime state to a JSON sidecar.
 * The helpers below are the parts of that pattern that are identical between
 * the two managers; the feature-specific frontmatter-field mapping stays in
 * each manager's own `parseHookFile` / `parseTaskFile`.
 */

/**
 * Reads and writes a JSON sidecar state file (a `Record<slug, EntryState>`).
 * Owns only the I/O: `load` tolerates a missing or corrupt file by returning an
 * empty map, and `save` logs (but never throws) on write failure so a transient
 * disk error cannot break a hook fire or a scheduler tick.
 *
 * The owning manager keeps the live state object — this store is purely the
 * persistence layer. The sidecar path is resolved lazily on every call because
 * it depends on `settings.historyFolder`, which can change at runtime.
 */
export class JsonSidecarStateStore<T extends object> {
	/**
	 * @param plugin       Plugin instance — provides the vault adapter and logger.
	 * @param resolvePath  Returns the current sidecar file path. Invoked on every
	 *                     load/save so a `historyFolder` change is picked up.
	 * @param logPrefix    Bracketed manager tag for log lines, e.g. `[HookManager]`.
	 */
	constructor(
		private readonly plugin: ObsidianGemini,
		private readonly resolvePath: () => string,
		private readonly logPrefix: string
	) {}

	/** Load the sidecar state, falling back to an empty map when absent or corrupt. */
	async load(): Promise<T> {
		const path = this.resolvePath();
		try {
			const exists = await this.plugin.app.vault.adapter.exists(path);
			if (!exists) return {} as T;
			const raw = await this.plugin.app.vault.adapter.read(path);
			return JSON.parse(raw) as T;
		} catch (err) {
			this.plugin.logger.warn(`${this.logPrefix} Failed to load state, starting fresh:`, err);
			return {} as T;
		}
	}

	/** Persist the sidecar state. Logs but does not throw on write failure. */
	async save(state: T): Promise<void> {
		const path = this.resolvePath();
		try {
			await this.plugin.app.vault.adapter.write(path, JSON.stringify(state, null, 2));
		} catch (err) {
			this.plugin.logger.error(`${this.logPrefix} Failed to save state:`, err);
		}
	}
}

/**
 * Extract the markdown body — everything after the YAML frontmatter block —
 * trimmed. Returns the whole trimmed content when there is no frontmatter.
 */
export function extractMarkdownBody(content: string): string {
	const offset = findFrontmatterEndOffset(content);
	return offset !== undefined ? content.slice(offset).trim() : content.trim();
}

/**
 * Resolve the tool policy for a feature definition from its frontmatter:
 * prefer the canonical `toolPolicy:` block, falling back to the legacy
 * `enabledTools:` category array. `undefined` means "inherit the global policy".
 */
export function resolveFeatureToolPolicy(frontmatter: Record<string, unknown>): FeatureToolPolicy | undefined {
	return parseToolPolicyFrontmatter(frontmatter.toolPolicy) ?? migrateLegacyToolCategoryArray(frontmatter.enabledTools);
}

/**
 * Rewrite a definition file in place when it still carries the legacy
 * `enabledTools:` frontmatter (and no canonical `toolPolicy:` block), so the
 * next load reads the new shape without re-migrating.
 *
 * Returns a promise only when a migration is actually started; returns
 * `undefined` synchronously (no microtask) for the common no-op case, so the
 * caller can do `const m = migrateLegacyEnabledTools(...); if (m) await m;`
 * without adding an `await` tick to a parse that has nothing to migrate.
 * Failures are non-fatal: parsing the definition must not depend on the
 * rewrite succeeding.
 *
 * @param serialize  Produces the migrated file content. Invoked only when a
 *                   migration is actually needed.
 */
export function migrateLegacyEnabledTools(
	plugin: ObsidianGemini,
	file: TFile,
	frontmatter: Record<string, unknown>,
	serialize: () => string,
	logPrefix: string
): Promise<void> | void {
	if (frontmatter.enabledTools === undefined || frontmatter.toolPolicy !== undefined) return;
	return runLegacyToolMigration(plugin, file, serialize, logPrefix);
}

async function runLegacyToolMigration(
	plugin: ObsidianGemini,
	file: TFile,
	serialize: () => string,
	logPrefix: string
): Promise<void> {
	try {
		await plugin.app.vault.modify(file, serialize());
	} catch (err) {
		plugin.logger.warn(`${logPrefix} legacy enabledTools migration failed for ${file.path}:`, err);
	}
}

/**
 * Drop sidecar state entries whose definition file is gone — keeps the JSON
 * tidy and stops stale error/pause flags from accumulating. Mutates `state`
 * in place and returns the purged slugs so the caller can log them.
 */
export function purgeOrphanState<T>(state: Record<string, T>, isKnown: (slug: string) => boolean): string[] {
	const purged: string[] = [];
	for (const slug of Object.keys(state)) {
		if (!isKnown(slug)) {
			delete state[slug];
			purged.push(slug);
		}
	}
	return purged;
}
