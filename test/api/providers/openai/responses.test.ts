import {
	buildResponsesBody,
	decodeResponsesReasoning,
	encodeResponsesReasoning,
	responseToModelResponse,
	applyResponsesStreamEvent,
} from '../../../../src/api/providers/openai/responses';
import { NonRetryableRequestError } from '../../../../src/utils/request-errors';
import type { ExtendedModelRequest } from '../../../../src/api/interfaces/model-api';

const reasoningItem = { type: 'reasoning' as const, id: 'rs_1', summary: [], encrypted_content: 'enc-1' };

function request(overrides: Partial<ExtendedModelRequest> = {}): ExtendedModelRequest {
	return { kind: 'extended', prompt: '', userMessage: 'hi', conversationHistory: [], ...overrides };
}

describe('Responses reasoning replay', () => {
	it('round-trips reasoning items through a thoughtSignature', () => {
		const signature = encodeResponsesReasoning([reasoningItem]);
		expect(decodeResponsesReasoning(signature)).toEqual([reasoningItem]);
	});

	it('ignores foreign or malformed signatures', () => {
		expect(encodeResponsesReasoning([])).toBeUndefined();
		expect(decodeResponsesReasoning('gemini-signature')).toEqual([]);
		expect(decodeResponsesReasoning('oai-reasoning-details:[{"type":"reasoning.text"}]')).toEqual([]);
		expect(decodeResponsesReasoning('oai-responses-reasoning:{not json')).toEqual([]);
	});
});

describe('buildResponsesBody', () => {
	it('puts the system instruction in instructions and the new turn last', () => {
		const body = buildResponsesBody('gpt-6.1-sol', request({ perTurnContext: 'ctx' }), 'be helpful', 'OpenAI');
		expect(body).toMatchObject({ model: 'gpt-6.1-sol', instructions: 'be helpful', store: false, stream: false });
		expect(body.input).toEqual([{ role: 'user', content: 'hi\n\nctx' }]);
		expect(body).not.toHaveProperty('tools');
	});

	it('replays a tool round in order: reasoning, text, call, then output', () => {
		const signature = encodeResponsesReasoning([reasoningItem]);
		const body = buildResponsesBody(
			'gpt-6.1-sol',
			request({
				userMessage: '',
				conversationHistory: [
					{ role: 'user', parts: [{ text: 'read a.md' }] },
					{
						role: 'model',
						parts: [
							{ text: 'Reading it.' },
							{
								functionCall: { name: 'read_file', args: { path: 'a.md' }, id: 'call_1' },
								thoughtSignature: signature,
							},
						],
					},
					{ role: 'user', parts: [{ functionResponse: { name: 'read_file', response: { ok: true }, id: 'call_1' } }] },
				],
			}),
			undefined,
			'OpenAI'
		);
		expect(body.input).toEqual([
			{ role: 'user', content: 'read a.md' },
			reasoningItem,
			{ role: 'assistant', content: 'Reading it.' },
			{ type: 'function_call', call_id: 'call_1', name: 'read_file', arguments: '{"path":"a.md"}' },
			{ type: 'function_call_output', call_id: 'call_1', output: '{"ok":true}' },
		]);
		expect(body).not.toHaveProperty('instructions');
	});

	it('sends images as input_image parts and rejects other attachments', () => {
		const body = buildResponsesBody(
			'gpt-6.1-sol',
			request({ inlineAttachments: [{ mimeType: 'image/png', base64: 'AAA' }] }),
			undefined,
			'OpenAI'
		);
		expect(body.input).toEqual([
			{
				role: 'user',
				content: [
					{ type: 'input_text', text: 'hi' },
					{ type: 'input_image', image_url: 'data:image/png;base64,AAA', detail: 'auto' },
				],
			},
		]);
		expect(() =>
			buildResponsesBody(
				'gpt-6.1-sol',
				request({ inlineAttachments: [{ mimeType: 'application/pdf', base64: 'AAA' }] }),
				undefined,
				'OpenAI'
			)
		).toThrow(NonRetryableRequestError);
	});

	it('maps tools to non-strict function tools', () => {
		const body = buildResponsesBody(
			'gpt-6.1-sol',
			request({
				availableTools: [{ name: 'read_file', description: 'reads', parameters: { type: 'object', properties: {} } }],
			}),
			undefined,
			'OpenAI'
		);
		expect(body.tools).toEqual([
			{
				type: 'function',
				name: 'read_file',
				description: 'reads',
				parameters: { type: 'object', properties: {}, required: [] },
				strict: false,
			},
		]);
	});
});

describe('responseToModelResponse', () => {
	it('collects text, tool calls with reasoning on the first, summaries and usage', () => {
		const result = responseToModelResponse({
			output: [
				{ ...reasoningItem, summary: [{ type: 'summary_text', text: 'thinking' }] },
				{ type: 'message', content: [{ type: 'output_text', text: 'Hi' }] },
				{ type: 'function_call', call_id: 'c1', name: 'a', arguments: '{"x":1}' },
				{ type: 'function_call', call_id: 'c2', name: 'b', arguments: 'not json' },
			],
			usage: { input_tokens: 7, output_tokens: 3, total_tokens: 10, input_tokens_details: { cached_tokens: 4 } },
		} as never);

		expect(result.markdown).toBe('Hi');
		expect(result.thoughts).toBe('thinking');
		expect(result.toolCalls).toHaveLength(2);
		expect(decodeResponsesReasoning(result.toolCalls?.[0].thoughtSignature)).toHaveLength(1);
		expect(result.toolCalls?.[1]).toEqual({ id: 'c2', name: 'b', arguments: {} });
		expect(result.usageMetadata).toEqual({
			promptTokenCount: 7,
			candidatesTokenCount: 3,
			totalTokenCount: 10,
			cachedContentTokenCount: 4,
		});
	});

	it('attaches no signature when the turn has no tool calls', () => {
		const result = responseToModelResponse({ output: [reasoningItem] } as never);
		expect(result.toolCalls).toBeUndefined();
		expect(result.markdown).toBe('');
	});
});

describe('applyResponsesStreamEvent', () => {
	it('forwards text deltas and keeps the final response', () => {
		const state: { final?: unknown } = {};
		const texts: string[] = [];
		applyResponsesStreamEvent({ type: 'response.output_text.delta', delta: 'a' } as never, state as never, (t) =>
			texts.push(t)
		);
		applyResponsesStreamEvent(
			{ type: 'response.incomplete', response: { output: [] } } as never,
			state as never,
			() => {}
		);
		expect(texts).toEqual(['a']);
		expect(state.final).toEqual({ output: [] });
	});

	it('throws on error events', () => {
		expect(() => applyResponsesStreamEvent({ type: 'error', message: 'bad key' } as never, {}, () => {})).toThrow(
			'bad key'
		);
	});
});
