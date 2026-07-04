import type { PendingCatchUp, ScheduledTask, ScheduledTasksState } from './types';

/**
 * Returns one entry per task that missed its scheduled run while the plugin
 * was offline. Only tasks with `runIfMissed: true` and `enabled: true` are
 * included. Multiple missed windows for the same task are collapsed into a
 * single entry — the caller just needs to know "this task needs a catch-up
 * run", not how many it missed.
 *
 * Pure function — no plugin/vault state — so it can be unit-tested in isolation.
 * `ScheduledTaskManager.detectMissedRuns` is a thin wrapper that supplies its
 * live task map, sidecar state, and the current instant.
 *
 * @param tasks     The known task definitions to consider.
 * @param state     The sidecar runtime state keyed by slug.
 * @param now       The reference instant treated as "now".
 * @param windowMs  How far back to look. Tasks whose nextRunAt is older than
 *                  this are considered stale and excluded — they missed their
 *                  window entirely.
 */
export function detectMissedRuns(
	tasks: Iterable<ScheduledTask>,
	state: ScheduledTasksState,
	now: Date,
	windowMs: number
): PendingCatchUp[] {
	const cutoff = new Date(now.getTime() - windowMs);
	const result: PendingCatchUp[] = [];

	for (const task of tasks) {
		if (!task.enabled || !task.runIfMissed) continue;
		if (task.schedule === 'once') continue;

		const taskState = state[task.slug];
		if (!taskState) continue;
		if (taskState.pausedDueToErrors) continue;

		const nextRunAt = new Date(taskState.nextRunAt);
		// Due in the past AND within the catch-up window
		if (nextRunAt < now && nextRunAt >= cutoff) {
			result.push({ task, missedAt: nextRunAt });
		}
	}

	return result;
}
