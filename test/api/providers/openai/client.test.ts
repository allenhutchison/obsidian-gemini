import type { Mock } from 'vitest';
import { OpenAIClient } from '../../../../src/api/providers/openai/client';
import type { OpenAIClientConfig } from '../../../../src/api/providers/openai/config';
import { ExtendedModelRequest, ToolDefinition } from '../../../../src/api/interfaces/model-api';

// vitest hoists vi.mock to the top of the file; vi.hoisted() lets us share
// fixtures with the factory while keeping initialization order safe.
const { openaiCalls } = vi.hoisted(() => {
	const openaiCalls: { create: Mock } = {
		create: vi.fn(),
	};
	return { openaiCalls };
});

vi.mock('openai', () => ({
	// Use function syntax so `new OpenAI()` works under vitest 4 (arrow impls
	// aren't constructable).
	default: vi.fn().mockImplementation(function (this: any, opts: any) {
		this.constructorOpts = opts;
		this.chat = {
			completions: {
				create: (...args: any[]) => openaiCalls.create(...args),
			},
		};
	}),
}));

const mockLogger = {
	log: vi.fn(),
	debug: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
};

const buildPlugin = () =>
	({
		logger: mockLogger,
		settings: {
			provider: 'openai',
			userName: 'Tester',
			ragIndexing: { enabled: false },
		},
		agentsMemory: { read: vi.fn().mockResolvedValue('') },
		skillManager: { getSkillSummaries: vi.fn().mockResolvedValue([]) },
		ragIndexing: null,
	}) as any;

const baseConfig: OpenAIClientConfig = {
	apiKey: 'sk-test',
	baseUrl: 'https://api.openai.com/v1',
	model: 'gpt-4o-mini',
	temperature: 0.4,
	topP: 0.9,
};

