import { TFile, normalizePath } from 'obsidian';
import type ObsidianGemini from '../main';
import { ensureFolderExists } from '../utils/file-utils';
import { findFrontmatterEndOffset } from './skill-manager';

// ─── Folder / file layout ─────────────────────────────────────────────────────

const SCHEDULED_TASKS_FOLDER = 'Scheduled-Tasks';
const RUNS_SUBFOLDER = 'Runs';
const STATE_FILE = 'scheduled-tasks-state.json';

/** Milliseconds between scheduler ticks (60 s). Same cadence as ChatTimer. */
const TICK_INTERVAL_MS = 60_000;

/** Pause the task after this many consecutive failures. */
const MAX_CONSECUTIVE_FAILURES = 3;

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * A scheduled task definition parsed from a markdown file.
 * The file lives at {historyFolder}/Scheduled-Tasks/<slug>.md.
 * Frontmatter controls scheduling; the file body is the prompt text.
 */
export interface ScheduledTask {
	/** Derived from the file basename (no extension). */
	slug: string;
	/**
	 * Schedule string. Supported values:
	 *   once        — run exactly once, then the task is considered exhausted
	 *   daily       — every 24 h
	 *   weekly      — every 7 d
	 *   interval:Xm — every X minutes  (e.g. interval:30m)
	 *   interval:Xh — every X hours    (e.g. interval:2h)
	 */
	schedule: string;
	/** ToolCategory enum values to enable for this session (e.g. ['read_only']). */
	enabledTools: string[];
	/**
	 * Output path template. Supports {slug} and {date} placeholders.
	 * Default: Scheduled-Tasks/Runs/{slug}/{date}.md
	 */
	outputPath: string;
	/**
	 * Model override for this task (e.g. 'gemini-2.0-flash').
	 * Defaults to the plugin's chat model when omitted.
	 */
	model?: string;
	/** When false the scheduler skips this task entirely. Default: true. */
	enabled: boolean;
	/**
	 * When true and the task missed its window (plugin was offline), run once
	 * immediately on the next tick instead of skipping the missed run.
	 * Default: false.
	 */
	runIfMissed: boolean;
	/** Prompt text — the file body after the closing frontmatter delimiter. */
	prompt: string;
	/** Vault path of the task definition file. */
	filePath: string;
}

/** Per-task volatile runtime state stored in the sidecar JSON. */
export interface TaskState {
	/** ISO-8601 date string for the next scheduled run. */
	nextRunAt: string;
	/** ISO-8601 date string for the last successful run, if any. */
	lastRunAt?: string;
	/** Error message from the most recent failed run, if any. */
	lastError?: string;
	/** Number of consecutive failures since the last success. */
	consecutiveFailures?: number;
	/**
	 * When true the scheduler skips this task until the user manually resets it.
	 * Set automatically after MAX_CONSECUTIVE_FAILURES failures in a row.
	 */
	pausedDueToErrors?: boolean;
}

/** The full sidecar state file — a map of slug → TaskState. */
export type ScheduledTasksState = Record<string, TaskState>;

// ─── Pure helper ─────────────────────────────────────────────────────────────

/**
 * Compute the next run time given a schedule string and a reference instant.
 * Pure function — no I/O — safe to unit-test in isolation.
 *
 * @throws {Error} if the schedule string is not recognised
 */
