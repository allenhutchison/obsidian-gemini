import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { TimeoutError, withTimeout } from '../../src/utils/timeout';

describe('withTimeout', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	test('resolves with the inner promise value when it settles first', async () => {
		const promise = withTimeout(Promise.resolve('ok'), 1000, 'op');
		await expect(promise).resolves.toBe('ok');
	});

	test('propagates rejection of the inner promise', async () => {
		const error = new Error('inner failed');
		const promise = withTimeout(Promise.reject(error), 1000, 'op');
		await expect(promise).rejects.toBe(error);
	});

	test('rejects with TimeoutError when the inner promise does not settle in time', async () => {
		const slow = new Promise<string>(() => {
			/* never settles */
		});
		const promise = withTimeout(slow, 100, 'slow op');

		// Capture the promise BEFORE advancing the timer so the rejection
		// handler is attached and Node's unhandled-rejection guard stays quiet.
		const assertion = expect(promise).rejects.toThrow(TimeoutError);
		await vi.advanceTimersByTimeAsync(100);
		await assertion;
	});

	test('TimeoutError carries the label and duration in its message', async () => {
		const slow = new Promise<string>(() => {});
		const promise = withTimeout(slow, 250, 'my operation');
		const assertion = expect(promise).rejects.toThrow('my operation timed out after 250ms');
		await vi.advanceTimersByTimeAsync(250);
		await assertion;
	});

	test('does not fire the timeout after the inner promise resolves', async () => {
		let resolveInner!: (v: string) => void;
		const inner = new Promise<string>((r) => {
			resolveInner = r;
		});
		const racer = withTimeout(inner, 1000, 'op');

		resolveInner('done');
		await expect(racer).resolves.toBe('done');

		// Advance the clock past the timeout window; nothing should reject.
		await vi.advanceTimersByTimeAsync(2000);
	});

	test('does not fire the timeout after the inner promise rejects', async () => {
		let rejectInner!: (e: Error) => void;
		const inner = new Promise<string>((_, r) => {
			rejectInner = r;
		});
		const racer = withTimeout(inner, 1000, 'op');

		const innerError = new Error('inner');
		rejectInner(innerError);
		await expect(racer).rejects.toBe(innerError);

		// Advance the clock; the cleared timer must not produce a second rejection.
		await vi.advanceTimersByTimeAsync(2000);
	});
});

describe('TimeoutError', () => {
	test('is a real Error subclass with name set', () => {
		const err = new TimeoutError('boom');
		expect(err).toBeInstanceOf(Error);
		expect(err).toBeInstanceOf(TimeoutError);
		expect(err.name).toBe('TimeoutError');
		expect(err.message).toBe('boom');
	});
});
