import type { FeatureToolPolicy } from '../types/tool-policy';

/**
 * Hook definition, state, and fire-context types plus the prompt-template
 * renderer, extracted to a leaf module so both HookManager and HookRunner can
 * depend on them without importing each other (see #1155). hook-manager.ts
 * re-exports everything here, so external import paths are unchanged.
 */
// ─── Public types ─────────────────────────────────────────────────────────────

export type HookTrigger = 'file-created' | 'file-modified' | 'file-deleted' | 'file-renamed';
export type HookAction = 'agent-task' | 'summarize' | 'rewrite' | 'command';

/**
 * A hook definition parsed from a markdown file at
 * {historyFolder}/Hooks/<slug>.md. Frontmatter controls the trigger, filter,
 * and action; the file body is the prompt template.
 */
export interface Hook {
	/** Derived from the file basename (no extension). */
	slug: string;
	trigger: HookTrigger;
	/**
	 * Optional glob matched against the triggering file's vault path.
	 * Supports `*` (single segment) and `**` (any depth). When omitted the
	 * hook fires for every path that survives the implicit state-folder
	 * exclusion.
	 */
	pathGlob?: string;
	/**
	 * Optional frontmatter constraints. Every key must match the value in the
	 * note's frontmatter for the hook to fire.
	 */
	frontmatterFilter?: Record<string, unknown>;
	/** Per-(hook, file) debounce window in milliseconds. */
	debounceMs: number;
	/** Optional sliding-window rate limit per (hook, file). */
	maxRunsPerHour?: number;
	/**
	 * After a fire completes, ignore further (hook, file) events for this
	 * window. Prevents the hook's own writes from re-triggering itself.
	 */
	cooldownMs: number;
	action: HookAction;
	/**
	 * Tool policy applied for the duration of each headless fire. Layered on
	 * top of the global plugin policy via FeatureToolPolicy. Undefined means
	 * inherit the global policy.
	 */
	toolPolicy?: FeatureToolPolicy;
	/** Slugs of skills to pre-activate in the headless session. */
	enabledSkills: string[];
	/** Optional model override; defaults to plugin chat model. */
	model?: string;
	/**
	 * Cap on agent tool-execution iterations for an `agent-task` fire. Each
	 * iteration is one tool-call batch, not a single tool call. Omitted means
	 * use DEFAULT_HEADLESS_MAX_ITERATIONS. Ignored for non-`agent-task` actions,
	 * which don't drive the agent loop.
	 */
	maxIterations?: number;
	/**
	 * Optional output path template for the agent run's final response.
	 * Supports {slug}, {date}, and {fileName} placeholders. When omitted no
	 * output file is written (the hook may still mutate files via tools).
	 */
	outputPath?: string;
	enabled: boolean;
	/**
	 * When true the hook is skipped on mobile platforms. Defaults to true for
	 * `agent-task` actions because headless agent runs can be heavyweight.
	 */
	desktopOnly: boolean;
	/**
	 * Prompt template body. Semantics depend on `action`:
	 *   agent-task → instruction sent to the model (supports {{filePath}} etc.)
	 *   rewrite    → rewrite instruction (also supports template variables)
	 *   summarize  → ignored (the summary template builds its own prompt)
	 *   command    → ignored (use commandId)
	 */
	prompt: string;
	/**
	 * Command palette command id to execute when `action: command`.
	 * Ignored for every other action.
	 */
	commandId?: string;
	/**
	 * When `action: command` and this is true, focus the triggering file in
	 * the workspace before dispatching the command. Lets editor-scoped
	 * commands (`editor:save-file`, etc.) target the file that fired the
	 * hook rather than whatever happens to be active. Defaults to false to
	 * keep global-command hooks from jumping the user's view on every fire.
	 * Ignored for every action other than `command`.
	 */
	focusFile?: boolean;
	/** Vault path of the hook definition file. */
	filePath: string;
}

/** Per-hook volatile runtime state stored in the sidecar JSON. */
export interface HookState {
	/** Recent fire timestamps (ms epoch) for hard-loop ceiling check. */
	recentFires?: number[];
	/** Recent fire timestamps used for `maxRunsPerHour` rate limit. */
	hourlyFires?: number[];
	/** Wall-clock timestamps when each (hook, file) last fired. */
	lastFireAt?: Record<string, number>;
	/** Error message from the most recent failed run, if any. */
	lastError?: string;
	/** Number of consecutive failures since the last success. */
	consecutiveFailures?: number;
	/** When true the hook is auto-paused until manually reset. */
	pausedDueToErrors?: boolean;
}

export type HooksState = Record<string, HookState>;

/**
 * The vault event payload passed to a hook fire. Captures everything the
 * runner needs without re-reading from the vault (which may have changed by
 * the time the debounce timer fires).
 */
export interface HookFireContext {
	hook: Hook;
	trigger: HookTrigger;
	filePath: string;
	fileName: string;
	oldPath?: string;
	frontmatter?: Record<string, unknown>;
}

/**
 * Parameters accepted by `HookManager.createHook` and the union of fields
 * `updateHook` understands. Mirrors the on-disk frontmatter schema; defaults
 * are applied at serialization time so callers can omit unset fields.
 */
export interface HookCreateParams {
	slug: string;
	trigger: HookTrigger;
	action: HookAction;
	prompt: string;
	pathGlob?: string;
	frontmatterFilter?: Record<string, unknown>;
	debounceMs?: number;
	maxRunsPerHour?: number;
	cooldownMs?: number;
	toolPolicy?: FeatureToolPolicy;
	enabledSkills?: string[];
	model?: string;
	maxIterations?: number;
	outputPath?: string;
	enabled?: boolean;
	desktopOnly?: boolean;
	commandId?: string;
	focusFile?: boolean;
}

export type HookUpdateParams = Partial<Omit<HookCreateParams, 'slug'>>;

// ─── Prompt rendering ──────────────────────────────────────────────────────────
//
// Glob / frontmatter matching lives in ./hook-matcher (matchesGlob,
// matchesFrontmatterFilter, globToRegExp). renderPrompt lives here (not in
// hook-manager) because it's shared with hook-runner, and a leaf home keeps
// the manager ↔ runner edge one-way (see #1155).

/** Substitute {{var}} placeholders in `template` from `vars`. */
export function renderPrompt(template: string, vars: Record<string, string>): string {
	return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => vars[name] ?? '');
}
