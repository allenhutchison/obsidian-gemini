import { describe, expect, it, vi } from 'vitest';
import { hasTerminalTurnEvent, waitForTurnCompletion } from '../../evals/lib/turn-waiter.mjs';

describe('hasTerminalTurnEvent', () => {
	it('detects turnEnd and turnError as terminal states', () => {
		expect(hasTerminalTurnEvent([{ event: 'apiResponseReceived' }, { event: 'turnEnd' }])).toBe(true);
		expect(hasTerminalTurnEvent([{ event: 'turnError' }])).toBe(true);
	});

	it('ignores progress-only event streams', () => {
		expect(hasTerminalTurnEvent([{ event: 'apiResponseReceived' }, { event: 'toolExecutionComplete' }])).toBe(false);
		expect(hasTerminalTurnEvent([])).toBe(false);
	});
});

describe('waitForTurnCompletion', () => {
	it('returns as soon as the collector has a terminal event', async () => {
		let now = 0;
		const snapshots = [[{ event: 'apiResponseReceived' }], [{ event: 'apiResponseReceived' }, { event: 'turnEnd' }]];
		const peekEvents = vi.fn(async () => snapshots.shift() ?? []);
		const sleep = vi.fn(async (ms: number) => {
			now += ms;
		});
		const onPoll = vi.fn();

		const result = await waitForTurnCompletion({
			peekEvents,
			timeoutMs: 10_000,
			pollIntervalMs: 2_000,
			onPoll,
			now: () => now,
			sleep,
		});

		expect(result.completed).toBe(true);
		expect(result.events).toEqual([{ event: 'apiResponseReceived' }, { event: 'turnEnd' }]);
		expect(peekEvents).toHaveBeenCalledTimes(2);
		expect(sleep).toHaveBeenCalledOnce();
		expect(onPoll).toHaveBeenCalledTimes(2);
	});

	it('returns incomplete when the timeout expires before terminal state', async () => {
		let now = 0;
		const events = [{ event: 'apiResponseReceived' }];
		const peekEvents = vi.fn(async () => events);
		const sleep = vi.fn(async (ms: number) => {
			now += ms;
		});

		const result = await waitForTurnCompletion({
			peekEvents,
			timeoutMs: 3_000,
			pollIntervalMs: 2_000,
			now: () => now,
			sleep,
		});

		expect(result.completed).toBe(false);
		expect(result.events).toEqual(events);
		expect(sleep).toHaveBeenNthCalledWith(1, 2_000);
		expect(sleep).toHaveBeenNthCalledWith(2, 1_000);
	});

	it('continues polling after transient collector read failures', async () => {
		let now = 0;
		const peekEvents = vi
			.fn()
			.mockRejectedValueOnce(new Error('cli hiccup'))
			.mockResolvedValueOnce([{ event: 'turnEnd' }]);
		const sleep = vi.fn(async (ms: number) => {
			now += ms;
		});
		const onPollError = vi.fn();

		const result = await waitForTurnCompletion({
			peekEvents,
			timeoutMs: 10_000,
			pollIntervalMs: 2_000,
			onPollError,
			now: () => now,
			sleep,
		});

		expect(result.completed).toBe(true);
		expect(result.events).toEqual([{ event: 'turnEnd' }]);
		expect(onPollError).toHaveBeenCalledOnce();
		expect(sleep).toHaveBeenCalledOnce();
	});
});