describe('OpenAIClient', () => {
	let client: OpenAIClient;

	beforeEach(() => {
		openaiCalls.create.mockReset();
		mockLogger.error.mockReset();
		mockLogger.warn.mockReset();
		client = new OpenAIClient(baseConfig, undefined, buildPlugin());
	});

	describe('generateModelResponse (BaseModelRequest)', () => {
		it('routes simple prompts through chat.completions.create and forwards options', async () => {
			openaiCalls.create.mockResolvedValue({
				choices: [{ message: { role: 'assistant', content: 'hello world' } }],
				usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
			});

			const response = await client.generateModelResponse({
				kind: 'base',
				prompt: 'say hi',
				temperature: 0.2,
			});

			expect(openaiCalls.create).toHaveBeenCalledTimes(1);
			const args = openaiCalls.create.mock.calls[0][0];
			expect(args.model).toBe('gpt-4o-mini');
			expect(args.messages).toEqual([{ role: 'user', content: 'say hi' }]);
			expect(args.stream).toBe(false);
			expect(args.temperature).toBe(0.2);
			expect(args.top_p).toBe(0.9);

			expect(response.markdown).toBe('hello world');
			expect(response.usageMetadata).toEqual({
				promptTokenCount: 10,
				candidatesTokenCount: 4,
				totalTokenCount: 14,
			});
		});
	});

	describe('generateModelResponse (ExtendedModelRequest)', () => {
		it('routes chat through chat.completions.create with system + history + user message', async () => {
			openaiCalls.create.mockResolvedValue({
				choices: [{ message: { role: 'assistant', content: 'reply' } }],
				usage: { prompt_tokens: 50, completion_tokens: 2, total_tokens: 52 },
			});

			const request: ExtendedModelRequest = {
				prompt: '',
				userMessage: 'what is up',
				kind: 'extended',
				conversationHistory: [
					{ role: 'user', parts: [{ text: 'previous user turn' }] },
					{ role: 'model', parts: [{ text: 'previous assistant turn' }] },
				],
			};

			const response = await client.generateModelResponse(request);

			expect(openaiCalls.create).toHaveBeenCalledTimes(1);
			const args = openaiCalls.create.mock.calls[0][0];
			expect(args.stream).toBe(false);
			// system instruction always present (built from prompts module)
			expect(args.messages[0].role).toBe('system');
			expect(args.messages.some((m: any) => m.role === 'user' && m.content === 'previous user turn')).toBe(true);
			expect(args.messages.some((m: any) => m.role === 'assistant' && m.content === 'previous assistant turn')).toBe(
				true
			);
			expect(args.messages[args.messages.length - 1]).toEqual({ role: 'user', content: 'what is up' });
			expect(response.markdown).toBe('reply');
		});

		it('maps tool calls in the assistant response', async () => {
			openaiCalls.create.mockResolvedValue({
				choices: [
					{
						message: {
							role: 'assistant',
							content: '',
							tool_calls: [
								{
									id: 'call_read_file_0',
									type: 'function',
									function: { name: 'read_file', arguments: '{"path":"foo.md"}' },
								},
							],
						},
					},
				],
				usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
			});

			const response = await client.generateModelResponse({
				prompt: '',
				userMessage: 'read foo',
				kind: 'extended',
				conversationHistory: [],
				availableTools: [
					{
						name: 'read_file',
						description: 'reads a file',
						parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
					},
				],
			});

			expect(response.toolCalls).toEqual([
				{ id: 'call_read_file_0', name: 'read_file', arguments: { path: 'foo.md' } },
			]);
			expect(openaiCalls.create.mock.calls[0][0].tools).toEqual([
				{
					type: 'function',
					function: {
						name: 'read_file',
						description: 'reads a file',
						parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
					},
				},
			]);
		});

		it('falls back to an empty object and logs a warning for malformed tool call arguments', async () => {
			openaiCalls.create.mockResolvedValue({
				choices: [
					{
						message: {
							role: 'assistant',
							content: '',
							tool_calls: [
								{
									id: 'call_1',
									type: 'function',
									function: { name: 'read_file', arguments: '{not valid json' },
								},
							],
						},
					},
				],
			});

			const response = await client.generateModelResponse({
				prompt: '',
				userMessage: 'read foo',
				kind: 'extended',
				conversationHistory: [],
			});

			expect(response.toolCalls).toEqual([{ id: 'call_1', name: 'read_file', arguments: {} }]);
			expect(mockLogger.warn).toHaveBeenCalled();
		});

		it('maps reasoning_content to thoughts', async () => {
			openaiCalls.create.mockResolvedValue({
				choices: [
					{
						message: { role: 'assistant', content: 'answer', reasoning_content: 'chain of thought' },
					},
				],
			});

			const response = await client.generateModelResponse({
				prompt: '',
				userMessage: 'think',
				kind: 'extended',
				conversationHistory: [],
			});

			expect(response.thoughts).toBe('chain of thought');
			expect(response.markdown).toBe('answer');
		});

		it('attaches image inline data as an image_url content part on the user message', async () => {
			openaiCalls.create.mockResolvedValue({
				choices: [{ message: { role: 'assistant', content: 'ok' } }],
			});

			await client.generateModelResponse({
				prompt: '',
				userMessage: 'what is in this picture',
				kind: 'extended',
				conversationHistory: [],
				inlineAttachments: [{ mimeType: 'image/png', base64: 'b64data' }],
			});

			const args = openaiCalls.create.mock.calls[0][0];
			const userTurn = args.messages[args.messages.length - 1];
			expect(userTurn.role).toBe('user');
			expect(userTurn.content).toEqual([
				{ type: 'text', text: 'what is in this picture' },
				{ type: 'image_url', image_url: { url: 'data:image/png;base64,b64data' } },
			]);
		});

		it('rejects non-image attachments with a clear error', async () => {
			await expect(
				client.generateModelResponse({
					prompt: '',
					userMessage: 'read this',
					kind: 'extended',
					conversationHistory: [],
					inlineAttachments: [{ mimeType: 'application/pdf', base64: 'b64data' }],
				})
			).rejects.toThrow(/OpenAI only supports image attachments/);
		});

		it('transmits perTurnContext directly inside the user message', async () => {
			openaiCalls.create.mockResolvedValue({
				choices: [{ message: { role: 'assistant', content: 'ok' } }],
			});

			const renderedContext =
				'CONTEXT FILES: foo.md\n\n==============================\nFile Label: Context File\nFile Name: foo.md\n==============================\n\nThe quick brown fox jumps over the lazy dog.';

			await client.generateModelResponse({
				prompt: '',
				userMessage: 'what does the file say',
				kind: 'extended',
				conversationHistory: [],
				perTurnContext: renderedContext,
				projectInstructions: 'always cite file paths',
				sessionStartedAt: '2026-05-09T10:00:00',
			});

			const args = openaiCalls.create.mock.calls[0][0];

			const systemMessage = args.messages.find((m: any) => m.role === 'system');
			expect(systemMessage).toBeDefined();
			expect(systemMessage.content).not.toContain('## Turn Context');
			expect(systemMessage.content).not.toContain('The quick brown fox jumps over the lazy dog.');
			expect(systemMessage.content).toContain('always cite file paths');
			expect(systemMessage.content).toContain('2026-05-09T10:00:00');

			const userMessage = args.messages[args.messages.length - 1];
			expect(userMessage.role).toBe('user');
			expect(userMessage.content).toContain('what does the file say');
			expect(userMessage.content).toContain(renderedContext);
		});
	});

	describe('convertHistoryEntry() complex formats', () => {
		beforeEach(() => {
			openaiCalls.create.mockResolvedValue({
				choices: [{ message: { role: 'assistant', content: 'ok' } }],
			});
		});

		it('converts functionCall parts to an assistant message with tool_calls, synthesizing an id', async () => {
			await client.generateModelResponse({
				prompt: '',
				userMessage: 'do it',
				kind: 'extended',
				conversationHistory: [
					{ role: 'model', parts: [{ functionCall: { name: 'read_file', args: { path: 'test.md' } } }] },
				],
			});

			const msgs = openaiCalls.create.mock.calls[0][0].messages;
			const assistantMsg = msgs.find((m: any) => m.role === 'assistant' && m.tool_calls?.length);
			expect(assistantMsg).toBeDefined();
			expect(assistantMsg.content).toBeNull();
			expect(assistantMsg.tool_calls).toEqual([
				{
					id: 'call_read_file_0',
					type: 'function',
					function: { name: 'read_file', arguments: '{"path":"test.md"}' },
				},
			]);
		});

		it('pairs a functionResponse with the preceding functionCall id (synthesized)', async () => {
			await client.generateModelResponse({
				prompt: '',
				userMessage: 'ok',
				kind: 'extended',
				conversationHistory: [
					{ role: 'model', parts: [{ functionCall: { name: 'read_file', args: { path: 'test.md' } } }] },
					{
						role: 'user',
						parts: [{ functionResponse: { name: 'read_file', response: { content: 'data' } } }],
					},
				],
			});

			const msgs = openaiCalls.create.mock.calls[0][0].messages;
			const assistantMsg = msgs.find((m: any) => m.role === 'assistant' && m.tool_calls?.length);
			const toolMsg = msgs.find((m: any) => m.role === 'tool');
			expect(toolMsg).toBeDefined();
			expect(toolMsg.tool_call_id).toBe(assistantMsg.tool_calls[0].id);
			expect(toolMsg.content).toBe('{"content":"data"}');
		});

		it('pairs a functionResponse with the functionCall id when explicitly provided by Gemini', async () => {
			await client.generateModelResponse({
				prompt: '',
				userMessage: 'ok',
				kind: 'extended',
				conversationHistory: [
					{
						role: 'model',
						parts: [{ functionCall: { name: 'read_file', args: { path: 'a.md' }, id: 'gemini-call-1' } }],
					},
					{
						role: 'user',
						parts: [{ functionResponse: { name: 'read_file', response: { ok: true }, id: 'gemini-call-1' } }],
					},
				],
			});

			const msgs = openaiCalls.create.mock.calls[0][0].messages;
			const assistantMsg = msgs.find((m: any) => m.role === 'assistant' && m.tool_calls?.length);
			const toolMsg = msgs.find((m: any) => m.role === 'tool');
			expect(assistantMsg.tool_calls[0].id).toBe('gemini-call-1');
			expect(toolMsg.tool_call_id).toBe('gemini-call-1');
		});

		it('pairs two calls to the same tool with their respective responses in order', async () => {
			await client.generateModelResponse({
				prompt: '',
				userMessage: 'go',
				kind: 'extended',
				conversationHistory: [
					{
						role: 'model',
						parts: [
							{ functionCall: { name: 'read_file', args: { path: 'a.md' } } },
							{ functionCall: { name: 'read_file', args: { path: 'b.md' } } },
						],
					},
					{
						role: 'user',
						parts: [
							{ functionResponse: { name: 'read_file', response: { path: 'a.md' } } },
							{ functionResponse: { name: 'read_file', response: { path: 'b.md' } } },
						],
					},
				],
			});

			const msgs = openaiCalls.create.mock.calls[0][0].messages;
			const assistantMsg = msgs.find((m: any) => m.role === 'assistant' && m.tool_calls?.length);
			const toolMsgs = msgs.filter((m: any) => m.role === 'tool');
			expect(assistantMsg.tool_calls).toHaveLength(2);
			expect(toolMsgs).toHaveLength(2);
			expect(toolMsgs[0].tool_call_id).toBe(assistantMsg.tool_calls[0].id);
			expect(toolMsgs[1].tool_call_id).toBe(assistantMsg.tool_calls[1].id);
			expect(toolMsgs[0].content).toBe('{"path":"a.md"}');
			expect(toolMsgs[1].content).toBe('{"path":"b.md"}');
		});

		it('serializes null functionResponse as "null"', async () => {
			await client.generateModelResponse({
				prompt: '',
				userMessage: 'ok',
				kind: 'extended',
				conversationHistory: [
					{ role: 'model', parts: [{ functionCall: { name: 'tool1', args: {} } }] },
					{ role: 'user', parts: [{ functionResponse: { name: 'tool1', response: null as any } }] },
				],
			});

			const msgs = openaiCalls.create.mock.calls[0][0].messages;
			const toolMsg = msgs.find((m: any) => m.role === 'tool');
			expect(toolMsg.content).toBe('null');
		});

		it('passes string functionResponse as-is', async () => {
			await client.generateModelResponse({
				prompt: '',
				userMessage: 'ok',
				kind: 'extended',
				conversationHistory: [
					{ role: 'model', parts: [{ functionCall: { name: 'tool1', args: {} } }] },
					{ role: 'user', parts: [{ functionResponse: { name: 'tool1', response: 'raw result' as any } }] },
				],
			});

			const msgs = openaiCalls.create.mock.calls[0][0].messages;
			const toolMsg = msgs.find((m: any) => m.role === 'tool');
			expect(toolMsg.content).toBe('raw result');
		});

		it('drops a tool response whose functionCall was trimmed from history', async () => {
			await client.generateModelResponse({
				prompt: '',
				userMessage: 'ok',
				kind: 'extended',
				conversationHistory: [
					// Compaction removed the model turn that declared this call.
					{ role: 'user', parts: [{ functionResponse: { name: 'tool1', response: { ok: true } } }] },
				],
			});

			const msgs = openaiCalls.create.mock.calls[0][0].messages;
			expect(msgs.filter((m: any) => m.role === 'tool')).toHaveLength(0);
		});

		it('emits the assistant tool_calls message before its tool responses', async () => {
			await client.generateModelResponse({
				prompt: '',
				userMessage: 'ok',
				kind: 'extended',
				conversationHistory: [
					{ role: 'model', parts: [{ text: 'calling' }, { functionCall: { name: 'tool1', args: {} } }] },
					{ role: 'user', parts: [{ functionResponse: { name: 'tool1', response: 'done' as any } }] },
				],
			});

			const msgs = openaiCalls.create.mock.calls[0][0].messages;
			const assistantIdx = msgs.findIndex((m: any) => m.role === 'assistant' && m.tool_calls?.length);
			const toolIdx = msgs.findIndex((m: any) => m.role === 'tool');
			expect(assistantIdx).toBeGreaterThanOrEqual(0);
			expect(toolIdx).toBeGreaterThan(assistantIdx);
			expect(msgs[toolIdx].tool_call_id).toBe(msgs[assistantIdx].tool_calls[0].id);
		});

		it('handles mixed text + functionCall in one model entry', async () => {
			await client.generateModelResponse({
				prompt: '',
				userMessage: 'go',
				kind: 'extended',
				conversationHistory: [
					{
						role: 'model',
						parts: [{ text: 'Let me read that.' }, { functionCall: { name: 'read_file', args: { path: 'x.md' } } }],
					},
				],
			});

			const msgs = openaiCalls.create.mock.calls[0][0].messages;
			const assistantMsg = msgs.find((m: any) => m.role === 'assistant' && m.tool_calls?.length);
			expect(assistantMsg).toBeDefined();
			expect(assistantMsg.content).toBe('Let me read that.');
			expect(assistantMsg.tool_calls[0].function).toEqual({
				name: 'read_file',
				arguments: '{"path":"x.md"}',
			});
		});

		it('converts image inlineData in history to a user message with an image_url content part', async () => {
			await client.generateModelResponse({
				prompt: '',
				userMessage: 'describe it',
				kind: 'extended',
				conversationHistory: [
					{
						role: 'user',
						parts: [{ text: 'look at this' }, { inlineData: { mimeType: 'image/png', data: 'abc123' } }],
					},
				],
			});

			const msgs = openaiCalls.create.mock.calls[0][0].messages;
			const imageMsg = msgs.find((m: any) => m.role === 'user' && Array.isArray(m.content));
			expect(imageMsg).toBeDefined();
			expect(imageMsg.content).toEqual([
				{ type: 'text', text: 'look at this' },
				{ type: 'image_url', image_url: { url: 'data:image/png;base64,abc123' } },
			]);
		});

		it('throws for non-image inlineData in history', async () => {
			await expect(
				client.generateModelResponse({
					prompt: '',
					userMessage: 'read it',
					kind: 'extended',
					conversationHistory: [
						{ role: 'user', parts: [{ inlineData: { mimeType: 'application/pdf', data: 'abc' } }] },
					],
				})
			).rejects.toThrow(/OpenAI only supports image attachments/);
		});

		it('converts system role entry to system message', async () => {
			await client.generateModelResponse({
				prompt: '',
				userMessage: 'hi',
				kind: 'extended',
				conversationHistory: [{ role: 'system', parts: [{ text: 'system instruction' }] }],
			});

			const msgs = openaiCalls.create.mock.calls[0][0].messages;
			const systemMsgs = msgs.filter((m: any) => m.role === 'system');
			const historySystem = systemMsgs.find((m: any) => m.content === 'system instruction');
			expect(historySystem).toBeDefined();
		});

		it('skips null entries in history', async () => {
			await client.generateModelResponse({
				prompt: '',
				userMessage: 'hi',
				kind: 'extended',
				conversationHistory: [null as any, { role: 'user', parts: [{ text: 'hello' }] }],
			});

			const msgs = openaiCalls.create.mock.calls[0][0].messages;
			const userMsgs = msgs.filter((m: any) => m.role === 'user' && m.content === 'hello');
			expect(userMsgs.length).toBe(1);
		});

		it('converts internal {role, text} format', async () => {
			await client.generateModelResponse({
				prompt: '',
				userMessage: 'go',
				kind: 'extended',
				conversationHistory: [{ role: 'model', text: 'hello' } as any],
			});

			const msgs = openaiCalls.create.mock.calls[0][0].messages;
			const assistantMsg = msgs.find((m: any) => m.role === 'assistant' && m.content === 'hello');
			expect(assistantMsg).toBeDefined();
		});

		it('converts internal {role, message} format', async () => {
			await client.generateModelResponse({
				prompt: '',
				userMessage: 'go',
				kind: 'extended',
				conversationHistory: [{ role: 'user', message: 'hey' } as any],
			});

			const msgs = openaiCalls.create.mock.calls[0][0].messages;
			const userMsg = msgs.find((m: any) => m.role === 'user' && m.content === 'hey');
			expect(userMsg).toBeDefined();
		});

		it('skips entries with empty text in internal format', async () => {
			await client.generateModelResponse({
				prompt: '',
				userMessage: 'go',
				kind: 'extended',
				conversationHistory: [{ role: 'user', text: '  ' } as any],
			});

			const msgs = openaiCalls.create.mock.calls[0][0].messages;
			const userMsgs = msgs.filter((m: any) => m.role === 'user');
			expect(userMsgs.length).toBe(1);
			expect(userMsgs[0].content).toBe('go');
		});

		it('maps "assistant" role in internal format to assistant', async () => {
			await client.generateModelResponse({
				prompt: '',
				userMessage: 'go',
				kind: 'extended',
				conversationHistory: [{ role: 'assistant', text: 'response' } as any],
			});

			const msgs = openaiCalls.create.mock.calls[0][0].messages;
			const assistantMsg = msgs.find((m: any) => m.role === 'assistant' && m.content === 'response');
			expect(assistantMsg).toBeDefined();
		});
	});

	describe('toUsageMetadata()', () => {
		it('returns usage mapping when usage is provided', () => {
			const result = (client as any).toUsageMetadata({
				prompt_tokens: 10,
				completion_tokens: 5,
				total_tokens: 15,
			});
			expect(result).toEqual({ promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 });
		});

		it('returns undefined when usage is undefined', () => {
			const result = (client as any).toUsageMetadata(undefined);
			expect(result).toBeUndefined();
		});
	});

	describe('generateStreamingResponse', () => {
		function chunk(partial: any) {
			return {
				id: 'chunk',
				object: 'chat.completion.chunk',
				created: 0,
				model: 'gpt-4o-mini',
				choices: [{ index: 0, delta: partial.delta ?? {}, finish_reason: partial.finish_reason ?? null }],
				...(partial.usage !== undefined ? { usage: partial.usage } : {}),
			};
		}

		it('accumulates text deltas and reports usageMetadata from the final chunk', async () => {
			async function* stream() {
				yield chunk({ delta: { role: 'assistant', content: 'hel' } });
				yield chunk({ delta: { content: 'lo' } });
				yield chunk({
					delta: {},
					finish_reason: 'stop',
					usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
				});
			}
			openaiCalls.create.mockResolvedValue(stream());

			const chunks: string[] = [];
			const streaming = client.generateStreamingResponse(
				{ prompt: '', userMessage: 'hi', kind: 'extended', conversationHistory: [] },
				(c) => chunks.push(c.text)
			);
			const result = await streaming.complete;

			expect(chunks.join('')).toBe('hello');
			expect(result.markdown).toBe('hello');
			expect(result.usageMetadata).toEqual({
				promptTokenCount: 5,
				candidatesTokenCount: 3,
				totalTokenCount: 8,
			});

			// stream_options.include_usage should be requested
			const args = openaiCalls.create.mock.calls[0][0];
			expect(args.stream_options).toEqual({ include_usage: true });
		});

		it('accumulates reasoning_content deltas into thoughts', async () => {
			async function* stream() {
				yield chunk({ delta: { role: 'assistant', reasoning_content: 'step 1' } });
				yield chunk({ delta: { content: 'answer', reasoning_content: ' step 2' } });
			}
			openaiCalls.create.mockResolvedValue(stream());

			const thoughts: string[] = [];
			const streaming = client.generateStreamingResponse(
				{ prompt: '', userMessage: 'think', kind: 'extended', conversationHistory: [] },
				(c) => {
					if (c.thought) thoughts.push(c.thought);
				}
			);
			const result = await streaming.complete;

			expect(result.thoughts).toBe('step 1 step 2');
			expect(result.markdown).toBe('answer');
			expect(thoughts).toEqual(['step 1', ' step 2']);
		});

		it('accumulates tool_call deltas by index across chunks', async () => {
			async function* stream() {
				yield chunk({
					delta: {
						tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '' } }],
					},
				});
				yield chunk({ delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":' } }] } });
				yield chunk({ delta: { tool_calls: [{ index: 0, function: { arguments: '"a.md"}' } }] } });
				yield chunk({ delta: {}, finish_reason: 'tool_calls' });
			}
			openaiCalls.create.mockResolvedValue(stream());

			const streaming = client.generateStreamingResponse(
				{ prompt: '', userMessage: 'hi', kind: 'extended', conversationHistory: [] },
				() => {}
			);
			const result = await streaming.complete;

			expect(result.toolCalls).toEqual([{ id: 'call_1', name: 'read_file', arguments: { path: 'a.md' } }]);
		});

		// A real abort() rejects the SDK's underlying fetch, which propagates out
		// of the `for await` loop as a rejection. Mimic that here (rather than
		// hanging on an unresolved promise the mock's abort() can't reach) so
		// cancellation actually unblocks the loop the way it does against a real
		// server.
		function pendingUntilAborted(signal?: AbortSignal): Promise<never> {
			return new Promise((_, reject) => {
				if (signal?.aborted) {
					reject(new Error('Aborted'));
					return;
				}
				signal?.addEventListener('abort', () => reject(new Error('Aborted')));
			});
		}

		it('cancel() aborts the underlying request signal and unblocks the stream loop', async () => {
			async function* slowStream(signal?: AbortSignal) {
				yield chunk({ delta: { role: 'assistant', content: 'a' } });
				await pendingUntilAborted(signal);
			}
			let capturedSignal: AbortSignal | undefined;
			openaiCalls.create.mockImplementation((_body: any, options: any) => {
				capturedSignal = options?.signal;
				return Promise.resolve(slowStream(options?.signal));
			});

			const streaming = client.generateStreamingResponse(
				{ prompt: '', userMessage: 'hi', kind: 'extended', conversationHistory: [] },
				() => {}
			);
			// Allow the first chunk to be consumed
			await new Promise((r) => window.setTimeout(r, 0));
			streaming.cancel();
			await streaming.complete;

			expect(capturedSignal?.aborted).toBe(true);
		});

		it('omits usageMetadata when the stream cancels before a final usage chunk', async () => {
			async function* slowStream(signal?: AbortSignal) {
				yield chunk({ delta: { role: 'assistant', content: 'partial' } });
				await pendingUntilAborted(signal);
			}
			openaiCalls.create.mockImplementation((_body: any, options: any) => Promise.resolve(slowStream(options?.signal)));

			const streaming = client.generateStreamingResponse(
				{ prompt: '', userMessage: 'hi', kind: 'extended', conversationHistory: [] },
				() => {}
			);
			await new Promise((r) => window.setTimeout(r, 0));
			streaming.cancel();
			const result = await streaming.complete;

			expect(result.markdown).toBe('partial');
			expect(result.usageMetadata).toBeUndefined();
		});

		it('streams BaseModelRequest prompts too', async () => {
			async function* stream() {
				yield chunk({ delta: { role: 'assistant', content: 'hi there' } });
				yield chunk({
					delta: {},
					finish_reason: 'stop',
					usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
				});
			}
			openaiCalls.create.mockResolvedValue(stream());

			const chunks: string[] = [];
			const streaming = client.generateStreamingResponse({ kind: 'base', prompt: 'hello' }, (c) => chunks.push(c.text));
			const result = await streaming.complete;

			expect(chunks.join('')).toBe('hi there');
			expect(result.markdown).toBe('hi there');
			const args = openaiCalls.create.mock.calls[0][0];
			expect(args.messages).toEqual([{ role: 'user', content: 'hello' }]);
		});
	});

	describe('sampling-parameter defaults', () => {
		it('falls back to temperature 0.7 and top_p 1 when the config omits them', async () => {
			openaiCalls.create.mockResolvedValue({
				choices: [{ message: { content: 'ok' } }],
			});
			const c = new OpenAIClient(
				{ apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
				undefined,
				buildPlugin()
			);
			await c.generateModelResponse({ kind: 'base', prompt: 'test' });

			const args = openaiCalls.create.mock.calls[0][0];
			expect(args.temperature).toBe(0.7);
			expect(args.top_p).toBe(1);
		});
	});

	// GPT-5.6 reasoning models reject a non-default temperature/top_p outright,
	// and reject function tools in Chat Completions unless reasoning is off.
	describe('GPT-5.6 parameter handling', () => {
		const gpt56Config: OpenAIClientConfig = {
			apiKey: 'sk-test',
			baseUrl: 'https://api.openai.com/v1',
			model: 'gpt-5.6-luna',
			temperature: 0.4,
			topP: 0.9,
		};
		const readFileTool: ToolDefinition = {
			name: 'read_file',
			description: 'reads a file',
			parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
		};

		let gpt56Client: OpenAIClient;

		beforeEach(() => {
			gpt56Client = new OpenAIClient(gpt56Config, undefined, buildPlugin());
			openaiCalls.create.mockResolvedValue({ choices: [{ message: { content: 'ok' } }] });
		});

		it('omits temperature and top_p for a base request', async () => {
			await gpt56Client.generateModelResponse({ kind: 'base', prompt: 'hi' });

			const args = openaiCalls.create.mock.calls[0][0];
			expect(args).not.toHaveProperty('temperature');
			expect(args).not.toHaveProperty('top_p');
		});

		it('omits temperature and top_p even when the request supplies them', async () => {
			await gpt56Client.generateModelResponse({ kind: 'base', prompt: 'hi', temperature: 0.2 });

			const args = openaiCalls.create.mock.calls[0][0];
			expect(args).not.toHaveProperty('temperature');
			expect(args).not.toHaveProperty('top_p');
		});

		it("sets reasoning_effort 'none' when sending tools", async () => {
			await gpt56Client.generateModelResponse({
				prompt: '',
				userMessage: 'read foo',
				kind: 'extended',
				conversationHistory: [],
				availableTools: [readFileTool],
			});

			const args = openaiCalls.create.mock.calls[0][0];
			expect(args.reasoning_effort).toBe('none');
			expect(args.tools).toHaveLength(1);
		});

		it('does not set reasoning_effort when there are no tools', async () => {
			await gpt56Client.generateModelResponse({
				prompt: '',
				userMessage: 'just chat',
				kind: 'extended',
				conversationHistory: [],
			});

			const args = openaiCalls.create.mock.calls[0][0];
			expect(args).not.toHaveProperty('reasoning_effort');
		});

		it('applies the same handling on the streaming path', async () => {
			async function* stream() {
				yield { choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] };
			}
			openaiCalls.create.mockResolvedValue(stream());

			const streaming = gpt56Client.generateStreamingResponse(
				{
					prompt: '',
					userMessage: 'read foo',
					kind: 'extended',
					conversationHistory: [],
					availableTools: [readFileTool],
				},
				() => {}
			);
			await streaming.complete;

			const args = openaiCalls.create.mock.calls[0][0];
			expect(args).not.toHaveProperty('temperature');
			expect(args).not.toHaveProperty('top_p');
			expect(args.reasoning_effort).toBe('none');
		});

		it('leaves non-GPT-5.6 models untouched', async () => {
			const c = new OpenAIClient({ ...gpt56Config, model: 'gpt-4o-mini' }, undefined, buildPlugin());
			await c.generateModelResponse({
				prompt: '',
				userMessage: 'read foo',
				kind: 'extended',
				conversationHistory: [],
				availableTools: [readFileTool],
			});

			const args = openaiCalls.create.mock.calls[0][0];
			expect(args.temperature).toBe(0.4);
			expect(args.top_p).toBe(0.9);
			expect(args).not.toHaveProperty('reasoning_effort');
		});
	});

	describe('no model error', () => {
		it('generateModelResponse throws when no model configured', async () => {
			const c = new OpenAIClient({ apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1' }, undefined, buildPlugin());
			await expect(c.generateModelResponse({ kind: 'base', prompt: 'test' })).rejects.toThrow(
				'No OpenAI model selected'
			);
		});

		it('streaming throws when no model configured', async () => {
			const c = new OpenAIClient({ apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1' }, undefined, buildPlugin());
			const streaming = c.generateStreamingResponse(
				{ prompt: '', userMessage: 'hi', kind: 'extended', conversationHistory: [] },
				() => {}
			);
			await expect(streaming.complete).rejects.toThrow('No OpenAI model selected');
		});
	});

	describe('error propagation', () => {
		it('logs and re-throws errors from generateModelResponse', async () => {
			openaiCalls.create.mockRejectedValue(new Error('connection refused'));

			await expect(client.generateModelResponse({ kind: 'base', prompt: 'test' })).rejects.toThrow(
				'connection refused'
			);
			expect(mockLogger.error).toHaveBeenCalledWith(
				'[OpenAIClient] Error generating content:',
				'connection refused',
				expect.any(Error)
			);
		});

		it('logs and re-throws streaming errors when not cancelled', async () => {
			openaiCalls.create.mockRejectedValue(new Error('connection refused'));

			const streaming = client.generateStreamingResponse(
				{ prompt: '', userMessage: 'hi', kind: 'extended', conversationHistory: [] },
				() => {}
			);

			await expect(streaming.complete).rejects.toThrow('connection refused');
			expect(mockLogger.error).toHaveBeenCalledWith(
				'[OpenAIClient] Streaming error:',
				'connection refused',
				expect.any(Error)
			);
		});

		// The formatted string is only `error.message` for a non-API error, so the
		// raw error has to ride along or the stack trace never reaches the console.
		it('passes the original error through so its stack survives', async () => {
			const raw = new TypeError('boom');
			openaiCalls.create.mockRejectedValue(raw);

			await expect(client.generateModelResponse({ kind: 'base', prompt: 'test' })).rejects.toThrow('boom');

			expect(mockLogger.error).toHaveBeenCalledWith('[OpenAIClient] Error generating content:', 'boom', raw);
		});

		it('surfaces the server message from an API error body instead of a flattened object', async () => {
			openaiCalls.create.mockRejectedValue(
				Object.assign(new Error('400 status code (no body)'), {
					status: 400,
					code: 'unsupported_value',
					error: { message: "Unsupported value: 'temperature' does not support 0.7 with this model." },
				})
			);

			const streaming = client.generateStreamingResponse(
				{ prompt: '', userMessage: 'hi', kind: 'extended', conversationHistory: [] },
				() => {}
			);
			await expect(streaming.complete).rejects.toThrow();

			expect(mockLogger.error).toHaveBeenCalledWith(
				'[OpenAIClient] Streaming error:',
				"HTTP 400 [unsupported_value]: Unsupported value: 'temperature' does not support 0.7 with this model.",
				expect.anything()
			);
		});
	});

	describe('constructor', () => {
		it('constructs the OpenAI SDK client with dangerouslyAllowBrowser and maxRetries: 0', async () => {
			// The mocked constructor stashes its opts on the instance; reach in via
			// the private `client` field to assert the wiring without a real network call.
			const opts = (client as any).client.constructorOpts;
			expect(opts).toEqual({
				apiKey: 'sk-test',
				baseURL: 'https://api.openai.com/v1',
				dangerouslyAllowBrowser: true,
				maxRetries: 0,
			});
		});
	});
});
