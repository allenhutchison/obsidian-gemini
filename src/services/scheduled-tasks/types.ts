import type { FeatureToolPolicy } from '../../types/tool-policy';

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
	 *   once               — run exactly once, then the task is considered exhausted
	 *   daily              — every 24 h from creation
	 *   daily@HH:MM        — every day at the given local time (e.g. daily@16:30)
	 *   weekly             — every 7 d from creation
	 *   weekly@HH:MM:DAYS  — at the given local time on the listed weekdays
	 *                        (DAYS is comma-separated, e.g. weekly@16:30:mon,tue,wed)
	 *   interval:Xm        — every X minutes (e.g. interval:30m)
	 *   interval:Xh        — every X hours   (e.g. interval:2h)
	 */
	schedule: string;
	/**
	 * Tool policy applied for the duration of each run. Layered on top of the
	 * global plugin policy via FeatureToolPolicy. Undefined means inherit the
	 * global policy.
	 */
	toolPolicy?: FeatureToolPolicy;
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
	/**
	 * Cap on agent tool-execution iterations for this run. Each iteration is one
	 * tool-call batch, not a single tool call. Omitted means use
	 * DEFAULT_HEADLESS_MAX_ITERATIONS. Raise this for long multi-step tasks that
	 * legitimately need more than the default before producing a final response.
	 */
	maxIterations?: number;
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

/** A single missed-run entry returned by detectMissedRuns(). */
export interface PendingCatchUp {
	task: ScheduledTask;
	/** The nextRunAt instant that was missed. */
	missedAt: Date;
}
