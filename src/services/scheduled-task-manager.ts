import { TFile, normalizePath } from 'obsidian';
import type ObsidianGemini from '../main';
import { ensureFolderExists } from '../utils/file-utils';
import { FeatureToolPolicy } from '../types/tool-policy';
import { formatToolPolicyYaml } from './feature-policy-yaml';
import {
	JsonSidecarStateStore,
	extractMarkdownBody,
	migrateLegacyEnabledTools,
	parseMaxIterations,
	purgeOrphanState,
	resolveFeatureToolPolicy,
} from './feature-definition';
import { FailurePauseTracker, MAX_CONSECUTIVE_FAILURES } from './failure-pause-tracker';
import { computeNextRunAt } from './scheduled-tasks/schedule';
import { detectMissedRuns as detectMissedRunsInWindow } from './scheduled-tasks/missed-runs';
import { submitTask as submitTaskDispatch, type ExecutionDeps } from './scheduled-tasks/execution';
import type { PendingCatchUp, ScheduledTask, ScheduledTasksState, TaskState } from './scheduled-tasks/types';

// Re-export the task types and the pure schedule helper from their new module
// homes so existing import paths (`from '.../scheduled-task-manager'`) keep working.
export type { PendingCatchUp, ScheduledTask, ScheduledTasksState, TaskState } from './scheduled-tasks/types';
export { computeNextRunAt } from './scheduled-tasks/schedule';

// ─── Folder / file layout ─────────────────────────────────────────────────────

const SCHEDULED_TASKS_FOLDER = 'Scheduled-Tasks';
const RUNS_SUBFOLDER = 'Runs';
const STATE_FILE = 'scheduled-tasks-state.json';

/** Milliseconds between scheduler ticks (60 s). Same cadence as ChatTimer. */
const TICK_INTERVAL_MS = 60_000;

// ─── Manager ─────────────────────────────────────────────────────────────────

/**
 * Manages scheduled task definitions stored as markdown files.
 * On each 60-second tick it checks which tasks are due and submits them to
 * BackgroundTaskManager — the actual execution runs fire-and-forget so the
 * scheduler loop is never blocked by slow API calls.
 *
 * Layout inside the plugin state folder:
 *   Scheduled-Tasks/
 *   ├── <slug>.md                       ← task definition (user-edited)
 *   ├── Runs/
 *   │   └── <slug>/
 *   │       └── <date>.md               ← result output
 *   └── scheduled-tasks-state.json      ← volatile runtime state
 */
export class ScheduledTaskManager {
	private tasks = new Map<string, ScheduledTask>();
	private state: ScheduledTasksState = {};
	private tickIntervalId: number | null = null;
	private initialized = false;
	private metadataCacheHandler: ((...data: unknown[]) => unknown) | null = null;
	private vaultCreateHandler: ((...data: unknown[]) => unknown) | null = null;
	/** Slugs of tasks currently being submitted — prevents double-fire from tick + runNow race. */
	private submitting = new Set<string>();
	/**
	 * Slugs claimed by the vault.on('create') handler while its 500 ms defer is
	 * pending. The metadataCache.on('changed') handler skips any slug in this set
	 * to avoid double-parsing when both events fire for the same new file.
	 */
	private recentlyCreated = new Set<string>();
	/**
	 * IDs of in-flight setTimeout calls from vaultCreateHandler defers.
	 * Tracked so they can be cancelled by initialize() (on re-init) and destroy()
	 * to prevent stale callbacks from mutating state after teardown.
	 */
	private pendingDefers = new Set<number>();
	/** Slugs reserved for catch-up approval — tick skips these until approved or skipped. */
	private catchUpPending = new Set<string>();
	private readonly stateStore: JsonSidecarStateStore<ScheduledTasksState>;
	/** Shared auto-pause-after-N-failures ladder over the per-task sidecar state. */
	private readonly failureTracker: FailurePauseTracker<TaskState>;
	/** Dependencies handed to the execution-dispatch module (submit/execute/advance). */
	private readonly execDeps: ExecutionDeps;

