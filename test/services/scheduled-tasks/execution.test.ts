import { describe, it, expect, vi, beforeEach } from 'vitest';
import { submitTask, type ExecutionDeps } from '../../../src/services/scheduled-tasks/execution';
import type { FailurePauseTracker } from '../../../src/services/failure-pause-tracker';
import type { ScheduledTask, ScheduledTasksState, TaskState } from '../../../src/services/scheduled-tasks/types';

// advanceState calls computeNextRunAt to derive the next slot; stub it so tests
// can assert the advanced nextRunAt without depending on the real schedule math
// (that is covered in schedule.test.ts).
const { computeNextRunAt } = vi.hoisted(() => ({ computeNextRunAt: vi.fn() }));
vi.mock('../../../src/services/scheduled-tasks/schedule', () => ({ computeNextRunAt }));

// executeTask dynamically imports ScheduledTaskRunner; stub it with a controllable
// run() so the callback tests can drive the resolve (success), undefined (cancel),
// and reject (failure) paths.
const { runnerRun } = vi.hoisted(() => ({ runnerRun: vi.fn() }));
vi.mock('../../../src/services/scheduled-task-runner', () => ({
	ScheduledTaskRunner: class {
		run = runnerRun;
	},
}));

const FIXED_NEXT_RUN = new Date(2026, 5, 2, 12, 0);
const TRIGGERED_AT = new Date(2026, 5, 1, 12, 0);

function makeTask(slug: string): ScheduledTask {
	return {
		slug,
		schedule: 'daily',
		outputPath: `Scheduled-Tasks/Runs/${slug}/{date}.md`,
		enabled: true,
		runIfMissed: false,
		prompt: 'do the thing',
		filePath: `Scheduled-Tasks/${slug}.md`,
	};
}

/**
 * Build an ExecutionDeps stub plus handles for the injected collaborators, so
 * tests exercise the execution.ts surface directly (no ScheduledTaskManager).
 * When `registerTask` is false the task is left out of the `tasks` map, which
 * drives advanceState's unknown-slug no-op branch.
 */
function makeHarness(task: ScheduledTask, opts: { withBgManager?: boolean; registerTask?: boolean } = {}) {
	const { withBgManager = true, registerTask = true } = opts;

	let capturedWork: ((isCancelled: () => boolean) => Promise<string | undefined>) | undefined;
	const submit = vi.fn(
		(_type: string, _label: string, work: (isCancelled: () => boolean) => Promise<string | undefined>) => {
			capturedWork = work;
			return 'bg-task-1';
		}
	);

	const state: ScheduledTasksState = {};
	const tasks = new Map<string, ScheduledTask>();
	if (registerTask) tasks.set(task.slug, task);
	const submitting = new Set<string>();

	const recordSuccess = vi.fn().mockResolvedValue(undefined);
	const recordFailure = vi.fn().mockResolvedValue(undefined);
	const saveState = vi.fn().mockResolvedValue(undefined);

	const plugin = {
		backgroundTaskManager: withBgManager ? { submit } : undefined,
	} as unknown as ExecutionDeps['plugin'];

	const deps: ExecutionDeps = {
		plugin,
		tasks,
		submitting,
		failureTracker: { recordSuccess, recordFailure } as unknown as FailurePauseTracker<TaskState>,
		getState: () => state,
		saveState,
	};

	return {
		deps,
		submit,
		saveState,
		recordSuccess,
		recordFailure,
		submitting,
		state,
		// Drive the fire-and-forget background callback that submit captured.
		runWork: () => {
			if (!capturedWork) throw new Error('submit was never called');
			return capturedWork(() => false);
		},
	};
}

beforeEach(() => {
	computeNextRunAt.mockReset().mockReturnValue(FIXED_NEXT_RUN);
	runnerRun.mockReset();
});

