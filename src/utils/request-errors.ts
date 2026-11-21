/**
 * Errors a model client raises before any request goes over the network.
 *
 * A pre-flight check (no model selected, an attachment type the provider
 * cannot accept) fails the same way on every attempt, so retrying it only
 * delays the error the user is going to see anyway (#1738). The retry policy
 * in `retry.ts` returns `false` for this type before its "unknown errors are
 * retryable" default. Leaf module so clients and the retry utility can both
 * import it without a cycle.
 */
export class NonRetryableRequestError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'NonRetryableRequestError';
	}
}