	constructor(private plugin: ObsidianGemini) {
		this.stateStore = new JsonSidecarStateStore<ScheduledTasksState>(
			plugin,
			() => this.stateFilePath,
			'[ScheduledTaskManager]'
		);
		this.failureTracker = new FailurePauseTracker<TaskState>({
			getState: (slug) => this.state[slug],
			setState: (slug, next) => {
				this.state[slug] = next;
				return this.saveState();
			},
			logger: this.plugin.logger,
			label: '[ScheduledTaskManager]',
			entityNoun: 'Task',
		});
		this.execDeps = {
			plugin: this.plugin,
			tasks: this.tasks,
			submitting: this.submitting,
			failureTracker: this.failureTracker,
			// `state` is reassigned on load, so read it lazily rather than capturing it.
			getState: () => this.state,
			saveState: () => this.saveState(),
		};
	}

	// ── Folder path helpers ──────────────────────────────────────────────────

	get scheduledTasksFolder(): string {
		return normalizePath(`${this.plugin.settings.historyFolder}/${SCHEDULED_TASKS_FOLDER}`);
	}

	get runsFolder(): string {
		return normalizePath(`${this.scheduledTasksFolder}/${RUNS_SUBFOLDER}`);
	}

	get stateFilePath(): string {
		return normalizePath(`${this.scheduledTasksFolder}/${STATE_FILE}`);
	}

	// ── Lifecycle ────────────────────────────────────────────────────────────

	/**
	 * Discover task definition files and load the sidecar state.
	 *
	 * On a fresh plugin load this is called once from onLayoutReady().
	 * On a settings-save re-init it is called from LifecycleService.setup()
	 * with refresh: true so that historyFolder changes are picked up without
	 * requiring a full plugin restart.
	 *
	 * Passing no arguments (or refresh: false) after the first successful
	 * initialization is a no-op — this prevents the double-init that occurs
	 * when setup() runs with layoutReady === true and onLayoutReady() fires
	 * immediately afterwards.
	 */
	async initialize(options?: { refresh?: boolean }): Promise<void> {
		if (this.initialized && !options?.refresh) return;
		// Cancel any 500 ms defers still waiting from a previous initialization so
		// stale callbacks cannot fire against the freshly-loaded state.
		for (const id of this.pendingDefers) {
			window.clearTimeout(id);
		}
		this.pendingDefers.clear();
		this.recentlyCreated.clear();

		// Unregister previous listeners before re-registering so settings
		// changes (e.g. historyFolder rename) don't leave stale handlers active.
		if (this.metadataCacheHandler) {
			this.plugin.app.metadataCache.off('changed', this.metadataCacheHandler);
			this.metadataCacheHandler = null;
		}
		if (this.vaultCreateHandler) {
			this.plugin.app.vault.off('create', this.vaultCreateHandler);
			this.vaultCreateHandler = null;
		}

		await ensureFolderExists(this.plugin.app.vault, this.scheduledTasksFolder, 'scheduled tasks', this.plugin.logger);
		await ensureFolderExists(this.plugin.app.vault, this.runsFolder, 'scheduled task runs', this.plugin.logger);
		await this.loadState();
		await this.discoverTasks();

		// Re-parse a task definition file whenever the metadata cache updates it
		// (fires after Obsidian re-indexes the frontmatter, so values are current).
		this.metadataCacheHandler = (...data: unknown[]) => {
			const file = data[0];
			if (!(file instanceof TFile)) return;
			const prefix = this.scheduledTasksFolder + '/';
			const runsPrefix = this.runsFolder + '/';
			if (file.path.startsWith(prefix) && !file.path.startsWith(runsPrefix) && file.extension === 'md') {
				const slug = file.basename;
				// Skip if the vault create handler already claimed this slug — it will
				// parse the file after its 500 ms defer, so we don't need to do it here.
				if (this.recentlyCreated.has(slug)) return;
				this.parseTaskFile(file)
					.then(async (task) => {
						if (task) {
							const isNew = !this.tasks.has(task.slug);
							this.tasks.set(task.slug, task);
							// Seed state for tasks newly seen by the hot-reload path
							if (!this.state[task.slug]) {
								this.state[task.slug] = { nextRunAt: new Date().toISOString() };
								await this.saveState();
							}
							// Only log when this is a genuine edit reload, not a re-parse of a task
							// that was already registered by createTask()'s immediate in-memory update.
							if (isNew) {
								this.plugin.logger.log(`[ScheduledTaskManager] Task "${task.slug}" reloaded from disk`);
							}
						} else {
							// File lost its schedule/prompt — remove from scheduler
							this.tasks.delete(slug);
							this.plugin.logger.log(
								`[ScheduledTaskManager] Task "${slug}" removed from scheduler (invalid definition)`
							);
						}
					})
					.catch((err) => this.plugin.logger.warn(`[ScheduledTaskManager] Failed to reload task ${file.path}:`, err));
			}
		};
		this.plugin.app.metadataCache.on('changed', this.metadataCacheHandler);

		// Pick up new task files without a plugin reload. metadataCache 'changed'
		// only fires for already-tracked files; 'create' fires when a brand-new
		// file lands in the vault so the scheduler sees it immediately.
		this.vaultCreateHandler = (...data: unknown[]) => {
			const abstractFile = data[0];
			if (!(abstractFile instanceof TFile)) return;
			const file = abstractFile;
			const prefix = this.scheduledTasksFolder + '/';
			const runsPrefix = this.runsFolder + '/';
			if (file.path.startsWith(prefix) && !file.path.startsWith(runsPrefix) && file.extension === 'md') {
				// Claim the slug immediately so the metadataCache 'changed' handler
				// (which fires before our 500 ms defer) skips this file.
				this.recentlyCreated.add(file.basename);
				// Defer until the metadata cache has indexed the new file's frontmatter.
				// Track the timer so initialize() and destroy() can cancel it if they
				// run before the 500 ms elapses.
				const timerId = window.setTimeout(() => {
					this.pendingDefers.delete(timerId);
					this.recentlyCreated.delete(file.basename);
					// Guard: if the manager was destroyed or re-initialized while the
					// defer was pending, skip the parse — state has been reset.
					if (!this.initialized) return;
					this.parseTaskFile(file)
						.then(async (task) => {
							if (!task) return;
							// Skip if createTask() already registered this task immediately.
							if (this.tasks.has(task.slug)) return;
							this.tasks.set(task.slug, task);
							if (!this.state[task.slug]) {
								this.state[task.slug] = { nextRunAt: new Date().toISOString() };
								await this.saveState();
							}
							this.plugin.logger.log(`[ScheduledTaskManager] Task "${task.slug}" discovered on create`);
						})
						.catch((err) =>
							this.plugin.logger.warn(`[ScheduledTaskManager] Failed to parse new task ${file.path}:`, err)
						);
				}, 500);
				this.pendingDefers.add(timerId);
			}
		};
		this.plugin.app.vault.on('create', this.vaultCreateHandler);

		this.initialized = true;
		this.plugin.logger.log(`[ScheduledTaskManager] Initialized with ${this.tasks.size} task(s)`);
	}

