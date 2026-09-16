import { decodeThinkingBlocks, encodeThinkingBlocks } from '../../../../src/api/providers/anthropic/thinking-replay';

describe('thinking replay', () => {
	it('round-trips thinking and redacted_thinking blocks in order, dropping other blocks', () => {
		const encoded = encodeThinkingBlocks([
			{ type: 'thinking', thinking: 'first', signature: 's1' },
			{ type: 'text', text: 'ignored', citations: null },
			{ type: 'redacted_thinking', data: 'opaque' },
		] as any);

		expect(decodeThinkingBlocks(encoded)).toEqual([
			{ type: 'thinking', thinking: 'first', signature: 's1' },
			{ type: 'redacted_thinking', data: 'opaque' },
		]);
	});

	it('encodes nothing when the response had no thinking', () => {
		expect(encodeThinkingBlocks([{ type: 'text', text: 'hi', citations: null }] as any)).toBeUndefined();
	});

	it.each([
		['undefined', undefined],
		['a Gemini signature', 'CiQBVKhc7...'],
		['malformed JSON', 'anthropic-thinking:{nope'],
		['a non-array payload', 'anthropic-thinking:{"type":"thinking"}'],
	])('decodes %s to no blocks', (_label, value) => {
		expect(decodeThinkingBlocks(value)).toEqual([]);
	});

	it('filters out entries that are not well-formed thinking blocks', () => {
		const value =
			'anthropic-thinking:' +
			JSON.stringify([
				{ type: 'thinking', thinking: 'ok', signature: 's' },
				{ type: 'thinking', thinking: 'no signature' },
				{ type: 'tool_use', id: 'x' },
				null,
			]);
		expect(decodeThinkingBlocks(value)).toEqual([{ type: 'thinking', thinking: 'ok', signature: 's' }]);
	});
});
