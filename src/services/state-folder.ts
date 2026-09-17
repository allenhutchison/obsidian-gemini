import { normalizePath } from 'obsidian';
import type { ObsidianGeminiSettings } from '../types/settings';

/**
 * Single source of truth for the plugin state-folder layout (#1382).
 *
 * Everything under `settings.historyFolder` — subfolder names, root-level state
 * file names, and the path composition itself — is declared here once. This is a
 * **leaf module**: it imports only `normalizePath` and a type, so every consumer
 * (`src/agent/`, `src/prompts/`, `src/services/`, `src/tools/`, `src/ui/`) can
 * import it without a cycle. Never hand-build a state path with a template
 * literal; call `stateFolderPath()` so `normalizePath` is applied exactly once.
 */

/** Subfolders of the plugin state root, keyed by purpose. */
export const STATE_SUBFOLDERS = {
	/** Agent mode session files. */
	agentSessions: 'Agent-Sessions',
	/** Output from background deep-research and image-gen tasks. */
	backgroundTasks: 'Background-Tasks',
	/** User-defined prompt templates. */
	prompts: 'Prompts',
	/** Agent skill packages (agentskills.io format). */
	skills: 'Skills',
	/** Scheduled task definitions. */
	scheduledTasks: 'Scheduled-Tasks',
	/**
	 * Lifecycle hook definitions. Deliberately **not** eagerly created: created
	 * on demand by `HookManager.initialize`, gated on `settings.hooksEnabled`, so
	 * vaults with hooks turned off never get an empty `Hooks/` folder.
	 */
	hooks: 'Hooks',
	/**
	 * Legacy note-centric chat history from v3.x. Deliberately **not** eagerly
	 * created: read-only, never written by current code.
	 */
	history: 'History',
} as const;

/** Lowercase `skills` directory migrated to `Skills` on case-sensitive filesystems. */
export const LEGACY_SKILLS_SUBFOLDER = 'skills';

/** Required entry-point file inside every skill package directory (`Skills/<name>/SKILL.md`). */
export const SKILL_FILENAME = 'SKILL.md';

/** Per-feature run-output subfolder (`<feature>/Runs`), shared by hooks and scheduled tasks. */
export const RUNS_SUBFOLDER = 'Runs';

/** Root-level state files, keyed by purpose. */
export const STATE_FILES = {
	/** Agent memory file. */
	agentsMemory: 'AGENTS.md',
	/** Bundled example prompt definitions. */
	examplePrompts: 'example-prompts.json',
	/** Cached RAG index state. */
	ragIndexCache: 'rag-index-cache.json',
	/** Current debug log. */
	debugLog: 'debug.log',
	/** Rotated debug log. */
	oldDebugLog: 'debug.log.old',
} as const;

/**
 * Subfolders `FolderInitializer` creates eagerly on startup.
 *
 * Derived from `STATE_SUBFOLDERS` rather than hand-written, so the creator's
 * list cannot drift from the layout. `hooks` and `history` are intentionally
 * absent — see their notes in `STATE_SUBFOLDERS`.
 */
export const EAGER_SUBFOLDERS: readonly string[] = [
	STATE_SUBFOLDERS.agentSessions,
	STATE_SUBFOLDERS.backgroundTasks,
	STATE_SUBFOLDERS.prompts,
	STATE_SUBFOLDERS.skills,
	STATE_SUBFOLDERS.scheduledTasks,
	`${STATE_SUBFOLDERS.scheduledTasks}/${RUNS_SUBFOLDER}`,
];

/**
 * Compose a path inside the plugin state folder.
 *
 * Joins `settings.historyFolder` with the given segments and applies
 * `normalizePath` once. Empty segments are dropped so callers can pass an
 * optional name without guarding it.
 */
export function stateFolderPath(
	settings: Pick<ObsidianGeminiSettings, 'historyFolder'>,
	...segments: string[]
): string {
	const parts = [settings.historyFolder, ...segments].filter((segment) => segment !== '');
	return normalizePath(parts.join('/'));
}