	/**
	 * Start the 60-second tick loop.
	 * Must be called after initialize().
	 */
	start(): void {
		if (this.tickIntervalId !== null) return;
		this.tickIntervalId = window.setInterval(() => {
			this.tick().catch((err) => this.plugin.logger.error('[ScheduledTaskManager] Tick error:', err));
		}, TICK_INTERVAL_MS);
		this.plugin.logger.log('[ScheduledTaskManager] Tick loop started');
	}

	/**
	 * Check all enabled tasks and fire any that are due.
	 * Public so it can be triggered from tests or a "run now" command.
	 */
	async tick(): Promise<void> {
		if (!this.initialized) return;
		const now = new Date();

		for (const task of this.tasks.values()) {
			if (!task.enabled) continue;

			const taskState = this.state[task.slug];
			if (!taskState) continue;

			if (taskState.pausedDueToErrors) {
				this.plugin.logger.log(
					`[ScheduledTaskManager] Task "${task.slug}" is paused after ${MAX_CONSECUTIVE_FAILURES} consecutive failures — skipping`
				);
				continue;
			}

			if (this.catchUpPending.has(task.slug)) {
				this.plugin.logger.log(
					`[ScheduledTaskManager] Task "${task.slug}" is awaiting catch-up approval — skipping tick`
				);
				continue;
			}

			const nextRunAt = new Date(taskState.nextRunAt);
			if (now < nextRunAt) continue;

			this.plugin.logger.log(`[ScheduledTaskManager] Task "${task.slug}" is due — submitting`);
			await submitTaskDispatch(this.execDeps, task, now);
		}
	}

