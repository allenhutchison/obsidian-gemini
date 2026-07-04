import { describe, it, expect } from 'vitest';
import { detectMissedRuns } from '../../../src/services/scheduled-tasks/missed-runs';
import type { ScheduledTask, ScheduledTasksState } from '../../../src/services/scheduled-tasks/types';

function makeTask(overrides: Partial<ScheduledTask> & { slug: string }): ScheduledTask {
	return {
		schedule: 'daily',
		outputPath: `Scheduled-Tasks/Runs/${overrides.slug}/{date}.md`,
		enabled: true,
		runIfMissed: true,
		prompt: 'do the thing',
		filePath: `Scheduled-Tasks/${overrides.slug}.md`,
		...overrides,
	};
}

const NOW = new Date(2026, 5, 1, 12, 0);
const WINDOW = 7 * 24 * 60 * 60 * 1000;
const oneHourAgo = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();
const inOneHour = new Date(NOW.getTime() + 60 * 60 * 1000).toISOString();

describe('scheduled-tasks/missed-runs · detectMissedRuns', () => {
	it('includes an enabled runIfMissed task whose nextRunAt is past but within the window', () => {
		const task = makeTask({ slug: 'a' });
		const state: ScheduledTasksState = { a: { nextRunAt: oneHourAgo } };
		const result = detectMissedRuns([task], state, NOW, WINDOW);
		expect(result).toHaveLength(1);
		expect(result[0].task.slug).toBe('a');
		expect(result[0].missedAt).toEqual(new Date(oneHourAgo));
	});

	it('excludes disabled tasks and tasks with runIfMissed=false', () => {
		const disabled = makeTask({ slug: 'disabled', enabled: false });
		const noCatchUp = makeTask({ slug: 'noCatchUp', runIfMissed: false });
		const state: ScheduledTasksState = {
			disabled: { nextRunAt: oneHourAgo },
			noCatchUp: { nextRunAt: oneHourAgo },
		};
		expect(detectMissedRuns([disabled, noCatchUp], state, NOW, WINDOW)).toEqual([]);
	});

	it('excludes once schedules, paused tasks, and tasks with no state entry', () => {
		const once = makeTask({ slug: 'once', schedule: 'once' });
		const paused = makeTask({ slug: 'paused' });
		const stateless = makeTask({ slug: 'stateless' });
		const state: ScheduledTasksState = {
			once: { nextRunAt: oneHourAgo },
			paused: { nextRunAt: oneHourAgo, pausedDueToErrors: true },
			// no entry for `stateless`
		};
		expect(detectMissedRuns([once, paused, stateless], state, NOW, WINDOW)).toEqual([]);
	});

	it('excludes future runs and runs older than the catch-up window', () => {
		const future = makeTask({ slug: 'future' });
		const stale = makeTask({ slug: 'stale' });
		const state: ScheduledTasksState = {
			future: { nextRunAt: inOneHour },
			stale: { nextRunAt: new Date(NOW.getTime() - WINDOW - 60_000).toISOString() },
		};
		expect(detectMissedRuns([future, stale], state, NOW, WINDOW)).toEqual([]);
	});
});