export function computeNextRunAt(schedule: string, from: Date): Date {
	switch (schedule) {
		case 'once':
			// Far-future sentinel: task has run once and should not fire again
			return new Date(8640000000000000);
		case 'daily':
			return new Date(from.getTime() + 24 * 60 * 60 * 1000);
		case 'weekly':
			return new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
		default: {
			if (schedule.startsWith('interval:')) {
				const spec = schedule.slice('interval:'.length);
				const match = /^(\d+)(m|h)$/.exec(spec);
				if (!match) {
					throw new Error(`Invalid interval schedule: "${schedule}". Expected format: interval:Xm or interval:Xh`);
				}
				const value = parseInt(match[1], 10);
				if (value <= 0) {
					throw new Error(`Invalid interval schedule: "${schedule}". Interval must be greater than zero`);
				}
				const ms = match[2] === 'h' ? value * 60 * 60 * 1000 : value * 60 * 1000;
				return new Date(from.getTime() + ms);
			}
			throw new Error(`Unknown schedule type: "${schedule}". Expected: once, daily, weekly, interval:Xm, interval:Xh`);
		}
	}
}

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

	constructor(private plugin: ObsidianGemini) {}

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
			const file = data[0] as TFile;
			const prefix = this.scheduledTasksFolder + '/';
			const runsPrefix = this.runsFolder + '/';
			if (file?.path?.startsWith(prefix) && !file.path.startsWith(runsPrefix) && file.extension === 'md') {
				const slug = file.basename;
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
				// Defer until the metadata cache has indexed the new file's frontmatter.
				setTimeout(() => {
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

			const nextRunAt = new Date(taskState.nextRunAt);
			if (now < nextRunAt) continue;

			this.plugin.logger.log(`[ScheduledTaskManager] Task "${task.slug}" is due — submitting`);
			await this.submitTask(task, now);
		}
	}

	/**
	 * Force-submit a specific task immediately (e.g. from a command palette action).
	 * @returns The background task ID returned by BackgroundTaskManager.
	 */
	async runNow(slug: string): Promise<string> {
		const task = this.tasks.get(slug);
		if (!task) throw new Error(`Scheduled task "${slug}" not found`);
		return this.submitTask(task, new Date());
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
		enabledTools?: string[];
		outputPath?: string;
		model?: string;
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
		const content = this.serializeTask({ ...params, slug });
		await this.plugin.app.vault.create(filePath, content);

		// Immediately reflect in the in-memory map — don't wait for the vault
		// 'create' listener which depends on the metadata cache (~500 ms).
		const task: ScheduledTask = {
			slug,
			schedule: params.schedule,
			enabledTools: params.enabledTools ?? [],
			outputPath: params.outputPath ?? defaultOutputPath,
			model: params.model,
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
			await this.plugin.app.vault.delete(file);
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
			enabledTools?: string[];
			outputPath?: string;
			model?: string;
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
		if (!file) throw new Error(`Task file not found: ${task.filePath}`);

		const merged = {
			slug,
			schedule: params.schedule ?? task.schedule,
			enabledTools: params.enabledTools ?? task.enabledTools,
			outputPath: params.outputPath ?? task.outputPath,
			model: params.model ?? task.model,
			enabled: params.enabled ?? task.enabled,
			runIfMissed: params.runIfMissed ?? task.runIfMissed,
			prompt: params.prompt ?? task.prompt,
		};

		const content = this.serializeTask(merged);
		await this.plugin.app.vault.modify(file as TFile, content);

		// Immediately reflect the new values in the in-memory map so callers
		// don't have to wait for the metadata cache listener to re-parse the file.
		this.tasks.set(slug, { ...task, ...merged, filePath: task.filePath });
	}

	/**
	 * Clear the error/pause state for a task so the scheduler will retry it.
	 * Called from the UI "Reset" button after a user fixes the underlying problem.
	 */
	async resetTask(slug: string): Promise<void> {
		if (!this.state[slug]) return;
		this.state[slug] = {
			...this.state[slug],
			nextRunAt: new Date().toISOString(),
			lastError: undefined,
			consecutiveFailures: 0,
			pausedDueToErrors: false,
		};
		await this.saveState();
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
		this.tasks.clear();
		this.state = {};
		this.initialized = false;
		this.plugin.logger.log('[ScheduledTaskManager] Destroyed');
	}

	// ── Private ──────────────────────────────────────────────────────────────

	private async submitTask(task: ScheduledTask, triggeredAt: Date): Promise<string> {
		if (this.submitting.has(task.slug)) {
			throw new Error(`[ScheduledTaskManager] Task "${task.slug}" is already being submitted`);
		}
		this.submitting.add(task.slug);

		try {
			const bgManager = this.plugin.backgroundTaskManager;
			if (!bgManager) {
				throw new Error('[ScheduledTaskManager] BackgroundTaskManager not available');
			}

			// Advance nextRunAt immediately — prevents re-firing on the next tick even
			// if the background execution takes longer than 60 s or fails.
			await this.advanceState(task.slug, triggeredAt);

			const taskId = bgManager.submit(`scheduled-task`, task.slug, async (isCancelled) => {
				try {
					return await this.executeTask(task, isCancelled);
				} finally {
					// Guard is held for the full background run duration to prevent
					// a concurrent tick or runNow from double-submitting the same slug.
					this.submitting.delete(task.slug);
				}
			});

			return taskId;
		} catch (error) {
			this.submitting.delete(task.slug);
			throw error;
		}
	}

	private async executeTask(task: ScheduledTask, isCancelled: () => boolean): Promise<string | undefined> {
		try {
			const { ScheduledTaskRunner } = await import('./scheduled-task-runner');
			const runner = new ScheduledTaskRunner(this.plugin, task);
			const outputPath = await runner.run(isCancelled);

			// undefined means the run was cancelled — don't record as a successful
			// completion so lastRunAt only reflects genuine completions.
			if (outputPath !== undefined) {
				this.state[task.slug] = {
					...this.state[task.slug],
					lastRunAt: new Date().toISOString(),
					lastError: undefined,
					consecutiveFailures: 0,
					pausedDueToErrors: false,
				};
				await this.saveState();
			}
			return outputPath;
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			const prev = this.state[task.slug];
			const consecutiveFailures = (prev?.consecutiveFailures ?? 0) + 1;
			const pausedDueToErrors = consecutiveFailures >= MAX_CONSECUTIVE_FAILURES;

			if (pausedDueToErrors) {
				this.plugin.logger.warn(
					`[ScheduledTaskManager] Task "${task.slug}" paused after ${MAX_CONSECUTIVE_FAILURES} consecutive failures`
				);
			}

			this.state[task.slug] = {
				...prev,
				lastError: msg,
				consecutiveFailures,
				pausedDueToErrors,
			};
			await this.saveState();
			throw error;
		}
	}

	private async advanceState(slug: string, from: Date): Promise<void> {
		const task = this.tasks.get(slug);
		if (!task) return;

		const nextRunAt = computeNextRunAt(task.schedule, from);
		this.state[slug] = {
			...this.state[slug],
			nextRunAt: nextRunAt.toISOString(),
		};
		await this.saveState();
	}

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

		await this.saveState();
	}

	private async parseTaskFile(file: TFile): Promise<ScheduledTask | null> {
		const frontmatter = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
		if (!frontmatter?.schedule) return null;

		const content = await this.plugin.app.vault.read(file);
		const offset = findFrontmatterEndOffset(content);
		const prompt = offset !== undefined ? content.slice(offset).trim() : content.trim();
		if (!prompt) return null;

		const slug = file.basename;
		const defaultOutputPath = `${this.scheduledTasksFolder}/${RUNS_SUBFOLDER}/${slug}/{date}.md`;

		return {
			slug,
			schedule: String(frontmatter.schedule),
			enabledTools: Array.isArray(frontmatter.enabledTools) ? (frontmatter.enabledTools as string[]) : [],
			outputPath: typeof frontmatter.outputPath === 'string' ? frontmatter.outputPath : defaultOutputPath,
			model: typeof frontmatter.model === 'string' ? frontmatter.model : undefined,
			enabled: frontmatter.enabled !== false,
			runIfMissed: frontmatter.runIfMissed === true,
			prompt,
			filePath: file.path,
		};
	}

	/**
	 * Serialize a task definition to markdown (YAML frontmatter + prompt body).
	 * Only non-default values are written to keep files minimal.
	 */
	private serializeTask(params: {
		slug?: string;
		schedule: string;
		enabledTools?: string[];
		outputPath?: string;
		model?: string;
		enabled?: boolean;
		runIfMissed?: boolean;
		prompt: string;
	}): string {
		const lines: string[] = ['---'];
		lines.push(`schedule: '${params.schedule}'`);

		const tools = params.enabledTools ?? [];
		if (tools.length > 0) {
			lines.push('enabledTools:');
			for (const t of tools) {
				lines.push(`  - ${t}`);
			}
		}

		const defaultOutputPath =
			params.slug && normalizePath(`${this.scheduledTasksFolder}/${RUNS_SUBFOLDER}/${params.slug}/{date}.md`);
		if (params.outputPath && params.outputPath !== defaultOutputPath) {
			lines.push(`outputPath: '${params.outputPath}'`);
		}

		if (params.model) {
			lines.push(`model: '${params.model}'`);
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
		try {
			const exists = await this.plugin.app.vault.adapter.exists(this.stateFilePath);
			if (!exists) {
				this.state = {};
				return;
			}
			const raw = await this.plugin.app.vault.adapter.read(this.stateFilePath);
			this.state = JSON.parse(raw) as ScheduledTasksState;
		} catch (error) {
			this.plugin.logger.warn('[ScheduledTaskManager] Failed to load state, starting fresh:', error);
			this.state = {};
		}
	}

	private async saveState(): Promise<void> {
		try {
			await this.plugin.app.vault.adapter.write(this.stateFilePath, JSON.stringify(this.state, null, 2));
		} catch (error) {
			this.plugin.logger.error('[ScheduledTaskManager] Failed to save state:', error);
		}
	}
}