	/**
	 * Force-submit a specific task immediately (e.g. from a command palette action).
	 * @returns The background task ID returned by BackgroundTaskManager.
	 */
	async runNow(slug: string): Promise<string> {
		const task = this.tasks.get(slug);
		if (!task) throw new Error(`Scheduled task "${slug}" not found`);
		this.catchUpPending.delete(slug);
		return submitTaskDispatch(this.execDeps, task, new Date());
	}

	/** Returns a snapshot of all known task definitions. */
	getTasks(): ScheduledTask[] {
		return [...this.tasks.values()];
	}

	/**
	 * Create a new scheduled task by writing a markdown file to the tasks folder.
	 * The metadata cache 'create' listener will pick it up within ~500 ms.
	 */
	async createTask(params: {
		slug: string;
		schedule: string;
		toolPolicy?: FeatureToolPolicy;
		outputPath?: string;
		model?: string;
		maxIterations?: number;
		enabled?: boolean;
		runIfMissed?: boolean;
		prompt: string;
	}): Promise<void> {
		const slug = params.slug.trim();
		if (!slug) throw new Error('Task slug cannot be empty');
		if (this.tasks.has(slug)) throw new Error(`A task named "${slug}" already exists`);

		// Validate schedule before touching the vault — computeNextRunAt throws on
		// unrecognised formats, surfacing the error early rather than persisting a
		// broken task file.
		computeNextRunAt(params.schedule, new Date());

		const filePath = normalizePath(`${this.scheduledTasksFolder}/${slug}.md`);
		const defaultOutputPath = normalizePath(`${this.scheduledTasksFolder}/${RUNS_SUBFOLDER}/${slug}/{date}.md`);
		// Normalize at the write boundary so an invalid value from a programmatic
		// caller can't be persisted or held in memory — matches the read-path
		// contract (parseTaskFile), where invalid values fall back to the default.
		const maxIterations = parseMaxIterations(params.maxIterations);
		const content = this.serializeTask({ ...params, slug, maxIterations });
		await this.plugin.app.vault.create(filePath, content);

		// Immediately reflect in the in-memory map — don't wait for the vault
		// 'create' listener which depends on the metadata cache (~500 ms).
		const task: ScheduledTask = {
			slug,
			schedule: params.schedule,
			toolPolicy: params.toolPolicy,
			outputPath: params.outputPath ?? defaultOutputPath,
			model: params.model,
			maxIterations,
			enabled: params.enabled ?? true,
			runIfMissed: params.runIfMissed ?? false,
			prompt: params.prompt,
			filePath,
		};
		this.tasks.set(slug, task);
		if (!this.state[slug]) {
			this.state[slug] = { nextRunAt: new Date().toISOString() };
			await this.saveState();
		}
	}

	/**
	 * Delete a scheduled task: remove the definition file and its state entry.
	 * The metadata cache 'changed' handler will drop the task from the in-memory
	 * map once Obsidian indexes the deletion; the state cleanup happens immediately.
	 */
	async deleteTask(slug: string): Promise<void> {
		const task = this.tasks.get(slug);
		if (!task) throw new Error(`Scheduled task "${slug}" not found`);

		const file = this.plugin.app.vault.getAbstractFileByPath(task.filePath);
		if (file) {
			await this.plugin.app.fileManager.trashFile(file);
		}

		this.tasks.delete(slug);
		delete this.state[slug];
		await this.saveState();
	}

	/**
	 * Rewrite a task's definition file (frontmatter + prompt body).
	 * Slug is the stable identifier — renaming is not supported via this method.
	 */
	async updateTask(
		slug: string,
		params: {
			schedule?: string;
			toolPolicy?: FeatureToolPolicy;
			outputPath?: string;
			model?: string;
			maxIterations?: number;
			enabled?: boolean;
			runIfMissed?: boolean;
			prompt?: string;
		}
	): Promise<void> {
		const task = this.tasks.get(slug);
		if (!task) throw new Error(`Scheduled task "${slug}" not found`);

		// Validate the new schedule (if provided) before touching the vault.
		if (params.schedule !== undefined) {
			computeNextRunAt(params.schedule, new Date());
		}

		const file = this.plugin.app.vault.getAbstractFileByPath(task.filePath);
		if (!(file instanceof TFile)) throw new Error(`Task file not found: ${task.filePath}`);

		const merged = {
			slug,
			schedule: params.schedule ?? task.schedule,
			toolPolicy: 'toolPolicy' in params ? params.toolPolicy : task.toolPolicy,
			outputPath: params.outputPath ?? task.outputPath,
			model: params.model ?? task.model,
			// Use the `in` check (not ??) so callers can clear back to the default
			// by passing maxIterations: undefined explicitly. Normalize incoming
			// values so an invalid number can't be persisted (matches parseTaskFile).
			maxIterations: 'maxIterations' in params ? parseMaxIterations(params.maxIterations) : task.maxIterations,
			enabled: params.enabled ?? task.enabled,
			runIfMissed: params.runIfMissed ?? task.runIfMissed,
			prompt: params.prompt ?? task.prompt,
		};

		const content = this.serializeTask(merged);
		await this.plugin.app.vault.modify(file, content);

		// Immediately reflect the new values in the in-memory map so callers
		// don't have to wait for the metadata cache listener to re-parse the file.
		this.tasks.set(slug, { ...task, ...merged, filePath: task.filePath });
	}

