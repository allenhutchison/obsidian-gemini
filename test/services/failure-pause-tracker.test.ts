import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	FailurePauseTracker,
	MAX_CONSECUTIVE_FAILURES,
	type FailurePauseState,
} from '../../src/services/failure-pause-tracker';
import type { Logger } from '../../src/utils/logger';

interface TestState extends FailurePauseState {
	lastRunAt?: string;
	nextRunAt?: string;
}

function makeLogger() {
	return { log: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() } as unknown as Logger;
}

function makeTracker(
	overrides: Partial<ConstructorParameters<typeof FailurePauseTracker<TestState>>[0]> = {},
	initial: Record<string, TestState> = {}
) {
	const store: Record<string, TestState> = { ...initial };
	const setState = vi.fn((slug: string, next: TestState) => {
		store[slug] = next;
	});
	const logger = makeLogger();
	const tracker = new FailurePauseTracker<TestState>({
		getState: (slug) => store[slug],
		setState,
		logger,
		label: '[TestManager]',
		entityNoun: 'Thing',
		...overrides,
	});
	return { tracker, store, setState, logger };
}

describe('FailurePauseTracker', () => {
	beforeEach(() => vi.clearAllMocks());

	it('exports a shared default threshold of 3', () => {
		expect(MAX_CONSECUTIVE_FAILURES).toBe(3);
	});

	describe('recordFailure ladder', () => {
		it('first failure sets counter to 1 without pausing', async () => {
			const { tracker, store, logger } = makeTracker();
			const outcome = await tracker.recordFailure('a', new Error('boom'));
			expect(outcome).toEqual({ consecutiveFailures: 1, pausedDueToErrors: false });
			expect(store.a).toMatchObject({
				lastError: 'boom',
				consecutiveFailures: 1,
				pausedDueToErrors: false,
			});
			expect(logger.warn).not.toHaveBeenCalled();
		});

		it('accumulates consecutive failures across calls', async () => {
			const { tracker, store } = makeTracker();
			await tracker.recordFailure('a', new Error('1'));
			const second = await tracker.recordFailure('a', new Error('2'));
			expect(second.consecutiveFailures).toBe(2);
			expect(store.a.lastError).toBe('2');
			expect(store.a.pausedDueToErrors).toBe(false);
		});

		it('pauses and warns once the threshold is reached', async () => {
			const { tracker, store, logger } = makeTracker();
			await tracker.recordFailure('a', new Error('1'));
			await tracker.recordFailure('a', new Error('2'));
			const outcome = await tracker.recordFailure('a', new Error('3'));
			expect(outcome).toEqual({ consecutiveFailures: 3, pausedDueToErrors: true });
			expect(store.a.pausedDueToErrors).toBe(true);
			expect(logger.warn).toHaveBeenCalledWith('[TestManager] Thing "a" paused after 3 consecutive failures');
		});

		it('respects a custom maxFailures threshold', async () => {
			const { tracker } = makeTracker({ maxFailures: 1 });
			const outcome = await tracker.recordFailure('a', new Error('boom'));
			expect(outcome.pausedDueToErrors).toBe(true);
		});

		it('only error-logs non-pausing failures when logFailures is true', async () => {
			const { tracker: quiet, logger: quietLog } = makeTracker();
			await quiet.recordFailure('a', new Error('boom'));
			expect(quietLog.error).not.toHaveBeenCalled();

			const { tracker: loud, logger: loudLog } = makeTracker({ logFailures: true });
			const err = new Error('boom');
			await loud.recordFailure('a', err);
			expect(loudLog.error).toHaveBeenCalledWith('[TestManager] Thing "a" failed:', err);
		});

		it('merges an entity-specific patch into the failed state', async () => {
			const { tracker, store } = makeTracker();
			await tracker.recordFailure('a', new Error('boom'), { nextRunAt: 'later' });
			expect(store.a.nextRunAt).toBe('later');
			expect(store.a.consecutiveFailures).toBe(1);
		});
	});

	describe('recordSuccess', () => {
		it('clears failure state and unpauses', async () => {
			const { tracker, store } = makeTracker(
				{},
				{
					a: { lastError: 'boom', consecutiveFailures: 3, pausedDueToErrors: true },
				}
			);
			await tracker.recordSuccess('a');
			expect(store.a).toMatchObject({
				lastError: undefined,
				consecutiveFailures: 0,
				pausedDueToErrors: false,
			});
		});

		it('applies an entity-specific patch while clearing failures', async () => {
			const { tracker, store } = makeTracker(
				{},
				{
					a: { consecutiveFailures: 2, nextRunAt: 'keep-me' },
				}
			);
			await tracker.recordSuccess('a', { lastRunAt: 'now' });
			expect(store.a.lastRunAt).toBe('now');
			expect(store.a.nextRunAt).toBe('keep-me');
			expect(store.a.consecutiveFailures).toBe(0);
		});

		it('does not let a patch override the success invariants', async () => {
			const { tracker, store } = makeTracker();
			await tracker.recordSuccess('a', { pausedDueToErrors: true, consecutiveFailures: 9 } as Partial<TestState>);
			expect(store.a.pausedDueToErrors).toBe(false);
			expect(store.a.consecutiveFailures).toBe(0);
		});
	});

	describe('reset', () => {
		it('clears failure state for an existing entry', async () => {
			const { tracker, store, setState } = makeTracker(
				{},
				{
					a: { lastError: 'boom', consecutiveFailures: 3, pausedDueToErrors: true },
				}
			);
			await tracker.reset('a');
			expect(setState).toHaveBeenCalledOnce();
			expect(store.a).toMatchObject({
				lastError: undefined,
				consecutiveFailures: 0,
				pausedDueToErrors: false,
			});
		});

		it('applies an entity-specific patch on reset', async () => {
			const { tracker, store } = makeTracker({}, { a: { pausedDueToErrors: true } });
			await tracker.reset('a', { nextRunAt: 'rescheduled' });
			expect(store.a.nextRunAt).toBe('rescheduled');
			expect(store.a.pausedDueToErrors).toBe(false);
		});

		it('is a no-op when no record exists', async () => {
			const { tracker, setState } = makeTracker();
			await tracker.reset('missing');
			expect(setState).not.toHaveBeenCalled();
		});
	});

	describe('isPaused', () => {
		it('reflects the stored pause flag', () => {
			const { tracker } = makeTracker(
				{},
				{
					paused: { pausedDueToErrors: true },
					ok: { pausedDueToErrors: false },
				}
			);
			expect(tracker.isPaused('paused')).toBe(true);
			expect(tracker.isPaused('ok')).toBe(false);
			expect(tracker.isPaused('missing')).toBe(false);
		});
	});

	it('awaits an async setState (persistence) before resolving', async () => {
		const order: string[] = [];
		const setState = vi.fn(async () => {
			await Promise.resolve();
			order.push('saved');
		});
		const tracker = new FailurePauseTracker<TestState>({
			getState: () => undefined,
			setState,
			logger: makeLogger(),
			label: '[TestManager]',
			entityNoun: 'Thing',
		});
		await tracker.recordFailure('a', new Error('boom'));
		order.push('after');
		expect(order).toEqual(['saved', 'after']);
	});
});
