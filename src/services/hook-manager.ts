import { Platform, TAbstractFile, TFile, normalizePath } from 'obsidian';
import type ObsidianGemini from '../main';
import { ensureFolderExists } from '../utils/file-utils';
import { findFrontmatterEndOffset } from './skill-manager';

// ─── Folder / file layout ─────────────────────────────────────────────────────

const HOOKS_FOLDER = 'Hooks';
const RUNS_SUBFOLDER = 'Runs';
const STATE_FILE = 'hooks-state.json';

/** Default per-(hook, file) debounce window (ms). Resets on every matching event. */
const DEFAULT_DEBOUNCE_MS = 5000;

/**
 * Default cooldown after a hook fire completes — further (hook, file) events
 * within this window are suppressed to prevent self-retrigger when the hook's
 * agent run wrote to the same file that triggered it.
 */
const DEFAULT_COOLDOWN_MS = 30_000;

/** Hard loop ceiling: max fires per (hook, file) inside the loop window. */
const HARD_LOOP_LIMIT = 5;
const HARD_LOOP_WINDOW_MS = 60_000;

/** Pause the hook after this many consecutive failures. */
const MAX_CONSECUTIVE_FAILURES = 3;

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
	/** ToolCategory enum values to enable for the headless session. */
	enabledTools: string[];
	/** Slugs of skills to pre-activate in the headless session. */
	enabledSkills: string[];
	/** Optional model override; defaults to plugin chat model. */
	model?: string;
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
	enabledTools?: string[];
	enabledSkills?: string[];
	model?: string;
	outputPath?: string;
	enabled?: boolean;
	desktopOnly?: boolean;
	commandId?: string;
	focusFile?: boolean;
}

export type HookUpdateParams = Partial<Omit<HookCreateParams, 'slug'>>;

// Hook slugs become file basenames inside `Hooks/`, so we mirror the same
// constraints the skills system uses: lowercase ASCII letters/digits/hyphens,
// 1–64 chars, no leading/trailing or consecutive hyphens.
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_MIN = 1;
const SLUG_MAX = 64;

function validateSlug(raw: string): string {
	const slug = raw.trim();
	if (slug.length < SLUG_MIN) throw new Error('Hook slug cannot be empty');
	if (slug.length > SLUG_MAX) throw new Error(`Hook slug must be at most ${SLUG_MAX} characters`);
	if (!SLUG_PATTERN.test(slug)) {
		throw new Error(
			'Hook slug must be lowercase letters, digits, and hyphens only (no leading/trailing or consecutive hyphens)'
		);
	}
	return slug;
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

/**
 * Compile a glob pattern (`*`, `**`, literal characters) into a RegExp.
 * Single `*` matches any character except `/`; `**` matches any path
 * including `/`. All other regex metacharacters are escaped so user globs
 * cannot accidentally form regex constructs.
 */
export function globToRegExp(glob: string): RegExp {
	// Walk the glob once, copying escaped literal characters and emitting
	// regex equivalents for `**` (matches any path including separators) and
	// `*` (matches any character except `/`). A single pass avoids the
	// sentinel-replace approach that needed an unprintable placeholder
	// character.
	let pattern = '';
	for (let i = 0; i < glob.length; i++) {
		const ch = glob[i];
		if (ch === '*') {
			if (glob[i + 1] === '*') {
				pattern += '.*';
				i++;
			} else {
				pattern += '[^/]*';
			}
		} else if (/[.+^${}()|[\]\\]/.test(ch)) {
			pattern += '\\' + ch;
		} else {
			pattern += ch;
		}
	}
	return new RegExp(`^${pattern}$`);
}

/** Returns true if the path passes the glob (or no glob is provided). */
export function matchesGlob(path: string, glob: string | undefined): boolean {
	if (!glob) return true;
	return globToRegExp(glob).test(path);
}

/** Returns true if every key in `filter` equals the corresponding frontmatter value. */
export function matchesFrontmatterFilter(
	frontmatter: Record<string, unknown> | undefined,
	filter: Record<string, unknown> | undefined
): boolean {
	if (!filter) return true;
	if (!frontmatter) return false;
	for (const [key, expected] of Object.entries(filter)) {
		if (frontmatter[key] !== expected) return false;
	}
	return true;
}

/** Substitute {{var}} placeholders in `template` from `vars`. */
export function renderPrompt(template: string, vars: Record<string, string>): string {
	return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name) => vars[name] ?? '');
}