	/**
	 * Clear the error/pause state for a task so the scheduler will retry it.
	 * Called from the UI "Reset" button after a user fixes the underlying problem.
	 */
	async resetTask(slug: string): Promise<void> {
		await this.failureTracker.reset(slug, { nextRunAt: new Date().toISOString() });
	}

	/**
	 * Returns one entry per task that missed its scheduled run while the plugin
	 * was offline. Only tasks with `runIfMissed: true` and `enabled: true` are
	 * included. Multiple missed windows for the same task are collapsed into a
	 * single entry — the caller just needs to know "this task needs a catch-up
	 * run", not how many it missed.
	 *
	 * @param windowMs  How far back to look (default: 7 days). Tasks whose
	 *                  nextRunAt is older than this are considered stale and
	 *                  excluded — they missed their window entirely.
	 */
	detectMissedRuns(windowMs = 7 * 24 * 60 * 60 * 1000): PendingCatchUp[] {
		return detectMissedRunsInWindow(this.tasks.values(), this.state, new Date(), windowMs);
	}

	/**
	 * Mark slugs as pending catch-up approval so the tick loop skips them
	 * until the user approves or skips each one via the CatchUpModal.
	 */
	reserveForCatchUp(slugs: string[]): void {
		for (const slug of slugs) {
			this.catchUpPending.add(slug);
		}
	}

	/**
	 * Advance a task's nextRunAt without running it — used by the catch-up modal
	 * "Skip" action so the task is not re-detected on the next plugin launch.
	 */
	async skipCatchUp(slug: string): Promise<void> {
		this.catchUpPending.delete(slug);
		const task = this.tasks.get(slug);
		if (!task || !this.state[slug]) return;
		const nextRunAt = computeNextRunAt(task.schedule, new Date());
		this.state[slug] = { ...this.state[slug], nextRunAt: nextRunAt.toISOString() };
		await this.saveState();
		this.plugin.logger.log(
			`[ScheduledTaskManager] Catch-up skipped for "${slug}" — next run at ${nextRunAt.toISOString()}`
		);
	}

	/** Returns a copy of the current runtime state map. */
	getState(): ScheduledTasksState {
		return { ...this.state };
	}

	destroy(): void {
		if (this.tickIntervalId !== null) {
			window.clearInterval(this.tickIntervalId);
			this.tickIntervalId = null;
		}
		if (this.metadataCacheHandler) {
			this.plugin.app.metadataCache.off('changed', this.metadataCacheHandler);
			this.metadataCacheHandler = null;
		}
		if (this.vaultCreateHandler) {
			this.plugin.app.vault.off('create', this.vaultCreateHandler);
			this.vaultCreateHandler = null;
		}
		// Cancel any 500 ms defers still in flight — their callbacks check
		// this.initialized before touching state, but clearing here is the
		// belt-and-suspenders guarantee that no timer fires after teardown.
		for (const id of this.pendingDefers) {
			window.clearTimeout(id);
		}
		this.pendingDefers.clear();
		this.tasks.clear();
		this.state = {};
		this.recentlyCreated.clear();
		this.initialized = false;
		this.plugin.logger.log('[ScheduledTaskManager] Destroyed');
	}

	// ── Private ──────────────────────────────────────────────────────────────

