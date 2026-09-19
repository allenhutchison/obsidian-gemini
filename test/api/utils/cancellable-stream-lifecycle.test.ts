import { describe, it, expect, vi } from 'vitest';
import { runCancellableStream } from '../../../src/api/utils/cancellable-stream';
import type { ModelResponse } from '../../../src/api/interfaces/model-api';

const RESP: ModelResponse = { markdown: '', rendered: '' };

/** Wrap literal values into an async iterable (the helper's start contract). */
function of<T>(...values: T[]): AsyncIterable<T> {
	return (async function* () {
		for (const v of values) yield v;
	})();
}

/** A stream that yields `values`, then blocks until the signal aborts. */
function blockingStream(values: unknown[], signal?: AbortSignal): AsyncIterable<unknown> {
	return (async function* () {
		for (const v of values) {
			yield v;
			await Promise.resolve();
		}
		if (signal) {
			await new Promise((_resolve, reject) => {
				if (signal.aborted) return reject(new Error('aborted'));
				signal.addEventListener('abort', () => reject(new Error('aborted')));
			});
		}
	})();
}

describe('runCancellableStream', () => {
	it('runs to completion, decoding chunks and returning finalize()', async () => {
		const seen: number[] = [];

		const finalize = vi.fn(() => ({ markdown: 'done', rendered: '' }));
		const result = await runCancellableStream<number>({
			start: async () => of(1, 2, 3),
			onChunk: (c) => seen.push(c),
			finalize,
		}).complete;

		expect(seen).toEqual([1, 2, 3]);
		expect(finalize).toHaveBeenCalledTimes(1);
		expect(result.markdown).toBe('done');
	});

	it('cancel() before start resolves: finalize is the single exit, no chunk read', async () => {
		const start = vi.fn(async () => {
			// resolve a tick after cancel() fires
			await new Promise((r) => window.setTimeout(r, 0));
			return of(1, 2);
		});
		const onChunk = vi.fn();
		const finalize = vi.fn(() => ({ ...RESP, markdown: 'partial' }));

		const streaming = runCancellableStream<number>({ start, onChunk, finalize });
		streaming.cancel();
		const result = await streaming.complete;

		expect(onChunk).not.toHaveBeenCalled();
		expect(finalize).toHaveBeenCalledTimes(1);
		expect(result.markdown).toBe('partial');
	});

	it('aborting the signal unblocks a stalled read (the #1349 contract)', async () => {
		let captured: AbortSignal | undefined;
		const finalize = vi.fn(() => ({ ...RESP, markdown: 'partial' }));

		const streaming = runCancellableStream<unknown>({
			start: async (sig) => {
				captured = sig;
				return blockingStream(['a'], sig);
			},
			onChunk: () => {},
			finalize,
		});
		// first chunk consumed; the second read is blocked on the signal
		await new Promise((r) => window.setTimeout(r, 0));
		expect(captured?.aborted).toBe(false); // signal is live until cancel()
		streaming.cancel();
		const result = await streaming.complete;

		expect(captured?.aborted).toBe(true);
		expect(result.markdown).toBe('partial');
	});

	it('cancelled mid-iteration: loop breaks, finalize called once with accumulated state', async () => {
		const finalize = vi.fn(() => ({ ...RESP, markdown: 'acc' }));
		const onChunk = vi.fn((c: number) => {
			if (c === 2) {
				// cancel from inside onChunk, like the UI Stop path
				streaming.cancel();
			}
		});
		const streaming = runCancellableStream<number>({
			start: async () => of(1, 2, 3),
			onChunk,
			finalize,
		});
		const result = await streaming.complete;

		expect(onChunk).toHaveBeenCalledTimes(2); // chunk 3 never delivered
		expect(finalize).toHaveBeenCalledTimes(1);
		expect(result.markdown).toBe('acc');
	});

	it('cancelled-in-catch: returns finalize() instead of throwing', async () => {
		const finalize = vi.fn(() => ({ ...RESP, markdown: 'partial-on-error' }));
		const streaming = runCancellableStream<number>({
			start: async () => {
				const s = blockingStream([1]);
				const boom = (async function* () {
					yield 1;
					throw new Error('transport exploded');
				})();
				void s;
				return boom;
			},
			onChunk: () => streaming.cancel(),
			finalize,
		});
		const result = await streaming.complete;

		expect(result.markdown).toBe('partial-on-error');
		expect(finalize).toHaveBeenCalledTimes(1);
	});

	it('non-cancel error: calls onError and rethrows', async () => {
		const boom = new Error('boom');
		const onError = vi.fn();
		const finalize = vi.fn();
		const streaming = runCancellableStream<number>({
			start: async () => {
				throw boom;
			},
			onChunk: () => {},
			finalize,
			onError,
		});

		await expect(streaming.complete).rejects.toBe(boom);
		expect(onError).toHaveBeenCalledWith(boom);
		expect(finalize).not.toHaveBeenCalled();
	});

	it('calls onCancel after aborting the signal, and swallows its throw', async () => {
		const onCancel = vi.fn(() => {
			throw new Error('SDK abort blew up');
		});
		const finalize = vi.fn(() => ({ ...RESP, markdown: 'x' }));
		const streaming = runCancellableStream<unknown>({
			start: async () => blockingStream([1]),
			onChunk: () => {},
			finalize,
			onCancel,
		});
		await new Promise((r) => window.setTimeout(r, 0));
		expect(() => streaming.cancel()).not.toThrow();
		expect(onCancel).toHaveBeenCalledTimes(1);
		await streaming.complete;
		expect(finalize).toHaveBeenCalledTimes(1);
	});

	it('onChunk throwing without cancel is an error path (logged, rethrown)', async () => {
		const boom = new Error('decoder boom');
		const onError = vi.fn();
		const finalize = vi.fn();
		const streaming = runCancellableStream<number>({
			start: async () => of(1),
			onChunk: () => {
				throw boom;
			},
			finalize,
			onError,
		});

		await expect(streaming.complete).rejects.toBe(boom);
		expect(finalize).not.toHaveBeenCalled();
	});
});