// ─── Manager ─────────────────────────────────────────────────────────────────

/**
 * Manages hook definitions stored as markdown files and their reactive
 * dispatch in response to Obsidian vault events.
 *
 * Layout inside the plugin state folder:
 *   Hooks/
 *   ├── <slug>.md              ← hook definition (user-edited)
 *   ├── Runs/
 *   │   └── <slug>/
 *   │       └── <date>.md      ← per-fire output (when outputPath is set)
 *   └── hooks-state.json       ← volatile runtime state
 *
 * Hooks are skipped entirely when `settings.hooksEnabled` is false (default).
 */
export class HookManager {
	private hooks = new Map<string, Hook>();
	private state: HooksState = {};
	private initialized = false;
	/** Per-(hook, file) debounce timers, keyed by `${slug}::${filePath}`. */
	private debounceTimers = new Map<string, number>();
	/** Set of `${slug}::${filePath}` currently executing — drops re-entrant events. */
	private inflight = new Set<string>();
	/** Vault event handlers registered via plugin.registerEvent — kept for off(). */
	private eventRefs: { off: () => void }[] = [];

	constructor(private plugin: ObsidianGemini) {}

	// ── Folder path helpers ──────────────────────────────────────────────────

	get hooksFolder(): string {
		return normalizePath(`${this.plugin.settings.historyFolder}/${HOOKS_FOLDER}`);
	}

	get runsFolder(): string {
		return normalizePath(`${this.hooksFolder}/${RUNS_SUBFOLDER}`);
	}

	get stateFilePath(): string {
		return normalizePath(`${this.hooksFolder}/${STATE_FILE}`);
	}

	// ── Lifecycle ────────────────────────────────────────────────────────────

	/**
	 * Discover hook definition files, load sidecar state, and subscribe to
	 * vault events. Idempotent: subsequent calls without `refresh: true` are
	 * no-ops; with `refresh: true` (used by settings re-init) the previous
	 * subscriptions are torn down and re-registered against the freshly-loaded
	 * historyFolder.
	 */
	async initialize(options?: { refresh?: boolean }): Promise<void> {
		if (this.initialized && !options?.refresh) return;

		this.unregisterEventHandlers();
		this.clearDebounceTimers();

		// Skip everything when hooks are disabled — no folder creation, no
		// vault subscriptions, no state file. Re-enabling later via settings
		// will trigger a refresh that reaches this method again.
		if (!this.plugin.settings.hooksEnabled) {
			this.hooks.clear();
			this.state = {};
			this.initialized = true;
			this.plugin.logger.log('[HookManager] Hooks disabled — skipping initialization');
			return;
		}

		await ensureFolderExists(this.plugin.app.vault, this.hooksFolder, 'hooks', this.plugin.logger);
		await ensureFolderExists(this.plugin.app.vault, this.runsFolder, 'hook runs', this.plugin.logger);
		await this.loadState();
		await this.discoverHooks();
		this.registerEventHandlers();

		this.initialized = true;
		this.plugin.logger.log(`[HookManager] Initialized with ${this.hooks.size} hook(s)`);
	}

	/**
	 * Tear down event subscriptions, cancel pending debounces, and clear
	 * in-memory state. Safe to call repeatedly.
	 */
	destroy(): void {
		this.unregisterEventHandlers();
		this.clearDebounceTimers();
		this.hooks.clear();
		this.state = {};
		this.inflight.clear();
		this.initialized = false;
		this.plugin.logger.log('[HookManager] Destroyed');
	}

	// ── Test / inspection helpers ────────────────────────────────────────────

	/** Returns a snapshot list of all loaded hooks. */
	getHooks(): Hook[] {
		return [...this.hooks.values()];
	}

	/** Returns a copy of the persisted state map. */
	getStateSnapshot(): HooksState {
		return JSON.parse(JSON.stringify(this.state));
	}

