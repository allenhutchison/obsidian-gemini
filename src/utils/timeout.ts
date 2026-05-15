/**
 * Bound the wait on a Promise.
 *
 * `withTimeout` does not cancel the underlying operation — the caller's promise
 * may still settle in the background. Use AbortController if cancellation at
 * the source is needed. This is sufficient for MCP guards because Obsidian's
 * `requestUrl` does not accept a signal, so the best we can do is stop waiting.
 */

export class TimeoutError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'TimeoutError';
	}
}

/**
 * Race a promise against a timer. Resolves with the promise's value if it
 * settles within `ms`, otherwise rejects with a TimeoutError whose message
 * is `${label} timed out after ${ms}ms`.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	let timer: number | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = window.setTimeout(() => {
			reject(new TimeoutError(`${label} timed out after ${ms}ms`));
		}, ms);
	});
	return Promise.race([promise, timeout]).finally(() => {
		if (timer !== undefined) {
			window.clearTimeout(timer);
		}
	});
}
