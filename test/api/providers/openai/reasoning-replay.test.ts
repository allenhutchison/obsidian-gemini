import {
	decodeReasoningDetails,
	encodeReasoningDetails,
	mergeReasoningDetails,
	readReasoningDetails,
	type ReasoningDetail,
} from '../../../../src/api/providers/openai/reasoning-replay';

describe('reasoning-replay', () => {
	it('round-trips reasoning details through a thoughtSignature', () => {
		const details: ReasoningDetail[] = [
			{ type: 'reasoning.text', index: 0, text: 'thinking', signature: 'sig', format: 'anthropic-claude-v1' },
			{ type: 'reasoning.encrypted', index: 1, data: 'opaque' },
		];
		const encoded = encodeReasoningDetails(details);
		expect(encoded).toBeDefined();
		expect(decodeReasoningDetails(encoded)).toEqual(details);
	});

	it('encodes nothing for a turn without reasoning', () => {
		expect(encodeReasoningDetails([])).toBeUndefined();
	});

	it('never decodes a foreign or malformed signature', () => {
		expect(decodeReasoningDetails(undefined)).toEqual([]);
		expect(decodeReasoningDetails('gemini-signature-bytes')).toEqual([]);
		expect(decodeReasoningDetails('anthropic-thinking:[{"type":"thinking"}]')).toEqual([]);
		expect(decodeReasoningDetails('oai-reasoning-details:{not json')).toEqual([]);
		expect(decodeReasoningDetails('oai-reasoning-details:{"type":"x"}')).toEqual([]);
	});

	it('drops entries that are not reasoning blocks', () => {
		expect(readReasoningDetails([{ type: 'reasoning.text' }, null, 'x', { text: 'no type' }])).toEqual([
			{ type: 'reasoning.text' },
		]);
		expect(readReasoningDetails(undefined)).toEqual([]);
	});

	it('merges streamed fragments sharing an index and keeps later whole fields', () => {
		const acc: ReasoningDetail[] = [];
		mergeReasoningDetails(acc, [{ type: 'reasoning.text', index: 0, text: 'Let me ', format: 'anthropic-claude-v1' }]);
		mergeReasoningDetails(acc, [{ type: 'reasoning.text', index: 0, text: 'think.' }]);
		mergeReasoningDetails(acc, [{ type: 'reasoning.text', index: 0, signature: 'sig-1' }]);
		mergeReasoningDetails(acc, [{ type: 'reasoning.encrypted', index: 1, data: 'blob' }]);

		expect(acc).toEqual([
			{ type: 'reasoning.text', index: 0, text: 'Let me think.', format: 'anthropic-claude-v1', signature: 'sig-1' },
			{ type: 'reasoning.encrypted', index: 1, data: 'blob' },
		]);
	});

	it('appends blocks that carry no index', () => {
		const acc: ReasoningDetail[] = [];
		mergeReasoningDetails(acc, [{ type: 'reasoning.summary', summary: 'a' }]);
		mergeReasoningDetails(acc, [{ type: 'reasoning.summary', summary: 'b' }]);
		expect(acc).toHaveLength(2);
	});
});