	/**
	 * Manually clear `pausedDueToErrors` so a paused hook can fire again.
	 */
	async resetHook(slug: string): Promise<void> {
		const entry = this.state[slug];
		if (!entry) return;
		this.state[slug] = {
			...entry,
			lastError: undefined,
			consecutiveFailures: 0,
			pausedDueToErrors: false,
		};
		await this.saveState();
	}

	// ── CRUD operations ─────────────────────────────────────────────────────

	/**
	 * Create a new hook by writing its definition file to `Hooks/<slug>.md`
	 * and immediately registering it in the in-memory map. Validation rejects
	 * empty / duplicate / malformed slugs before the vault is touched.
	 */
	async createHook(params: HookCreateParams): Promise<void> {
		const slug = validateSlug(params.slug);
		if (this.hooks.has(slug)) throw new Error(`A hook named "${slug}" already exists`);

		const filePath = normalizePath(`${this.hooksFolder}/${slug}.md`);
		const content = this.serializeHook({ ...params, slug });
		await this.plugin.app.vault.create(filePath, content);

		const hook: Hook = this.toHook(slug, filePath, params);
		this.hooks.set(slug, hook);
		if (!this.state[slug]) {
			this.state[slug] = {};
			await this.saveState();
		}
	}

	/**
	 * Rewrite an existing hook's definition file. Slug is the stable
	 * identifier; renaming is not supported via this method.
	 */
	async updateHook(slug: string, params: HookUpdateParams): Promise<void> {
		const hook = this.hooks.get(slug);
		if (!hook) throw new Error(`Hook "${slug}" not found`);

		const file = this.plugin.app.vault.getAbstractFileByPath(hook.filePath);
		if (!file) throw new Error(`Hook file not found: ${hook.filePath}`);

		const merged: Required<HookCreateParams> = {
			slug,
			trigger: params.trigger ?? hook.trigger,
			pathGlob: params.pathGlob ?? hook.pathGlob ?? '',
			frontmatterFilter: params.frontmatterFilter ?? hook.frontmatterFilter ?? {},
			debounceMs: params.debounceMs ?? hook.debounceMs,
			maxRunsPerHour: params.maxRunsPerHour ?? hook.maxRunsPerHour ?? 0,
			cooldownMs: params.cooldownMs ?? hook.cooldownMs,
			action: params.action ?? hook.action,
			enabledTools: params.enabledTools ?? hook.enabledTools,
			enabledSkills: params.enabledSkills ?? hook.enabledSkills,
			model: params.model ?? hook.model ?? '',
			outputPath: params.outputPath ?? hook.outputPath ?? '',
			enabled: params.enabled ?? hook.enabled,
			desktopOnly: params.desktopOnly ?? hook.desktopOnly,
			prompt: params.prompt ?? hook.prompt,
			commandId: params.commandId ?? hook.commandId ?? '',
			focusFile: params.focusFile ?? hook.focusFile ?? false,
		};

		const content = this.serializeHook(merged);
		await this.plugin.app.vault.modify(file as TFile, content);

		this.hooks.set(slug, this.toHook(slug, hook.filePath, merged));
	}

	/**
	 * Delete a hook: remove the definition file and its state entry.
	 */
	async deleteHook(slug: string): Promise<void> {
		const hook = this.hooks.get(slug);
		if (!hook) throw new Error(`Hook "${slug}" not found`);

		const file = this.plugin.app.vault.getAbstractFileByPath(hook.filePath);
		if (file) {
			await this.plugin.app.vault.delete(file);
		}

		this.hooks.delete(slug);
		delete this.state[slug];
		await this.saveState();
	}

	/**
	 * Convenience for the management UI's enable/disable toggle. Equivalent to
	 * `updateHook(slug, { enabled })` but spelled to match the user intent.
	 */
	async toggleHook(slug: string, enabled: boolean): Promise<void> {
		await this.updateHook(slug, { enabled });
	}

	// ── Serialization helpers ───────────────────────────────────────────────