describe('scheduled-tasks/execution · submitTask', () => {
	it('throws and skips BackgroundTaskManager when the slug is already submitting', async () => {
		const task = makeTask('busy');
		const h = makeHarness(task);
		h.submitting.add('busy');

		await expect(submitTask(h.deps, task, TRIGGERED_AT)).rejects.toThrow('already being submitted');
		expect(h.submit).not.toHaveBeenCalled();
		expect(h.saveState).not.toHaveBeenCalled();
		// The pre-existing guard entry (owned by the other in-flight submit) is left intact.
		expect(h.submitting.has('busy')).toBe(true);
	});

	it('throws and releases the submitting guard when backgroundTaskManager is absent', async () => {
		const task = makeTask('no-bg');
		const h = makeHarness(task, { withBgManager: false });

		await expect(submitTask(h.deps, task, TRIGGERED_AT)).rejects.toThrow('BackgroundTaskManager not available');
		// The guard added at the top of submitTask must be released on the error path.
		expect(h.submitting.has('no-bg')).toBe(false);
	});

	it('advances nextRunAt via advanceState before dispatching to submit', async () => {
		const task = makeTask('advance');
		const h = makeHarness(task);

		await submitTask(h.deps, task, TRIGGERED_AT);

		expect(computeNextRunAt).toHaveBeenCalledWith('daily', TRIGGERED_AT);
		expect(h.state.advance.nextRunAt).toBe(FIXED_NEXT_RUN.toISOString());
		expect(h.saveState).toHaveBeenCalledTimes(1);
		expect(h.submit).toHaveBeenCalledTimes(1);
		// advanceState (saveState) must complete before the hand-off to submit.
		expect(h.saveState.mock.invocationCallOrder[0]).toBeLessThan(h.submit.mock.invocationCallOrder[0]);
	});

	it('returns the background task id and holds the submitting guard until the background run settles', async () => {
		const task = makeTask('hold');
		const h = makeHarness(task);
		runnerRun.mockResolvedValue('out.md');

		const id = await submitTask(h.deps, task, TRIGGERED_AT);

		expect(id).toBe('bg-task-1');
		// Guard is still held while the background callback is outstanding.
		expect(h.submitting.has('hold')).toBe(true);

		await h.runWork();
		// Released only after the background callback's finally runs.
		expect(h.submitting.has('hold')).toBe(false);
	});

	it('is a no-op in advanceState (no state write, no saveState) when the slug is unknown', async () => {
		const task = makeTask('ghost');
		// Task is not registered in the tasks map → advanceState returns early.
		const h = makeHarness(task, { registerTask: false });

		await submitTask(h.deps, task, TRIGGERED_AT);

		expect(computeNextRunAt).not.toHaveBeenCalled();
		expect(h.saveState).not.toHaveBeenCalled();
		expect(h.state.ghost).toBeUndefined();
		// Dispatch still happens — the unknown-slug guard is only in advanceState.
		expect(h.submit).toHaveBeenCalledTimes(1);
	});
});

describe('scheduled-tasks/execution · executeTask (via the background callback)', () => {
	it('records success with a lastRunAt and returns the output path', async () => {
		const task = makeTask('ok');
		const h = makeHarness(task);
		runnerRun.mockResolvedValue('gemini-scribe/Scheduled-Tasks/Runs/ok/2026-06-01.md');

		await submitTask(h.deps, task, TRIGGERED_AT);
		const result = await h.runWork();

		expect(result).toBe('gemini-scribe/Scheduled-Tasks/Runs/ok/2026-06-01.md');
		expect(h.recordSuccess).toHaveBeenCalledTimes(1);
		const [slug, patch] = h.recordSuccess.mock.calls[0];
		expect(slug).toBe('ok');
		expect(typeof patch.lastRunAt).toBe('string');
		expect(Number.isNaN(new Date(patch.lastRunAt).getTime())).toBe(false);
		expect(h.recordFailure).not.toHaveBeenCalled();
	});

	it('does not record success and returns undefined when the run is cancelled', async () => {
		const task = makeTask('cancelled');
		const h = makeHarness(task);
		runnerRun.mockResolvedValue(undefined);

		await submitTask(h.deps, task, TRIGGERED_AT);
		const result = await h.runWork();

		expect(result).toBeUndefined();
		expect(h.recordSuccess).not.toHaveBeenCalled();
		expect(h.recordFailure).not.toHaveBeenCalled();
	});

	it('records failure, re-throws, and still releases the guard when the runner throws', async () => {
		const task = makeTask('boom');
		const h = makeHarness(task);
		const error = new Error('runner exploded');
		runnerRun.mockRejectedValue(error);

		await submitTask(h.deps, task, TRIGGERED_AT);

		await expect(h.runWork()).rejects.toThrow('runner exploded');
		expect(h.recordFailure).toHaveBeenCalledWith('boom', error);
		expect(h.recordSuccess).not.toHaveBeenCalled();
		// The finally in the background callback releases the guard even on failure.
		expect(h.submitting.has('boom')).toBe(false);
	});
});
