import { Platform, TAbstractFile, TFile, normalizePath } from 'obsidian';
import type { ObsidianGemini } from '../types/plugin';
import { ensureFolderExists, shouldExcludePath } from '../utils/file-utils';
import type { AgentEventMap } from '../types/agent-events';
import type {
	AgentTurnSummary,
	Hook,
	HookCreateParams,
	HookFields,
	HookFireContext,
	HookState,
	HooksState,
	HookTrigger,
	HookUpdateParams,
} from './hook-types';
import { validateFeatureSlug } from '../utils/feature-slug';
import {
	AGENT_TURN_FIRE_KEY,
	AGENT_TURN_TRIGGER,
	isActionAllowedForTrigger,
	isOutputPathAllowedForTrigger,
	mergeHookFields,
	missingRequiredHookFields,
	normalizeHookFields,
	parseHookFields,
	serializeHookFields,
} from './hook-types';
import { extractMarkdownBody, migrateLegacyEnabledTools } from './feature-definition';
import { FileBackedFeatureManager } from './file-backed-feature-manager';
import { FailurePauseTracker, MAX_CONSECUTIVE_FAILURES } from './failure-pause-tracker';
import { matchesFrontmatterFilter, matchesGlob } from './hook-matcher';
import { STATE_SUBFOLDERS } from './state-folder';
import { t } from '../i18n';

// ─── Folder / file layout ─────────────────────────────────────────────────────

const STATE_FILE = 'hooks-state.json';

/** Hard loop ceiling: max fires per (hook, file) inside the loop window. */
const HARD_LOOP_LIMIT = 5;
const HARD_LOOP_WINDOW_MS = 60_000;

// ─── Public types ─────────────────────────────────────────────────────────────
//
// Hook definition/state/fire-context types and renderPrompt live in the leaf
// module ./hook-types so hook-runner can import them without creating a
// manager ↔ runner import cycle (see #1155). Re-exported here so existing
// import paths keep working.

export type {
	AgentTurnSummary,
	Hook,
	HookAction,
	HookCreateParams,
	HookFireContext,
	HookState,
	HooksState,
	HookTrigger,
	HookUpdateParams,
} from './hook-types';
export { renderPrompt } from './hook-types';

// Hook slugs become file basenames inside `Hooks/`, so they follow the shared
// feature-slug contract (src/utils/feature-slug.ts): lowercase ASCII
// letters/digits/hyphens, 1–64 chars, no leading/trailing or consecutive
// hyphens, no path separators. Hooks deliberately do NOT require a leading
// letter — `2fa-cleanup` is legal here, though it would be an invalid skill
// name (the skills system follows the agentskills.io spec, which anchors on
// a leading letter). The predicate is shared; the divergence is that
// module's parameter.
function validateSlug(raw: string): string {
	const slug = raw.trim();
	const result = validateFeatureSlug(slug);
	if (!result.valid) {
		// The leaf reports the first failing rule; the hook messages keep
		// their historical wording (the pre-shared-contract strings).
		throw new Error(
			result.error === 'cannot be empty'
				? 'Hook slug cannot be empty'
				: 'Hook slug must be lowercase letters, digits, and hyphens only (no leading/trailing or consecutive hyphens)'
		);
	}
	return slug;
}

/**
 * Reject an action the trigger can't run (`summarize`/`rewrite` on the
 * agent-turn trigger) before it reaches disk, where the next load would skip
 * the whole hook.
 */
function assertActionAllowed(fields: HookFields): void {
	if (!isActionAllowedForTrigger(fields.trigger, fields.action)) {
		throw new Error(`Action "${fields.action}" can't run for trigger "${fields.trigger}"`);
	}
}

/**
 * Reject an output path that uses `{fileName}` on the agent-turn trigger,
 * which has no file. It would resolve to an empty name: a hidden `.md` that
 * every run writes to.
 */