	private toHook(slug: string, filePath: string, params: HookCreateParams): Hook {
		return {
			slug,
			trigger: params.trigger,
			pathGlob: params.pathGlob ? params.pathGlob : undefined,
			frontmatterFilter:
				params.frontmatterFilter && Object.keys(params.frontmatterFilter).length > 0
					? params.frontmatterFilter
					: undefined,
			debounceMs: params.debounceMs ?? DEFAULT_DEBOUNCE_MS,
			maxRunsPerHour: params.maxRunsPerHour && params.maxRunsPerHour > 0 ? params.maxRunsPerHour : undefined,
			cooldownMs: params.cooldownMs ?? DEFAULT_COOLDOWN_MS,
			action: params.action,
			enabledTools: params.enabledTools ?? [],
			enabledSkills: params.enabledSkills ?? [],
			model: params.model || undefined,
			outputPath: params.outputPath || undefined,
			enabled: params.enabled ?? true,
			desktopOnly: params.desktopOnly ?? true,
			prompt: params.prompt,
			commandId: params.commandId || undefined,
			focusFile: params.focusFile === true ? true : undefined,
			filePath,
		};
	}

	/**
	 * Serialize a hook definition to markdown. Only non-default values are
	 * written so files stay minimal and re-saving doesn't add noise.
	 */
	private serializeHook(params: HookCreateParams & { slug: string }): string {
		const lines: string[] = ['---'];
		lines.push(`trigger: '${params.trigger}'`);
		lines.push(`action: '${params.action}'`);

		if (params.pathGlob) lines.push(`pathGlob: ${JSON.stringify(params.pathGlob)}`);

		if (params.frontmatterFilter && Object.keys(params.frontmatterFilter).length > 0) {
			lines.push('frontmatterFilter:');
			for (const [key, value] of Object.entries(params.frontmatterFilter)) {
				lines.push(`  ${key}: ${JSON.stringify(value)}`);
			}
		}

		if (params.debounceMs !== undefined && params.debounceMs !== DEFAULT_DEBOUNCE_MS) {
			lines.push(`debounceMs: ${params.debounceMs}`);
		}
		if (params.maxRunsPerHour !== undefined && params.maxRunsPerHour > 0) {
			lines.push(`maxRunsPerHour: ${params.maxRunsPerHour}`);
		}
		if (params.cooldownMs !== undefined && params.cooldownMs !== DEFAULT_COOLDOWN_MS) {
			lines.push(`cooldownMs: ${params.cooldownMs}`);
		}

		const tools = params.enabledTools ?? [];
		if (tools.length > 0) {
			lines.push('enabledTools:');
			for (const t of tools) lines.push(`  - ${t}`);
		}

		const skills = params.enabledSkills ?? [];
		if (skills.length > 0) {
			lines.push('enabledSkills:');
			for (const s of skills) lines.push(`  - ${s}`);
		}

		if (params.model) lines.push(`model: ${JSON.stringify(params.model)}`);
		if (params.outputPath) lines.push(`outputPath: ${JSON.stringify(params.outputPath)}`);
		if (params.commandId) lines.push(`commandId: ${JSON.stringify(params.commandId)}`);

		// Defaults are enabled=true, desktopOnly=true, focusFile=false —
		// only write when the user picked the non-default value.
		if (params.enabled === false) lines.push('enabled: false');
		if (params.desktopOnly === false) lines.push('desktopOnly: false');
		if (params.focusFile === true) lines.push('focusFile: true');

		// `summarize` and `command` actions don't use the prompt body, but
		// `parseHookFile` rejects empty bodies for `agent-task` and `rewrite`.
		// Emit the body trimmed; for the prompt-less actions an empty body
		// is fine because the parser doesn't enforce a non-empty body for them.
		lines.push('---', '', params.prompt.trim(), '');
		return lines.join('\n');
	}

	// ── Event dispatch ───────────────────────────────────────────────────────

