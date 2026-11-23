import { Ollama } from 'ollama/browser';

// Pins the ollama-js internal that OllamaClient's `releaseStream` relies on
// (#1788): a streamed request stays in `ongoingStreamedRequests` until the
// iterator's `doneCallback` runs, an abort alone doesn't run it, and running it
// removes the request. If an SDK upgrade changes any of this, this test fails
// and `releaseStream` in src/api/providers/ollama/client.ts needs another look.

interface StreamInternals {
	ongoingStreamedRequests: unknown[];
}

/** A fetch whose body sends one NDJSON chunk and then stays open until aborted. */
function openEndedFetch(): typeof fetch {
	return async (_url: RequestInfo | URL, init?: RequestInit) => {
		const encoder = new TextEncoder();
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(
					encoder.encode(
						JSON.stringify({ model: 'm', message: { role: 'assistant', content: 'a' }, done: false }) + '\n'
					)
				);
				init?.signal?.addEventListener('abort', () => {
					controller.error(new DOMException('Aborted', 'AbortError'));
				});
			},
		});
		return new Response(body, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
	};
}

describe('ollama-js stream bookkeeping (pinned for #1788)', () => {
	it('abort() alone leaves the request listed; doneCallback removes it', async () => {
		const client = new Ollama({ host: 'http://localhost:11434', fetch: openEndedFetch() });
		const internals = client as unknown as StreamInternals;

		const stream = await client.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }], stream: true });
		const iterator = stream[Symbol.asyncIterator]();
		await iterator.next();
		expect(internals.ongoingStreamedRequests).toHaveLength(1);

		stream.abort();
		await iterator.next().catch(() => undefined);
		expect(internals.ongoingStreamedRequests).toHaveLength(1);

		const done = (stream as unknown as { doneCallback?: unknown }).doneCallback;
		expect(typeof done).toBe('function');
		(done as () => void).call(stream);
		expect(internals.ongoingStreamedRequests).toHaveLength(0);

		// Idempotent: a second call is harmless.
		(done as () => void).call(stream);
		expect(internals.ongoingStreamedRequests).toHaveLength(0);
	});
});
