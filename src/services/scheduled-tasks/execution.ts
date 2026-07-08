import type { ObsidianGemini } from '../../types/plugin';
import type { FailurePauseTracker } from '../failure-pause-tracker';
import { computeNextRunAt } from './schedule';
import type { ScheduledTask, ScheduledTasksState, TaskState } from './types';

/**
 * Everything the execution-dispatch functions need from the owning
 * `ScheduledTaskManager`, injected so the dispatch logic stays free of the
 * manager class. `getState` is an accessor (not a captured reference) because
 * the manager reassigns `this.state` on load; `tasks` and `submitting` are
 * stable collection references that are only mutated in place.
 */
export interface ExecutionDeps {
	plugin: ObsidianGemini;
	/** Live task map, keyed by slug. */
	tasks: Map<string, ScheduledTask>;
	/** Slugs currently being submitted — guards against tick + runNow double-fire. */
	submitting: Set<string>;
	/** Shared auto-pause-after-N-failures ladder over the per-task sidecar state. */
	failureTracker: FailurePauseTracker<TaskState>;
	/** Accessor for the live sidecar state (reassigned on load, so read lazily). */
	getState: () => ScheduledTasksState;
	/** Persist the current sidecar state to disk. */
	saveState: () => Promise<void>;
}

/**
 * Advance a task's nextRunAt without running it — used before dispatch (so a
 * slow or failed run can't re-fire on the next tick) and by the catch-up
 * "Skip" action indirectly. No-op when the slug is unknown.
 */
async function advanceState(deps: ExecutionDeps, slug: string, from: Date): Promise<void> {
	const task = deps.tasks.get(slug);
	if (!task) return;

	const nextRunAt = computeNextRunAt(task.schedule, from);
	const state = deps.getState();
	state[slug] = {
		...state[slug],
		nextRunAt: nextRunAt.toISOString(),
	};
	await deps.saveState();
}

/**
 * Run a task via the ScheduledTaskRunner and record success/failure against the
 * shared failure tracker. Returns the output path, or `undefined` when the run
 * was cancelled (which is deliberately not recorded as a success).
 */
async function executeTask(
	deps: ExecutionDeps,
	task: ScheduledTask,
	isCancelled: () => boolean
): Promise<string | undefined> {
	try {
		const { ScheduledTaskRunner } = await import('../scheduled-task-runner');
		const runner = new ScheduledTaskRunner(deps.plugin, task);
		const outputPath = await runner.run(isCancelled);

		// undefined means the run was cancelled — don't record as a successful
		// completion so lastRunAt only reflects genuine completions.
		if (outputPath !== undefined) {
			await deps.failureTracker.recordSuccess(task.slug, { lastRunAt: new Date().toISOString() });
		}
		return outputPath;
	} catch (error) {
		await deps.failureTracker.recordFailure(task.slug, error);
		throw error;
	}
}

/**
 * Advance the task's schedule then submit it to BackgroundTaskManager for
 * fire-and-forget execution. The `submitting` guard is held for the full
 * background run so a concurrent tick or runNow can't double-submit the slug.
 *
 * @returns The background task ID returned by BackgroundTaskManager.
 */
export async function submitTask(deps: ExecutionDeps, task: ScheduledTask, triggeredAt: Date): Promise<string> {
	if (deps.submitting.has(task.slug)) {
		throw new Error(`[ScheduledTaskManager] Task "${task.slug}" is already being submitted`);
	}
	deps.submitting.add(task.slug);

	try {
		const bgManager = deps.plugin.backgroundTaskManager;
		if (!bgManager) {
			throw new Error('[ScheduledTaskManager] BackgroundTaskManager not available');
		}

		// Advance nextRunAt immediately — prevents re-firing on the next tick even
		// if the background execution takes longer than 60 s or fails.
		await advanceState(deps, task.slug, triggeredAt);

		const taskId = bgManager.submit(`scheduled-task`, task.slug, async (isCancelled) => {
			try {
				return await executeTask(deps, task, isCancelled);
			} finally {
				// Guard is held for the full background run duration to prevent
				// a concurrent tick or runNow from double-submitting the same slug.
				deps.submitting.delete(task.slug);
			}
		});

		return taskId;
	} catch (error) {
		deps.submitting.delete(task.slug);
		throw error;
	}
}