	/**
	 * Entry point for a vault event. Iterates all enabled hooks and schedules
	 * a debounced fire for each one whose filters match.
	 *
	 * Public so tests can drive the manager without registering real vault
	 * listeners.
	 */
	handleEvent(trigger: HookTrigger, file: TAbstractFile, oldPath?: string): void {
		if (!this.initialized || !this.plugin.settings.hooksEnabled) return;
		if (!(file instanceof TFile)) return;

		const filePath = file.path;
		// Implicit exclusion: never fire for events inside the plugin state
		// folder or Obsidian's own config folder. Prevents trivial loops where
		// the hook's own output (e.g. Hooks/Runs/...) re-triggers it.
		if (this.isExcludedPath(filePath)) return;

		for (const hook of this.hooks.values()) {
			if (!hook.enabled) continue;
			if (hook.trigger !== trigger) continue;
			if (!this.passesPlatformGate(hook)) continue;
			if (!matchesGlob(filePath, hook.pathGlob)) continue;

			if (!this.passesFrontmatterFilter(hook, file)) continue;

			const hookState = this.state[hook.slug];
			if (hookState?.pausedDueToErrors) {
				this.plugin.logger.log(
					`[HookManager] Hook "${hook.slug}" is paused after ${MAX_CONSECUTIVE_FAILURES} consecutive failures — skipping`
				);
				continue;
			}

			this.scheduleFire(hook, trigger, file, oldPath);
		}
	}

	private scheduleFire(hook: Hook, trigger: HookTrigger, file: TFile, oldPath: string | undefined): void {
		const key = `${hook.slug}::${file.path}`;

		// Drop events that arrive while a previous fire for the same key is
		// still executing. Prevents agent-loop re-entrancy when the hook's
		// own writes echo back through the vault before its run completes.
		if (this.inflight.has(key)) {
			this.plugin.logger.debug(`[HookManager] Hook "${hook.slug}" already running for ${file.path} — dropping event`);
			return;
		}

		// Cooldown after the most recent fire on this (hook, file).
		const lastFireAt = this.state[hook.slug]?.lastFireAt?.[file.path];
		if (lastFireAt && Date.now() - lastFireAt < hook.cooldownMs) {
			this.plugin.logger.debug(
				`[HookManager] Hook "${hook.slug}" in cooldown for ${file.path} (${hook.cooldownMs}ms) — dropping event`
			);
			return;
		}

		// Reset/extend the per-(hook, file) debounce window.
		const existingTimer = this.debounceTimers.get(key);
		if (existingTimer) window.clearTimeout(existingTimer);

		const timer = window.setTimeout(() => {
			this.debounceTimers.delete(key);
			void this.fireNow(hook, trigger, file, oldPath);
		}, hook.debounceMs);
		this.debounceTimers.set(key, timer);
	}

	private async fireNow(hook: Hook, trigger: HookTrigger, file: TFile, oldPath: string | undefined): Promise<void> {
		const key = `${hook.slug}::${file.path}`;
		const now = Date.now();

		// Hard loop ceiling — auto-pause if too many fires for the same
		// (hook, file) pair land inside the loop window. This catches cases
		// where the cooldown was bypassed (e.g. user is rapidly editing while
		// the hook is also writing).
		const recentFires = (this.state[hook.slug]?.recentFires ?? []).filter((t) => now - t < HARD_LOOP_WINDOW_MS);
		if (recentFires.length >= HARD_LOOP_LIMIT) {
			await this.recordPausedDueToLoop(hook.slug);
			this.plugin.logger.warn(
				`[HookManager] Hook "${hook.slug}" auto-paused: ${HARD_LOOP_LIMIT}+ fires in ${HARD_LOOP_WINDOW_MS}ms`
			);
			return;
		}

		// Per-hour rate limit (if configured).
		if (hook.maxRunsPerHour !== undefined) {
			const hourly = (this.state[hook.slug]?.hourlyFires ?? []).filter((t) => now - t < 60 * 60 * 1000);
			if (hourly.length >= hook.maxRunsPerHour) {
				this.plugin.logger.log(
					`[HookManager] Hook "${hook.slug}" hit maxRunsPerHour=${hook.maxRunsPerHour} — dropping event`
				);
				return;
			}
		}

		// Reserve the inflight slot before any await so concurrent events
		// land on the early-out branch in scheduleFire(). The slot is held
		// for the full duration of the background run — released in the
		// work function's finally block — so a hook can't be re-fired for
		// the same file while its previous run is still executing.
		this.inflight.add(key);

		try {
			await this.recordFire(hook.slug, file.path, now);

			const frontmatter = this.readFrontmatter(file);
			const fireContext: HookFireContext = {
				hook,
				trigger,
				filePath: file.path,
				fileName: file.name,
				oldPath,
				frontmatter,
			};

			this.submitToBackground(fireContext, key);
		} catch (error) {
			// recordFire failed before submission could happen — treat as a
			// hook failure and clear the inflight slot so subsequent events
			// can fire.
			await this.recordFailure(hook.slug, error);
			this.inflight.delete(key);
		}
	}

