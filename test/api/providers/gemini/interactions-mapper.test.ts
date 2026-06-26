import { describe, test, expect } from 'vitest';
import { InteractionStreamAccumulator } from '../../../../src/api/providers/gemini/interactions-mapper';

/** Feed a list of events through the accumulator, collecting emitted chunks. */
function run(events: Array<Record<string, unknown>>) {
	const acc = new InteractionStreamAccumulator();
	const chunks: Array<{ text: string; thought?: string }> = [];
	for (const event of events) {
		const chunk = acc.handleEvent(event);
		if (chunk) chunks.push(chunk);
	}
	return { response: acc.finalize(), chunks };
}

describe('InteractionStreamAccumulator', () => {
	test('accumulates streamed text into markdown and emits text chunks', () => {
		const { response, chunks } = run([
			{ event_type: 'interaction.created', interaction: { id: 'int_1' } },
			{ event_type: 'step.start', index: 0, step: { type: 'model_output' } },
			{ event_type: 'step.delta', index: 0, delta: { type: 'text', text: 'Hello' } },
			{ event_type: 'step.delta', index: 0, delta: { type: 'text', text: ', world' } },
			{ event_type: 'step.stop', index: 0 },
			{
				event_type: 'interaction.completed',
				interaction: { usage: { total_input_tokens: 4, total_output_tokens: 2, total_tokens: 6 } },
			},
		]);

		expect(chunks).toEqual([{ text: 'Hello' }, { text: ', world' }]);
		expect(response.markdown).toBe('Hello, world');
		expect(response.usageMetadata).toEqual({
			promptTokenCount: 4,
			candidatesTokenCount: 2,
			totalTokenCount: 6,
			cachedContentTokenCount: undefined,
		});
		expect(response.toolCalls).toBeUndefined();
	});

	test('surfaces thought_summary deltas as thought chunks and accumulates thoughts', () => {
		const { response, chunks } = run([
			{ event_type: 'step.start', index: 0, step: { type: 'thought' } },
			{
				event_type: 'step.delta',
				index: 0,
				delta: { type: 'thought_summary', content: { type: 'text', text: 'Hmm ' } },
			},
			{
				event_type: 'step.delta',
				index: 0,
				delta: { type: 'thought_summary', content: { type: 'text', text: 'let me think' } },
			},
			{ event_type: 'step.stop', index: 0 },
		]);

		expect(chunks).toEqual([
			{ text: '', thought: 'Hmm ' },
			{ text: '', thought: 'let me think' },
		]);
		expect(response.thoughts).toBe('Hmm let me think');
	});

	test('assembles a tool call from step.start + multi-fragment arguments_delta', () => {
		const { response, chunks } = run([
			{
				event_type: 'step.start',
				index: 0,
				step: { type: 'function_call', id: 'c1', name: 'read_file', signature: 'sig1' },
			},
			{ event_type: 'step.delta', index: 0, delta: { type: 'arguments_delta', arguments: '{"path":' } },
			{ event_type: 'step.delta', index: 0, delta: { type: 'arguments_delta', arguments: '"foo.md"}' } },
			{ event_type: 'step.stop', index: 0 },
		]);

		expect(chunks).toEqual([]); // tool-call assembly emits nothing to the UI text stream
		expect(response.toolCalls).toEqual([
			{ name: 'read_file', arguments: { path: 'foo.md' }, id: 'c1', thoughtSignature: 'sig1' },
		]);
	});

	test('falls back to seed arguments when no arguments_delta arrives', () => {
		const { response } = run([
			{
				event_type: 'step.start',
				index: 0,
				step: { type: 'function_call', id: 'c2', name: 'list_files', arguments: { dir: '.' } },
			},
			{ event_type: 'step.stop', index: 0 },
		]);

		expect(response.toolCalls).toEqual([
			{ name: 'list_files', arguments: { dir: '.' }, id: 'c2', thoughtSignature: undefined },
		]);
	});

	test('keeps seed/empty args when streamed fragments are not valid JSON', () => {
		const { response } = run([
			{ event_type: 'step.start', index: 0, step: { type: 'function_call', id: 'c3', name: 'x' } },
			{ event_type: 'step.delta', index: 0, delta: { type: 'arguments_delta', arguments: '{bad json' } },
			{ event_type: 'step.stop', index: 0 },
		]);
		expect(response.toolCalls).toEqual([{ name: 'x', arguments: {}, id: 'c3', thoughtSignature: undefined }]);
	});

	test('interleaves text and a tool call, and flushes an unstopped step on finalize', () => {
		const { response } = run([
			{ event_type: 'step.start', index: 0, step: { type: 'model_output' } },
			{ event_type: 'step.delta', index: 0, delta: { type: 'text', text: 'Let me look' } },
			{ event_type: 'step.stop', index: 0 },
			{
				event_type: 'step.start',
				index: 1,
				step: { type: 'function_call', id: 'c9', name: 'search', arguments: { q: 'x' } },
			},
			// no step.stop for index 1 — finalize() must still flush it
		]);

		expect(response.markdown).toBe('Let me look');
		expect(response.toolCalls).toEqual([
			{ name: 'search', arguments: { q: 'x' }, id: 'c9', thoughtSignature: undefined },
		]);
	});

	test('parallel tool calls keyed by distinct step indexes do not cross-contaminate args', () => {
		const { response } = run([
			{ event_type: 'step.start', index: 0, step: { type: 'function_call', id: 'a', name: 'read_file' } },
			{ event_type: 'step.start', index: 1, step: { type: 'function_call', id: 'b', name: 'list_files' } },
			{ event_type: 'step.delta', index: 1, delta: { type: 'arguments_delta', arguments: '{"dir":"."}' } },
			{ event_type: 'step.delta', index: 0, delta: { type: 'arguments_delta', arguments: '{"path":"x"}' } },
			{ event_type: 'step.stop', index: 0 },
			{ event_type: 'step.stop', index: 1 },
		]);

		expect(response.toolCalls).toEqual([
			{ name: 'read_file', arguments: { path: 'x' }, id: 'a', thoughtSignature: undefined },
			{ name: 'list_files', arguments: { dir: '.' }, id: 'b', thoughtSignature: undefined },
		]);
	});
});