	private async discoverTasks(): Promise<void> {
		this.tasks.clear();

		const prefix = this.scheduledTasksFolder + '/';
		const runsPrefix = this.runsFolder + '/';

		// All markdown files directly inside Scheduled-Tasks/ (not in Runs/ or deeper)
		const files = this.plugin.app.vault
			.getMarkdownFiles()
			.filter((f) => f.path.startsWith(prefix) && !f.path.startsWith(runsPrefix));

		for (const file of files) {
			try {
				const task = await this.parseTaskFile(file);
				if (!task) continue;

				this.tasks.set(task.slug, task);

				// Seed state entry for newly-discovered tasks: due immediately
				if (!this.state[task.slug]) {
					this.state[task.slug] = { nextRunAt: new Date().toISOString() };
				}
			} catch (error) {
				this.plugin.logger.warn(`[ScheduledTaskManager] Failed to parse task file ${file.path}:`, error);
			}
		}

		// Drop state entries for slugs whose definition file is gone. The tick
		// already tolerates orphan state, but stripping it on init keeps the
		// JSON tidy and prevents stale lastError messages from accumulating.
		for (const slug of purgeOrphanState(this.state, (s) => this.tasks.has(s))) {
			this.plugin.logger.log(`[ScheduledTaskManager] Purged orphan state entry for "${slug}" (no matching task file)`);
		}

		await this.saveState();
	}

	private async parseTaskFile(file: TFile): Promise<ScheduledTask | null> {
		const frontmatter = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
		if (!frontmatter?.schedule) return null;

		const prompt = extractMarkdownBody(await this.plugin.app.vault.read(file));
		if (!prompt) return null;

		const slug = file.basename;
		const defaultOutputPath = `${this.scheduledTasksFolder}/${RUNS_SUBFOLDER}/${slug}/{date}.md`;

		const task: ScheduledTask = {
			slug,
			schedule: String(frontmatter.schedule),
			toolPolicy: resolveFeatureToolPolicy(frontmatter),
			outputPath: typeof frontmatter.outputPath === 'string' ? frontmatter.outputPath : defaultOutputPath,
			model: typeof frontmatter.model === 'string' ? frontmatter.model : undefined,
			maxIterations: parseMaxIterations(frontmatter.maxIterations),
			enabled: frontmatter.enabled !== false,
			runIfMissed: frontmatter.runIfMissed === true,
			prompt,
			filePath: file.path,
		};

		// Auto-migrate the file in place when we read the legacy shape so the
		// next read uses the canonical key. Failures are non-fatal.
		const migration = migrateLegacyEnabledTools(
			this.plugin,
			file,
			frontmatter,
			() => this.serializeTask(task),
			'[ScheduledTaskManager]'
		);
		if (migration) await migration;

		return task;
	}

	/**
	 * Serialize a task definition to markdown (YAML frontmatter + prompt body).
	 * Only non-default values are written to keep files minimal.
	 */
	private serializeTask(params: {
		slug?: string;
		schedule: string;
		toolPolicy?: FeatureToolPolicy;
		outputPath?: string;
		model?: string;
		maxIterations?: number;
		enabled?: boolean;
		runIfMissed?: boolean;
		prompt: string;
	}): string {
		const lines: string[] = ['---'];
		lines.push(`schedule: '${params.schedule}'`);

		const policyLines = formatToolPolicyYaml(params.toolPolicy);
		if (policyLines) {
			lines.push(...policyLines);
		}

		const defaultOutputPath =
			params.slug && normalizePath(`${this.scheduledTasksFolder}/${RUNS_SUBFOLDER}/${params.slug}/{date}.md`);
		if (params.outputPath && params.outputPath !== defaultOutputPath) {
			lines.push(`outputPath: '${params.outputPath}'`);
		}

		if (params.model) {
			lines.push(`model: '${params.model}'`);
		}
		if (params.maxIterations !== undefined) {
			lines.push(`maxIterations: ${params.maxIterations}`);
		}
		if (params.enabled === false) {
			lines.push('enabled: false');
		}
		if (params.runIfMissed === true) {
			lines.push('runIfMissed: true');
		}

		lines.push('---', '', params.prompt.trim(), '');
		return lines.join('\n');
	}

	private async loadState(): Promise<void> {
		this.state = await this.stateStore.load();
	}

	private async saveState(): Promise<void> {
		await this.stateStore.save(this.state);
	}
}