	/**
	 * Submit the hook fire to BackgroundTaskManager. The work function owns
	 * the lifecycle from this point: success/failure recording, inflight
	 * release, and propagating cancellation through to the runner. Submission
	 * itself is non-blocking — the bg manager runs the work asynchronously
	 * and the run shows up in the unified Activity modal alongside scheduled
	 * tasks, deep research, and image generation.
	 */
	private submitToBackground(ctx: HookFireContext, inflightKey: string): void {
		const bgManager = this.plugin.backgroundTaskManager;
		if (!bgManager) {
			// Fall back to direct execution when the bg manager isn't
			// available (e.g. early in plugin lifecycle or in tests). This
			// preserves the pre-PR2 behaviour as a safe default.
			void this.runDirect(ctx, inflightKey);
			return;
		}

		const label = `${ctx.hook.slug} → ${ctx.fileName}`;
		bgManager.submit('lifecycle-hook', label, async (isCancelled) => {
			try {
				return await this.executeHook(ctx, isCancelled);
			} finally {
				this.inflight.delete(inflightKey);
			}
		});
	}

	private async runDirect(ctx: HookFireContext, inflightKey: string): Promise<void> {
		try {
			await this.executeHook(ctx, () => false);
		} catch {
			// executeHook already recorded the failure; swallow the rethrow
			// so the unawaited promise doesn't surface as an unhandled
			// rejection. The bg-manager path keeps the rethrow because the
			// manager listens for it to emit backgroundTaskFailed events.
		} finally {
			this.inflight.delete(inflightKey);
		}
	}

	private async executeHook(ctx: HookFireContext, isCancelled: () => boolean): Promise<string | undefined> {
		// Lazy import to break the import cycle between HookRunner (which
		// imports HookManager for its types) and this module.
		const { HookRunner } = await import('./hook-runner');
		const runner = new HookRunner(this.plugin, ctx);
		try {
			const outputPath = await runner.run(isCancelled);
			// `undefined` from a successful run means "no outputPath template
			// configured" — the hook still completed, so record success.
			if (!isCancelled()) {
				await this.recordSuccess(ctx.hook.slug);
			}
			return outputPath;
		} catch (error) {
			await this.recordFailure(ctx.hook.slug, error);
			throw error;
		}
	}

	// ── State updates ────────────────────────────────────────────────────────

	private async recordFire(slug: string, filePath: string, at: number): Promise<void> {
		const prev = this.state[slug] ?? {};
		const recentFires = [...(prev.recentFires ?? []).filter((t) => at - t < HARD_LOOP_WINDOW_MS), at];
		const hourlyFires = [...(prev.hourlyFires ?? []).filter((t) => at - t < 60 * 60 * 1000), at];
		const lastFireAt = { ...(prev.lastFireAt ?? {}), [filePath]: at };
		this.state[slug] = { ...prev, recentFires, hourlyFires, lastFireAt };
		await this.saveState();
	}

	private async recordSuccess(slug: string): Promise<void> {
		const prev = this.state[slug] ?? {};
		this.state[slug] = {
			...prev,
			lastError: undefined,
			consecutiveFailures: 0,
			pausedDueToErrors: false,
		};
		await this.saveState();
	}