function assertOutputPathAllowed(fields: HookFields): void {
	if (!isOutputPathAllowedForTrigger(fields.trigger, fields.outputPath)) {
		throw new Error(`Output path can't use {fileName} for trigger "${fields.trigger}", which has no file`);
	}
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
export class HookManager extends FileBackedFeatureManager<Hook, HookState> {
	private hooks = new Map<string, Hook>();
	private initialized = false;
	/**
	 * Per-(hook, file) debounce timers, keyed by `${slug}::${filePath}`.
	 * Agent-turn fires use `AGENT_TURN_FIRE_KEY` in place of the path.
	 */
	private debounceTimers = new Map<string, number>();
	/** Set of `${slug}::${filePath}` currently executing — drops re-entrant events. */
	private inflight = new Set<string>();
	/** Vault event handlers registered via plugin.registerEvent — kept for off(). */
	private eventRefs: { off: () => void }[] = [];
	/** Turns merged by an agent-turn hook's pending debounce window, keyed by slug. */
	private pendingTurns = new Map<string, AgentTurnSummary>();
	/** Detaches the `turnEnd` subscription; set only while some hook uses the agent-turn trigger. */
	private turnEndUnsubscribe: (() => void) | null = null;
	/** Shared auto-pause-after-N-failures ladder over the per-hook sidecar state. */
	private readonly failureTracker: FailurePauseTracker<HookState>;

	constructor(plugin: ObsidianGemini) {
		super(plugin, {
			featureFolder: STATE_SUBFOLDERS.hooks,
			stateFileName: STATE_FILE,
			logPrefix: '[HookManager]',
			featureNoun: 'hook',
			entityLabel: 'Hook',
		});
		this.failureTracker = this.createFailureTracker({ entityNoun: 'Hook', logFailures: true });
	}

	// ── Folder path helpers ──────────────────────────────────────────────────

	/** Public alias for the base's feature-folder path (kept for callers). */
	get hooksFolder(): string {
		return this.featureFolderPath;
	}

	/** The base operates on this map; `hooks` keeps its descriptive name. */
	protected get definitions(): Map<string, Hook> {
		return this.hooks;
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
			this.unsubscribeTurnEnd();
			this.hooks.clear();
			this.state = {};
			this.initialized = true;
			this.plugin.logger.log('[HookManager] Hooks disabled — skipping initialization');
			return;
		}

		// Hooks/ is deliberately NOT in FolderInitializer's EAGER_SUBFOLDERS: it
		// is gated on settings.hooksEnabled, so vaults with hooks off never get
		// an empty folder (see state-folder.ts). That makes this manager — the
		// only code that knows whether hooks are on — the folder's single
		// owner: both creation sites for Hooks/ + Runs/ live here, and
		// FolderInitializer never creates them. Runs/ is created eagerly here
		// alongside Hooks/; per-run files inside it create deeper parents on
		// demand via ensureParentFolderExists.
		await ensureFolderExists(this.plugin.app.vault, this.hooksFolder, 'hooks', this.plugin.logger);
		await ensureFolderExists(this.plugin.app.vault, this.runsFolder, 'hook runs', this.plugin.logger);
		await this.loadState();
		await this.discoverDefinitions();
		this.registerEventHandlers();
		this.syncTurnEndSubscription();

		this.initialized = true;
		this.plugin.logger.log(`[HookManager] Initialized with ${this.hooks.size} hook(s)`);
	}

	/**
	 * Tear down event subscriptions, cancel pending debounces, and clear
	 * in-memory state. Safe to call repeatedly.
	 */
	destroy(): void {
		this.unregisterEventHandlers();
		this.unsubscribeTurnEnd();
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
		// Deep clone via serialization round-trip; the state is JSON-serializable.
		return JSON.parse(JSON.stringify(this.state)) as HooksState;
	}

	/**
	 * Manually clear `pausedDueToErrors` so a paused hook can fire again.
	 */
	async resetHook(slug: string): Promise<void> {
		await this.failureTracker.reset(slug);
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
		// Normalize at the write boundary so an invalid value from a programmatic
		// caller can't be persisted or held in memory — the same descriptor table
		// the read path uses, so the two cannot drift.
		const fields = normalizeHookFields(params);
		// A `trigger` or `action` that failed validation normalizes to
		// `undefined`, and serializing that would write a definition file
		// `parseDefinitionFile` refuses to load — a hook that vanishes on the
		// next reload. Reject it here instead, like an invalid slug.
		const missing = missingRequiredHookFields(fields);
		if (missing.length > 0) throw new Error(`Hook is missing or has an invalid ${missing.join(' and ')}`);
		assertActionAllowed(fields);
		assertOutputPathAllowed(fields);

		const content = this.serializeHook(fields, params.prompt);
		await this.plugin.app.vault.create(filePath, content);

		const hook: Hook = { slug, ...fields, prompt: params.prompt, filePath };
		this.hooks.set(slug, hook);
		if (!this.state[slug]) {
			this.state[slug] = {};
			await this.saveState();
		}
		this.syncTurnEndSubscription();
	}

	/**
	 * Rewrite an existing hook's definition file. Slug is the stable
	 * identifier; renaming is not supported via this method.
	 */
	async updateHook(slug: string, params: HookUpdateParams): Promise<void> {
		const hook = this.hooks.get(slug);
		if (!hook) throw new Error(`Hook "${slug}" not found`);

		const file = this.plugin.app.vault.getAbstractFileByPath(hook.filePath);
		if (!(file instanceof TFile)) throw new Error(`Hook file not found: ${hook.filePath}`);

		// Every field merges with replace semantics: a key present in `params`
		// wins even when its value is `undefined`, which is how the edit form
		// clears an optional field. `prompt` is the exception — it is the file
		// body rather than a frontmatter field, and an omitted prompt means
		// "leave the body alone", not "blank it".
		const merged = mergeHookFields(hook, params);
		assertActionAllowed(merged);
		assertOutputPathAllowed(merged);
		const prompt = params.prompt ?? hook.prompt;

		const content = this.serializeHook(merged, prompt);
		await this.plugin.app.vault.modify(file, content);

		this.hooks.set(slug, { slug, ...merged, prompt, filePath: hook.filePath });
		this.syncTurnEndSubscription();
	}

	/**
	 * Delete a hook: remove the definition file and its state entry.
	 */
	async deleteHook(slug: string): Promise<void> {
		await this.deleteDefinition(slug);
		this.cancelPending(slug);
		this.syncTurnEndSubscription();
	}

	/**
	 * Drop a slug's armed debounce timers and merged turn summary, so a hook
	 * re-created under the same slug inside the window doesn't inherit them.
	 */
	private cancelPending(slug: string): void {
		const prefix = `${slug}::`;
		for (const [key, timer] of this.debounceTimers) {
			if (!key.startsWith(prefix)) continue;
			window.clearTimeout(timer);
			this.debounceTimers.delete(key);
		}
		this.pendingTurns.delete(slug);
	}

	/**
	 * Convenience for the management UI's enable/disable toggle. Equivalent to
	 * `updateHook(slug, { enabled })` but spelled to match the user intent.
	 */
	async toggleHook(slug: string, enabled: boolean): Promise<void> {
		await this.updateHook(slug, { enabled });
	}

	// ── Serialization helpers ───────────────────────────────────────────────

	/**
	 * Serialize a hook definition to markdown. Field-by-field emission (order,
	 * quoting, and which values are elided as defaults) lives in the HOOK_FIELDS
	 * descriptor table; this only wraps the result in the frontmatter fences and
	 * appends the prompt body.
	 *
	 * `summarize` and `command` actions don't use the prompt body, but
	 * `parseDefinitionFile` rejects empty bodies for `agent-task` and `rewrite`.
	 * Emit the body trimmed; for the prompt-less actions an empty body is fine
	 * because the parser doesn't enforce a non-empty body for them.
	 */
	private serializeHook(fields: HookFields, prompt: string): string {
		return ['---', ...serializeHookFields(fields), '---', '', prompt.trim(), ''].join('\n');
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
			if (hook.trigger !== trigger) continue;
			if (!this.passesCommonGates(hook)) continue;
			if (!matchesGlob(filePath, hook.pathGlob)) continue;

			if (!this.passesFrontmatterFilter(hook, file)) continue;

			this.scheduleFire(hook, trigger, file, oldPath);
		}
	}

	/**
	 * Entry point for the end of an interactive agent turn (the `turnEnd`
	 * event). Schedules a debounced fire for each enabled hook on the
	 * agent-turn trigger. The file filters don't apply: a turn has no file.
	 *
	 * Public so tests can drive the manager without a real event bus.
	 */
	handleTurnEnd(payload: AgentEventMap['turnEnd']): void {
		if (!this.initialized || !this.plugin.settings.hooksEnabled) return;
		// A headless run (scheduled task, agent-task hook) never fires this
		// trigger, or a hook's own run could trigger it again. Headless turns
		// don't emit turnEnd today; this keeps that true if one ever does.
		if (payload.session.ephemeral) return;

		for (const hook of this.hooks.values()) {
			if (hook.trigger !== AGENT_TURN_TRIGGER) continue;
			if (!this.passesCommonGates(hook)) continue;
			this.scheduleTurnFire(hook, payload);
		}
	}

	/** The gates every trigger shares: enabled, platform, and auto-pause. */
	private passesCommonGates(hook: Hook): boolean {
		if (!hook.enabled) return false;
		if (!this.passesPlatformGate(hook)) return false;
		if (this.state[hook.slug]?.pausedDueToErrors) {
			this.plugin.logger.log(
				`[HookManager] Hook "${hook.slug}" is paused after ${MAX_CONSECUTIVE_FAILURES} consecutive failures — skipping`
			);
			return false;
		}
		return true;
	}

	private scheduleFire(hook: Hook, trigger: HookTrigger, file: TFile, oldPath: string | undefined): void {
		if (!this.admitEvent(hook, file.path)) return;
		this.armDebounce(hook, file.path, () =>
			this.fireNow(hook, file.path, `${hook.slug} → ${file.name}`, (current) => ({
				hook: current,
				trigger,
				filePath: file.path,
				fileName: file.name,
				oldPath,
				// Read at fire time, not at event time: the debounce exists so
				// the note has settled.
				frontmatter: this.readFrontmatter(file),
			}))
		);
	}

	/**
	 * Merge this turn into the hook's pending window and (re)arm its debounce.
	 * Counts are summed across merged turns; everything else is the latest's.
	 */
	private scheduleTurnFire(hook: Hook, payload: AgentEventMap['turnEnd']): void {
		if (!this.admitEvent(hook, AGENT_TURN_FIRE_KEY)) return;

		const prev = this.pendingTurns.get(hook.slug);
		this.pendingTurns.set(hook.slug, {
			outcome: payload.outcome,
			turnCount: (prev?.turnCount ?? 0) + 1,
			toolCallCount: (prev?.toolCallCount ?? 0) + payload.toolCallCount,
			sessionTitle: payload.session.title,
			userMessage: payload.userMessage,
		});

		this.armDebounce(hook, AGENT_TURN_FIRE_KEY, () => {
			const turn = this.pendingTurns.get(hook.slug);
			this.pendingTurns.delete(hook.slug);
			if (!turn) return Promise.resolve();
			return this.fireNow(hook, AGENT_TURN_FIRE_KEY, `${hook.slug} → ${t('hooks.agentTurnMeta')}`, (current) => ({
				hook: current,
				trigger: AGENT_TURN_TRIGGER,
				filePath: '',
				fileName: '',
				turn,
			}));
		});
	}

	/**
	 * The inflight and cooldown checks shared by every trigger. `fireKey` is
	 * the file path, or `AGENT_TURN_FIRE_KEY` for an agent-turn fire.
	 */
	private admitEvent(hook: Hook, fireKey: string): boolean {
		const key = `${hook.slug}::${fireKey}`;

		// Drop events that arrive while a previous fire for the same key is
		// still executing. Prevents agent-loop re-entrancy when the hook's
		// own writes echo back through the vault before its run completes.
		if (this.inflight.has(key)) {
			this.plugin.logger.debug(`[HookManager] Hook "${hook.slug}" already running for ${fireKey} — dropping event`);
			return false;
		}

		// Cooldown after the most recent fire on this (hook, file).
		const lastFireAt = this.state[hook.slug]?.lastFireAt?.[fireKey];
		if (lastFireAt && Date.now() - lastFireAt < hook.cooldownMs) {
			this.plugin.logger.debug(
				`[HookManager] Hook "${hook.slug}" in cooldown for ${fireKey} (${hook.cooldownMs}ms) — dropping event`
			);
			return false;
		}
		return true;
	}

	/** Reset/extend the per-(hook, fireKey) debounce window. */
	private armDebounce(hook: Hook, fireKey: string, fire: () => Promise<void>): void {
		const key = `${hook.slug}::${fireKey}`;
		const existingTimer = this.debounceTimers.get(key);
		if (existingTimer) window.clearTimeout(existingTimer);

		const timer = window.setTimeout(() => {
			this.debounceTimers.delete(key);
			void fire();
		}, hook.debounceMs);
		this.debounceTimers.set(key, timer);
	}

	private async fireNow(
		scheduled: Hook,
		fireKey: string,
		label: string,
		buildContext: (current: Hook) => HookFireContext
	): Promise<void> {
		// The debounce window can outlive the Hook object captured when the
		// event arrived: the user may disable, edit, or delete the hook (or it
		// may pause) before the timer fires. Re-resolve by slug and re-apply
		// the gates so the current definition, not the captured one, decides.
		const current = this.hooks.get(scheduled.slug);
		if (!current || current.trigger !== scheduled.trigger || !this.passesCommonGates(current)) {
			this.plugin.logger.debug(
				`[HookManager] Hook "${scheduled.slug}" changed, was disabled, or was removed before its debounce fired — skipping`
			);
			return;
		}
		const hook = current;

		const key = `${hook.slug}::${fireKey}`;
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
		// land on the early-out branch in admitEvent(). The slot is held
		// for the full duration of the background run — released in the
		// work function's finally block — so a hook can't be re-fired for
		// the same file while its previous run is still executing.
		this.inflight.add(key);

		try {
			await this.recordFire(hook.slug, fireKey, now);
			this.submitToBackground(buildContext(hook), key, label);
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
	private submitToBackground(ctx: HookFireContext, inflightKey: string, label: string): void {
		const bgManager = this.plugin.backgroundTaskManager;
		if (!bgManager) {
			// Fall back to direct execution when the bg manager isn't
			// available (e.g. early in plugin lifecycle or in tests). This
			// preserves the pre-PR2 behaviour as a safe default.
			void this.runDirect(ctx, inflightKey);
			return;
		}

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

	private async recordFire(slug: string, fireKey: string, at: number): Promise<void> {
		const prev = this.state[slug] ?? {};
		const recentFires = [...(prev.recentFires ?? []).filter((t) => at - t < HARD_LOOP_WINDOW_MS), at];
		const hourlyFires = [...(prev.hourlyFires ?? []).filter((t) => at - t < 60 * 60 * 1000), at];
		const lastFireAt = { ...(prev.lastFireAt ?? {}), [fireKey]: at };
		this.state[slug] = { ...prev, recentFires, hourlyFires, lastFireAt };
		await this.saveState();
	}

	private async recordSuccess(slug: string): Promise<void> {
		await this.failureTracker.recordSuccess(slug);
	}

	private async recordFailure(slug: string, error: unknown): Promise<void> {
		await this.failureTracker.recordFailure(slug, error);
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
		// Excludes the plugin state folder and the Obsidian configuration directory.
		// Delegates to the shared helper so the containment semantics live in one place.
		return shouldExcludePath(
			filePath,
			normalizePath(this.plugin.settings.historyFolder),
			this.plugin.app.vault.configDir
		);
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
		return cache?.frontmatter;
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
		this.pendingTurns.clear();
	}

	/**
	 * Subscribe to `turnEnd` while at least one hook uses the agent-turn
	 * trigger, and detach otherwise, so vaults without such a hook pay nothing
	 * per turn. Called after discovery and after every create/update/delete.
	 */
	private syncTurnEndSubscription(): void {
		const wanted =
			this.plugin.settings.hooksEnabled && [...this.hooks.values()].some((h) => h.trigger === AGENT_TURN_TRIGGER);
		if (wanted && !this.turnEndUnsubscribe) {
			const bus = this.plugin.agentEventBus;
			if (!bus) return;
			this.turnEndUnsubscribe = bus.on('turnEnd', async (payload) => this.handleTurnEnd(payload));
		} else if (!wanted) {
			this.unsubscribeTurnEnd();
		}
	}

	private unsubscribeTurnEnd(): void {
		this.turnEndUnsubscribe?.();
		this.turnEndUnsubscribe = null;
	}

	// ── Discovery / parsing ─────────────────────────────────────────────────

	protected async parseDefinitionFile(file: TFile): Promise<Hook | null> {
		// Deliberately permissive about the slug (#1485): validation is a
		// create-path contract (validateSlug runs in createHook/updateHook);
		// existing on-disk files keep loading regardless of their basename.
		const frontmatter = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
		if (!frontmatter) return null;

		// One walk of the HOOK_FIELDS table replaces the field-by-field literal
		// this used to build, so a field can't be added to `Hook` and read here
		// while being silently dropped on the write path. `null` means `trigger`
		// or `action` is missing/unrecognised — the two fields with no default.
		const fields = parseHookFields(frontmatter);
		if (!fields) return null;

		const prompt = extractMarkdownBody(await this.plugin.app.vault.read(file));

		// agent-task and rewrite need a body to know what to do; summarize
		// and command have their own dedicated paths and treat the body as
		// optional.
		if ((fields.action === 'agent-task' || fields.action === 'rewrite') && !prompt) return null;
		// command requires the commandId field — without it there's nothing
		// to fire.
		if (fields.action === 'command' && !fields.commandId) return null;
		// summarize and rewrite act on the triggering file, and the agent-turn
		// trigger has none.
		if (!isActionAllowedForTrigger(fields.trigger, fields.action)) {
			this.plugin.logger.warn(
				`[HookManager] Hook "${file.basename}" skipped: action "${fields.action}" can't run for trigger "${fields.trigger}"`
			);
			return null;
		}
		// {fileName} in the output path would resolve to an empty name.
		if (!isOutputPathAllowedForTrigger(fields.trigger, fields.outputPath)) {
			this.plugin.logger.warn(
				`[HookManager] Hook "${file.basename}" skipped: outputPath can't use {fileName} for trigger "${fields.trigger}", which has no file`
			);
			return null;
		}

		const hook: Hook = { slug: file.basename, ...fields, prompt, filePath: file.path };

		// Auto-migrate the legacy on-disk shape so the next load reads the new
		// canonical key without re-running the migration. Failures are non-fatal.
		const migration = migrateLegacyEnabledTools(
			this.plugin,
			file,
			frontmatter,
			() => this.serializeHook(hook, hook.prompt),
			'[HookManager]'
		);
		if (migration) await migration;

		return hook;
	}
}
