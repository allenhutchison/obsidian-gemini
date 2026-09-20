import type { ModelResponse, StreamingModelResponse } from '../interfaces/model-api';

/**
 * The shared cancellable-stream lifecycle behind every provider's
 * `generateStreamingResponse` (#1350, #1576).
 *
 * Every `ModelApi` implementation has to turn a provider SDK's async iterable
 * into the plugin's `{ complete, cancel }` pair, and every one used to
 * hand-roll the same scaffold: a `cancelled` flag, local accumulators, a
 * `for await (…) { if (cancelled) break; }`, a catch arm returning the partial
 * response on cancel, and the `{ complete, cancel }` return. Copies drifted —
 * one client duplicated its response literal across the success and cancelled
 * arms (#1208), another set the flag without reaching the transport so Stop
 * waited on the next frame (#1349). This helper owns the scaffold once, so a
 * copy cannot have those bugs.
 *
 * Signal-first cancellation: the controller exists *before* `start` is called,
 * so `cancel()` is safe at any point — before, during, or after the awaits.
 * Transports that cannot take a signal (the SDK hands back its own controller,
 * or offers only a stream `abort()`) supply `onCancel`, which fires after the
 * signal is aborted. Such transports still see `signal.aborted` when their
 * `start` resolves, so they can abort their just-obtained stream reference to
 * close the cancel-before-reference race.
 *
 * `finalize` is the **single exit for both arms** — success, cancelled
 * mid-iteration, and cancelled-in-catch all return `finalize()` — which is what
 * makes the #1208 class of bug (two response literals drifting apart)
 * unrepresentable rather than merely fixed. It may be async (`Promise`
 * return): some transports (Anthropic) aggregate the authoritative response
 * server-side and only expose it after the iterable ends, so the success arm
 * awaits the SDK's aggregate while the cancelled arm returns the local
 * partial. The branch lives *inside* `finalize`, keyed on the signal the
 * client already holds — there is still exactly one `finalize` call per exit
 * path, so the single-exit guarantee is unchanged.
 *
 * Kept a leaf module: provider clients import it; nothing may import the
 * clients back through it (the #1155 acyclic-graph rule).
 *
 * @param options.start - Opens the SDK stream. Called once with the helper's
 *   signal; pass it to the SDK request where the transport accepts one.
 * @param options.onChunk - Receives each decoded chunk. Errors it throws are
 *   treated like any stream error (caught; rethrown unless cancelled).
 * @param options.finalize - Builds the final `ModelResponse` from whatever the
 *   callbacks accumulated. Called exactly once, on every exit path; may return
 *   a promise (the completion awaits it). The success/cancelled branch, when
 *   one is needed, lives inside it — see the doc above.
 * @param options.onCancel - Optional extra transport stop for SDKs that don't
 *   take a signal. Fired synchronously inside `cancel()`, after the signal is
 *   aborted. Best-effort: a throw here is swallowed like the SDK aborts it
 *   wraps.
 * @param options.onError - Optional error logger; the helper rethrows
 *   non-cancel errors after calling it. Defaults to a no-op so the helper
 *   stays dependency-free.
 * @returns The same `StreamingModelResponse` the providers returned by hand.
 */
export function runCancellableStream<TChunk>(options: {
	start: (signal: AbortSignal) => Promise<AsyncIterable<TChunk>>;
	onChunk: (chunk: TChunk) => void;
	finalize: () => ModelResponse | Promise<ModelResponse>;
	onCancel?: () => void;
	onError?: (error: unknown) => void;
}): StreamingModelResponse {
	const controller = new AbortController();
	const { signal } = controller;
	let cancelled = false;

	const complete = (async (): Promise<ModelResponse> => {
		try {
			const stream = await options.start(signal);
			// cancel() may have fired while `start` was outstanding. The signal
			// is already aborted — break before the first read.
			if (cancelled) {
				return options.finalize();
			}
			for await (const chunk of stream) {
				if (cancelled) break;
				options.onChunk(chunk);
			}
			return options.finalize();
		} catch (error) {
			if (cancelled) {
				return options.finalize();
			}
			options.onError?.(error);
			throw error;
		}
	})();

	return {
		complete,
		cancel: () => {
			cancelled = true;
			try {
				controller.abort();
			} catch {
				// Best-effort: abort must never prevent the flag from being set.
			}
			try {
				options.onCancel?.();
			} catch {
				// Best-effort: a transport without signal support still stops via
				// the flag.
			}
		},
	};
}