	private async recordFailure(slug: string, error: unknown): Promise<void> {
		const prev = this.state[slug] ?? {};
		const consecutiveFailures = (prev.consecutiveFailures ?? 0) + 1;
		const pausedDueToErrors = consecutiveFailures >= MAX_CONSECUTIVE_FAILURES;
		this.state[slug] = {
			...prev,
			lastError: error instanceof Error ? error.message : String(error),
			consecutiveFailures,
			pausedDueToErrors,
		};
		await this.saveState();
		if (pausedDueToErrors) {
			this.plugin.logger.warn(
				`[HookManager] Hook "${slug}" paused after ${MAX_CONSECUTIVE_FAILURES} consecutive failures`
			);
		} else {
			this.plugin.logger.error(`[HookManager] Hook "${slug}" failed:`, error);
		}
	}

	private async recordPausedDueToLoop(slug: string): Promise<void> {
		const prev = this.state[slug] ?? {};
		this.state[slug] = {
			...prev,
			pausedDueToErrors: true,
			lastError: `Auto-paused: ${HARD_LOOP_LIMIT}+ fires in ${HARD_LOOP_WINDOW_MS}ms (loop suspected)`,
		};
		await this.saveState();
	}

	// ── Filter / gate helpers ────────────────────────────────────────────────

	private isExcludedPath(filePath: string): boolean {
		const stateFolder = normalizePath(this.plugin.settings.historyFolder) + '/';
		if (filePath === stateFolder.slice(0, -1)) return true;
		if (filePath.startsWith(stateFolder)) return true;
		if (filePath.startsWith('.obsidian/')) return true;
		return false;
	}

	private passesPlatformGate(hook: Hook): boolean {
		if (!hook.desktopOnly) return true;
		return !Platform.isMobile;
	}

	private passesFrontmatterFilter(hook: Hook, file: TFile): boolean {
		if (!hook.frontmatterFilter) return true;
		if (file.extension !== 'md') return false;
		const frontmatter = this.readFrontmatter(file);
		return matchesFrontmatterFilter(frontmatter, hook.frontmatterFilter);
	}

	private readFrontmatter(file: TFile): Record<string, unknown> | undefined {
		if (file.extension !== 'md') return undefined;
		const cache = this.plugin.app.metadataCache.getFileCache(file);
		return cache?.frontmatter as Record<string, unknown> | undefined;
	}

	// ── Vault subscription ──────────────────────────────────────────────────

	private registerEventHandlers(): void {
		const vault = this.plugin.app.vault;

		const onCreate = vault.on('create', (file) => this.handleEvent('file-created', file));
		const onModify = vault.on('modify', (file) => this.handleEvent('file-modified', file));
		const onDelete = vault.on('delete', (file) => this.handleEvent('file-deleted', file));
		const onRename = vault.on('rename', (file, oldPath) => this.handleEvent('file-renamed', file, oldPath));

		this.plugin.registerEvent(onCreate);
		this.plugin.registerEvent(onModify);
		this.plugin.registerEvent(onDelete);
		this.plugin.registerEvent(onRename);

		// Track our refs separately so we can detach without unloading the
		// plugin (e.g. during a settings-driven re-init).
		this.eventRefs = [
			{ off: () => vault.offref(onCreate) },
			{ off: () => vault.offref(onModify) },
			{ off: () => vault.offref(onDelete) },
			{ off: () => vault.offref(onRename) },
		];
	}

	private unregisterEventHandlers(): void {
		for (const ref of this.eventRefs) {
			try {
				ref.off();
			} catch (err) {
				this.plugin.logger.warn('[HookManager] Failed to detach event handler:', err);
			}
		}
		this.eventRefs = [];
	}

	private clearDebounceTimers(): void {
		for (const timer of this.debounceTimers.values()) window.clearTimeout(timer);
		this.debounceTimers.clear();
	}

	// ── Discovery / parsing ─────────────────────────────────────────────────

