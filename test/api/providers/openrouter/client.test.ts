import type { Mock } from 'vitest';
import { OpenRouterClient } from '../../../../src/api/providers/openrouter/client';
import { OPENROUTER_BASE_URL } from '../../../../src/api/providers/openrouter/config';

const { calls } = vi.hoisted(() => {
	const calls: { create: Mock; post: Mock; ctorOpts: any[] } = { create: vi.fn(), post: vi.fn(), ctorOpts: [] };
	return { calls };
});

vi.mock('openai', () => ({
	default: vi.fn().mockImplementation(function (this: any, opts: any) {
		calls.ctorOpts.push(opts);
		this.chat = { completions: { create: (...args: any[]) => calls.create(...args) } };
		this.images = { generate: vi.fn() };
		this.post = (...args: any[]) => calls.post(...args);
	}),
}));

const mockLogger = { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

const buildPlugin = () =>
	({
		logger: mockLogger,
		settings: { userName: 'Tester', ragIndexing: { enabled: false } },
		agentsMemory: { read: vi.fn().mockResolvedValue('') },
		skillManager: { getSkillSummaries: vi.fn().mockResolvedValue([]) },
		ragIndexing: null,
	}) as any;

async function* stream(chunks: any[]) {
	for (const c of chunks) yield { id: 'c', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [c] };
}

describe('OpenRouterClient', () => {
	let client: OpenRouterClient;

	beforeEach(() => {
		calls.create.mockReset();
		calls.post.mockReset();
		calls.ctorOpts.length = 0;
		mockLogger.error.mockReset();
		client = new OpenRouterClient({ apiKey: 'sk-or-test', model: 'google/gemini-3.5-flash' }, undefined, buildPlugin());
	});

	it('targets the OpenRouter API with its attribution headers', () => {
		expect(calls.ctorOpts[0]).toMatchObject({
			apiKey: 'sk-or-test',
			baseURL: OPENROUTER_BASE_URL,
			maxRetries: 0,
			defaultHeaders: {
				'HTTP-Referer': expect.any(String),
				'X-OpenRouter-Title': 'Gemini Scribe',
				'X-Title': 'Gemini Scribe',
			},
		});
	});

	describe('generateImage', () => {
		it('posts to /images and returns the base64 bytes', async () => {
			calls.post.mockResolvedValue({ data: [{ b64_json: 'jpeg-bytes', media_type: 'image/jpeg' }] });

			await expect(client.generateImage('a lighthouse', 'openai/gpt-image-2.6-flare')).resolves.toBe('jpeg-bytes');
			expect(calls.post).toHaveBeenCalledWith('/images', {
				body: { model: 'openai/gpt-image-2.6-flare', prompt: 'a lighthouse' },
			});
		});

		it('rejects a response without image data', async () => {
			calls.post.mockResolvedValue({ data: [] });
			await expect(client.generateImage('x', 'openai/gpt-image-2.6-flare')).rejects.toThrow(
				'OpenRouter returned no image data.'
			);
			expect(mockLogger.error).toHaveBeenCalled();
		});

		it('rejects when no model is selected', async () => {
			await expect(client.generateImage('x', '')).rejects.toThrow('No OpenRouter model selected');
			expect(calls.post).not.toHaveBeenCalled();
		});
	});

	it('reads OpenRouter `reasoning` text as thoughts', async () => {
		calls.create.mockResolvedValue({
			choices: [{ message: { role: 'assistant', content: 'answer', reasoning: 'chain of thought' } }],
		});
		const response = await client.generateModelResponse({
			prompt: '',
			userMessage: 'think',
			kind: 'extended',
			conversationHistory: [],
		});
		expect(response.thoughts).toBe('chain of thought');
	});

	it('names OpenRouter in the unsupported-attachment error', async () => {
		await expect(
			client.generateModelResponse({
				prompt: '',
				userMessage: 'listen',
				kind: 'extended',
				conversationHistory: [],
				inlineAttachments: [{ mimeType: 'audio/mpeg', base64: 'AAAA' }],
			})
		).rejects.toThrow(/OpenRouter/);
	});

	describe('reasoning_details replay across a tool round', () => {
		const details = [
			{ type: 'reasoning.text', index: 0, text: 'I should read it.', signature: 'sig', format: 'anthropic-claude-v1' },
		];

		it('stashes non-streaming reasoning_details on the first tool call and replays them', async () => {
			calls.create.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: 'assistant',
							content: null,
							reasoning_details: details,
							tool_calls: [
								{ id: 'call_a', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.md"}' } },
								{ id: 'call_b', type: 'function', function: { name: 'read_file', arguments: '{"path":"b.md"}' } },
							],
						},
					},
				],
			});

			const first = await client.generateModelResponse({
				prompt: '',
				userMessage: 'read a and b',
				kind: 'extended',
				conversationHistory: [],
			});
			expect(first.toolCalls).toHaveLength(2);
			expect(first.toolCalls?.[0].thoughtSignature).toBeDefined();
			expect(first.toolCalls?.[1].thoughtSignature).toBeUndefined();

			// The agent loop replays the turn as Gemini Content parts.
			calls.create.mockResolvedValueOnce({ choices: [{ message: { role: 'assistant', content: 'done' } }] });
			await client.generateModelResponse({
				prompt: '',
				userMessage: '',
				kind: 'extended',
				conversationHistory: [
					{ role: 'user', parts: [{ text: 'read a and b' }] },
					{
						role: 'model',
						parts: first.toolCalls!.map((tc) => ({
							functionCall: { name: tc.name, args: tc.arguments, id: tc.id },
							...(tc.thoughtSignature && { thoughtSignature: tc.thoughtSignature }),
						})),
					},
					{
						role: 'user',
						parts: [
							{ functionResponse: { name: 'read_file', response: { content: 'A' }, id: 'call_a' } },
							{ functionResponse: { name: 'read_file', response: { content: 'B' }, id: 'call_b' } },
						],
					},
				],
			});

			const messages = calls.create.mock.calls[1][0].messages;
			const assistant = messages.find((m: any) => m.role === 'assistant');
			expect(assistant.reasoning_details).toEqual(details);
			expect(assistant.tool_calls).toHaveLength(2);
		});

		it('accumulates streamed reasoning_details fragments onto the tool call', async () => {
			calls.create.mockResolvedValue(
				stream([
					{
						index: 0,
						delta: {
							reasoning: 'I should ',
							reasoning_details: [{ type: 'reasoning.text', index: 0, text: 'I should ' }],
						},
					},
					{
						index: 0,
						delta: {
							reasoning: 'read it.',
							reasoning_details: [{ type: 'reasoning.text', index: 0, text: 'read it.' }],
						},
					},
					{ index: 0, delta: { reasoning_details: [{ type: 'reasoning.text', index: 0, signature: 'sig' }] } },
					{
						index: 0,
						delta: {
							tool_calls: [
								{ index: 0, id: 'call_a', type: 'function', function: { name: 'read_file', arguments: '{}' } },
							],
						},
						finish_reason: 'tool_calls',
					},
				])
			);

			const streaming = client.generateStreamingResponse(
				{ prompt: '', userMessage: 'read', kind: 'extended', conversationHistory: [] },
				() => {}
			);
			const result = await streaming.complete;

			expect(result.thoughts).toBe('I should read it.');
			const signature = result.toolCalls?.[0].thoughtSignature;
			expect(signature).toBeDefined();
			const { decodeReasoningDetails } = await import('../../../../src/api/providers/openai/reasoning-replay');
			expect(decodeReasoningDetails(signature)).toEqual([
				{ type: 'reasoning.text', index: 0, text: 'I should read it.', signature: 'sig' },
			]);
		});

		it('does not forward a Gemini thoughtSignature as reasoning_details', async () => {
			calls.create.mockResolvedValue({ choices: [{ message: { role: 'assistant', content: 'ok' } }] });
			await client.generateModelResponse({
				prompt: '',
				userMessage: '',
				kind: 'extended',
				conversationHistory: [
					{
						role: 'model',
						parts: [{ functionCall: { name: 'read_file', args: {}, id: 'call_a' }, thoughtSignature: 'gemini-sig' }],
					},
					{ role: 'user', parts: [{ functionResponse: { name: 'read_file', response: {}, id: 'call_a' } }] },
				],
			});
			const assistant = calls.create.mock.calls[0][0].messages.find((m: any) => m.role === 'assistant');
			expect(assistant.reasoning_details).toBeUndefined();
		});
	});
});