	private async discoverHooks(): Promise<void> {
		this.hooks.clear();

		const prefix = this.hooksFolder + '/';
		const runsPrefix = this.runsFolder + '/';

		const files = this.plugin.app.vault
			.getMarkdownFiles()
			.filter((f) => f.path.startsWith(prefix) && !f.path.startsWith(runsPrefix));

		for (const file of files) {
			try {
				const hook = await this.parseHookFile(file);
				if (hook) this.hooks.set(hook.slug, hook);
			} catch (err) {
				this.plugin.logger.warn(`[HookManager] Failed to parse hook file ${file.path}:`, err);
			}
		}

		// Drop state entries whose definition file is gone.
		for (const slug of Object.keys(this.state)) {
			if (!this.hooks.has(slug)) {
				delete this.state[slug];
			}
		}
		await this.saveState();
	}

	private async parseHookFile(file: TFile): Promise<Hook | null> {
		const frontmatter = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
		if (!frontmatter) return null;

		const trigger = this.parseTrigger(frontmatter.trigger);
		if (!trigger) return null;

		const action = this.parseAction(frontmatter.action);
		if (!action) return null;

		const content = await this.plugin.app.vault.read(file);
		const offset = findFrontmatterEndOffset(content);
		const prompt = offset !== undefined ? content.slice(offset).trim() : content.trim();

		// agent-task and rewrite need a body to know what to do; summarize
		// and command have their own dedicated paths and treat the body as
		// optional.
		if ((action === 'agent-task' || action === 'rewrite') && !prompt) return null;
		// command requires the commandId field — without it there's nothing
		// to fire.
		const commandId = typeof frontmatter.commandId === 'string' ? frontmatter.commandId : undefined;
		if (action === 'command' && !commandId) return null;

		return {
			slug: file.basename,
			trigger,
			pathGlob: typeof frontmatter.pathGlob === 'string' ? frontmatter.pathGlob : undefined,
			frontmatterFilter:
				frontmatter.frontmatterFilter && typeof frontmatter.frontmatterFilter === 'object'
					? (frontmatter.frontmatterFilter as Record<string, unknown>)
					: undefined,
			debounceMs: typeof frontmatter.debounceMs === 'number' ? frontmatter.debounceMs : DEFAULT_DEBOUNCE_MS,
			maxRunsPerHour: typeof frontmatter.maxRunsPerHour === 'number' ? frontmatter.maxRunsPerHour : undefined,
			cooldownMs: typeof frontmatter.cooldownMs === 'number' ? frontmatter.cooldownMs : DEFAULT_COOLDOWN_MS,
			action,
			enabledTools: Array.isArray(frontmatter.enabledTools) ? (frontmatter.enabledTools as string[]) : [],
			enabledSkills: Array.isArray(frontmatter.enabledSkills) ? (frontmatter.enabledSkills as string[]) : [],
			model: typeof frontmatter.model === 'string' ? frontmatter.model : undefined,
			outputPath: typeof frontmatter.outputPath === 'string' ? frontmatter.outputPath : undefined,
			commandId,
			focusFile: frontmatter.focusFile === true ? true : undefined,
			enabled: frontmatter.enabled !== false,
			desktopOnly: frontmatter.desktopOnly !== false,
			prompt,
			filePath: file.path,
		};
	}

	private parseTrigger(value: unknown): HookTrigger | null {
		if (value === 'file-created' || value === 'file-modified' || value === 'file-deleted' || value === 'file-renamed') {
			return value;
		}
		return null;
	}

	private parseAction(value: unknown): HookAction | null {
		if (value === 'agent-task' || value === 'summarize' || value === 'rewrite' || value === 'command') return value;
		return null;
	}

	// ── State persistence ───────────────────────────────────────────────────

	private async loadState(): Promise<void> {
		try {
			const exists = await this.plugin.app.vault.adapter.exists(this.stateFilePath);
			if (!exists) {
				this.state = {};
				return;
			}
			const raw = await this.plugin.app.vault.adapter.read(this.stateFilePath);
			this.state = JSON.parse(raw) as HooksState;
		} catch (err) {
			this.plugin.logger.warn('[HookManager] Failed to load state, starting fresh:', err);
			this.state = {};
		}
	}

	private async saveState(): Promise<void> {
		try {
			await this.plugin.app.vault.adapter.write(this.stateFilePath, JSON.stringify(this.state, null, 2));
		} catch (err) {
			this.plugin.logger.error('[HookManager] Failed to save state:', err);
		}
	}
}
