import type { Mock } from 'vitest';
import { OllamaClient } from '../../../../src/api/providers/ollama/client';
import type { OllamaClientConfig } from '../../../../src/api/providers/ollama/config';
import { ExtendedModelRequest } from '../../../../src/api/interfaces/model-api';

// vitest hoists vi.mock to the top of the file; vi.hoisted() lets us share
// fixtures with the factory while keeping initialization order safe.
const { ollamaCalls } = vi.hoisted(() => {
	const ollamaCalls: { chat: Mock; generate: Mock; abort: Mock } = {
		chat: vi.fn(),
		generate: vi.fn(),
		abort: vi.fn(),
	};
	return { ollamaCalls };
});

vi.mock('ollama/browser', () => ({
	// Use function syntax so `new Ollama()` works under vitest 4 (arrow impls
	// aren't constructable).
	Ollama: vi.fn().mockImplementation(function () {
		return {
			chat: (...args: any[]) => ollamaCalls.chat(...args),
			generate: (...args: any[]) => ollamaCalls.generate(...args),
			abort: () => ollamaCalls.abort(),
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
			provider: 'ollama',
			ollamaBaseUrl: 'http://localhost:11434',
			userName: 'Tester',
			ragIndexing: { enabled: false },
		},
		agentsMemory: { read: vi.fn().mockResolvedValue('') },
		skillManager: { getSkillSummaries: vi.fn().mockResolvedValue([]) },
		ragIndexing: null,
	}) as any;

const baseConfig: OllamaClientConfig = {
	baseUrl: 'http://localhost:11434',
	model: 'llama3.2',
	temperature: 0.4,
	topP: 0.9,
};

describe('OllamaClient', () => {
	let client: OllamaClient;

	beforeEach(() => {
		ollamaCalls.chat.mockReset();
		ollamaCalls.generate.mockReset();
		ollamaCalls.abort.mockReset();
		mockLogger.error.mockReset();
		client = new OllamaClient(baseConfig, undefined, buildPlugin());
	});

	describe('generateModelResponse (BaseModelRequest)', () => {
		it('routes simple prompts through ollama.generate and forwards options', async () => {
			ollamaCalls.generate.mockResolvedValue({
				response: 'hello world',
				prompt_eval_count: 10,
				eval_count: 4,
				done: true,
			});

			const response = await client.generateModelResponse({
				prompt: 'say hi',
				temperature: 0.2,
			});

			expect(ollamaCalls.generate).toHaveBeenCalledTimes(1);
			const args = ollamaCalls.generate.mock.calls[0][0];
			expect(args.model).toBe('llama3.2');
			expect(args.prompt).toBe('say hi');
			expect(args.stream).toBe(false);
			expect(args.options.temperature).toBe(0.2);
			expect(args.options.top_p).toBe(0.9);

			expect(response.markdown).toBe('hello world');
			expect(response.usageMetadata).toEqual({
				promptTokenCount: 10,
				candidatesTokenCount: 4,
				totalTokenCount: 14,
			});
		});
	});

	describe('generateModelResponse (ExtendedModelRequest)', () => {
		it('routes chat through ollama.chat with system + history + user message', async () => {
			ollamaCalls.chat.mockResolvedValue({
				message: { role: 'assistant', content: 'reply' },
				prompt_eval_count: 50,
				eval_count: 2,
				done: true,
			});

			const request: ExtendedModelRequest = {
				prompt: '',
				userMessage: 'what is up',
				conversationHistory: [
					{ role: 'user', parts: [{ text: 'previous user turn' }] },
					{ role: 'model', parts: [{ text: 'previous assistant turn' }] },
				],
			};

			const response = await client.generateModelResponse(request);

			expect(ollamaCalls.chat).toHaveBeenCalledTimes(1);
			const args = ollamaCalls.chat.mock.calls[0][0];
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
			ollamaCalls.chat.mockResolvedValue({
				message: {
					role: 'assistant',
					content: '',
					tool_calls: [{ function: { name: 'read_file', arguments: { path: 'foo.md' } } }],
				},
				prompt_eval_count: 1,
				eval_count: 1,
				done: true,
			});

			const response = await client.generateModelResponse({
				prompt: '',
				userMessage: 'read foo',
				conversationHistory: [],
				availableTools: [
					{
						name: 'read_file',
						description: 'reads a file',
						parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
					},
				],
			});

			expect(response.toolCalls).toEqual([{ name: 'read_file', arguments: { path: 'foo.md' } }]);
			expect(ollamaCalls.chat.mock.calls[0][0].tools).toEqual([
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

		it('attaches image inline data to the user message', async () => {
			ollamaCalls.chat.mockResolvedValue({
				message: { role: 'assistant', content: 'ok' },
				prompt_eval_count: 1,
				eval_count: 1,
				done: true,
			});

			await client.generateModelResponse({
				prompt: '',
				userMessage: 'what is in this picture',
				conversationHistory: [],
				inlineAttachments: [{ mimeType: 'image/png', base64: 'b64data' }],
			});

			const args = ollamaCalls.chat.mock.calls[0][0];
			const userTurn = args.messages[args.messages.length - 1];
			expect(userTurn.images).toEqual(['b64data']);
		});

		// Regression test for the drag-and-drop / @-mention bug fixed in
		// the perTurnContext-on-followup PR. perTurnContext is the rendered
		// content of context-chip files; the OllamaClient must paste it into
		// the system message under "## Turn Context" so the model can read
		// dropped/@-mentioned files without a redundant `read_file` tool call.
		// This test asserts the wiring on the initial request — see
		// agent-loop.test.ts for the follow-up propagation guarantee.
		it('transmits perTurnContext directly inside the user message', async () => {
			ollamaCalls.chat.mockResolvedValue({
				message: { role: 'assistant', content: 'ok' },
				prompt_eval_count: 1,
				eval_count: 1,
				done: true,
			});

			const renderedContext =
				'CONTEXT FILES: foo.md\n\n==============================\nFile Label: Context File\nFile Name: foo.md\n==============================\n\nThe quick brown fox jumps over the lazy dog.';

			await client.generateModelResponse({
				prompt: '',
				userMessage: 'what does the file say',
				conversationHistory: [],
				perTurnContext: renderedContext,
				projectInstructions: 'always cite file paths',
				sessionStartedAt: '2026-05-09T10:00:00',
			});

			const args = ollamaCalls.chat.mock.calls[0][0];

			// System message should be static (no perTurnContext!)
			const systemMessage = args.messages.find((m: any) => m.role === 'system');
			expect(systemMessage).toBeDefined();
			expect(systemMessage.content).not.toContain('## Turn Context');
			expect(systemMessage.content).not.toContain('The quick brown fox jumps over the lazy dog.');
			expect(systemMessage.content).toContain('always cite file paths');
			expect(systemMessage.content).toContain('2026-05-09T10:00:00');

			// User message must contain both query and perTurnContext joined
			const userMessage = args.messages[args.messages.length - 1];
			expect(userMessage.role).toBe('user');
			expect(userMessage.content).toContain('what does the file say');
			expect(userMessage.content).toContain(renderedContext);
		});

		it('rejects non-image attachments with a clear error', async () => {
			await expect(
				client.generateModelResponse({
					prompt: '',
					userMessage: 'read this',
					conversationHistory: [],
					inlineAttachments: [{ mimeType: 'application/pdf', base64: 'b64data' }],
				})
			).rejects.toThrow(/Ollama only supports image attachments/);
		});
	});

	describe('generateStreamingResponse', () => {
		it('accumulates chunks and reports usageMetadata at done', async () => {
			async function* chatStream() {
				yield { message: { content: 'hel' }, done: false };
				yield { message: { content: 'lo' }, done: false };
				yield {
					message: { content: '!' },
					done: true,
					prompt_eval_count: 5,
					eval_count: 3,
				};
			}
			const stream: any = chatStream();
			stream.abort = vi.fn();
			ollamaCalls.chat.mockResolvedValue(stream);

			const chunks: string[] = [];
			const streaming = client.generateStreamingResponse(
				{ prompt: '', userMessage: 'hi', conversationHistory: [] },
				(chunk) => chunks.push(chunk.text)
			);
			const result = await streaming.complete;

			expect(chunks.join('')).toBe('hello!');
			expect(result.markdown).toBe('hello!');
			expect(result.usageMetadata).toEqual({
				promptTokenCount: 5,
				candidatesTokenCount: 3,
				totalTokenCount: 8,
			});
		});

		it('cancel() aborts the underlying stream', async () => {
			const abort = vi.fn();
			async function* slowStream() {
				yield { message: { content: 'a' }, done: false };
				// never reaches done
			}
			const stream: any = slowStream();
			stream.abort = abort;
			ollamaCalls.chat.mockResolvedValue(stream);

			const streaming = client.generateStreamingResponse(
				{ prompt: '', userMessage: 'hi', conversationHistory: [] },
				() => {}
			);
			// Allow the first chunk to be consumed
			await new Promise((r) => window.setTimeout(r, 0));
			streaming.cancel();
			await streaming.complete;

			expect(abort).toHaveBeenCalled();
		});

		it('omits usageMetadata when the stream cancels before the done chunk', async () => {
			// Ollama only emits prompt_eval_count / eval_count on the terminal
			// done chunk. If the user cancels first, we should not synthesize a
			// {0,0,0} payload — that would look like a real zero-token run in
			// the token UI / eval reporter. usageMetadata should be omitted.
			async function* slowStream() {
				yield { message: { content: 'partial' }, done: false };
			}
			const stream: any = slowStream();
			stream.abort = vi.fn();
			ollamaCalls.chat.mockResolvedValue(stream);

			const streaming = client.generateStreamingResponse(
				{ prompt: '', userMessage: 'hi', conversationHistory: [] },
				() => {}
			);
			await new Promise((r) => window.setTimeout(r, 0));
			streaming.cancel();
			const result = await streaming.complete;

			expect(result.markdown).toBe('partial');
			expect(result.usageMetadata).toBeUndefined();
		});
	});

	describe('convertHistoryEntry() complex formats', () => {
		beforeEach(() => {
			ollamaCalls.chat.mockResolvedValue({
				message: { role: 'assistant', content: 'ok' },
				prompt_eval_count: 1,
				eval_count: 1,
				done: true,
			});
		});

		it('converts functionCall parts to assistant message with tool_calls', async () => {
			await client.generateModelResponse({
				prompt: '',
				userMessage: 'do it',
				conversationHistory: [
					{ role: 'model', parts: [{ functionCall: { name: 'read_file', args: { path: 'test.md' } } }] },
				],
			});

			const msgs = ollamaCalls.chat.mock.calls[0][0].messages;
			const assistantMsg = msgs.find((m: any) => m.role === 'assistant' && m.tool_calls?.length);
			expect(assistantMsg).toBeDefined();
			expect(assistantMsg.content).toBe('');
			expect(assistantMsg.tool_calls).toEqual([{ function: { name: 'read_file', arguments: { path: 'test.md' } } }]);
		});

		it('converts functionResponse parts to tool role message', async () => {
			await client.generateModelResponse({
				prompt: '',
				userMessage: 'ok',
				conversationHistory: [
					{
						role: 'user',
						parts: [{ functionResponse: { name: 'read_file', response: { content: 'data' } } }],
					},
				],
			});

			const msgs = ollamaCalls.chat.mock.calls[0][0].messages;
			const toolMsg = msgs.find((m: any) => m.role === 'tool');
			expect(toolMsg).toBeDefined();
			expect(toolMsg.content).toBe('{"content":"data"}');
			expect(toolMsg.tool_name).toBe('read_file');
		});

		it('serializes null functionResponse as "null"', async () => {
			await client.generateModelResponse({
				prompt: '',
				userMessage: 'ok',
				conversationHistory: [
					{ role: 'user', parts: [{ functionResponse: { name: 'tool1', response: null as any } }] },
				],
			});

			const msgs = ollamaCalls.chat.mock.calls[0][0].messages;
			const toolMsg = msgs.find((m: any) => m.role === 'tool');
			expect(toolMsg.content).toBe('null');
		});

		it('passes string functionResponse as-is', async () => {
			await client.generateModelResponse({
				prompt: '',
				userMessage: 'ok',
				conversationHistory: [
					{ role: 'user', parts: [{ functionResponse: { name: 'tool1', response: 'raw result' as any } }] },
				],
			});

			const msgs = ollamaCalls.chat.mock.calls[0][0].messages;
			const toolMsg = msgs.find((m: any) => m.role === 'tool');
			expect(toolMsg.content).toBe('raw result');
		});

		it('handles mixed text + functionCall in one model entry', async () => {
			await client.generateModelResponse({
				prompt: '',
				userMessage: 'go',
				conversationHistory: [
					{
						role: 'model',
						parts: [{ text: 'Let me read that.' }, { functionCall: { name: 'read_file', args: { path: 'x.md' } } }],
					},
				],
			});

			const msgs = ollamaCalls.chat.mock.calls[0][0].messages;
			const assistantMsg = msgs.find((m: any) => m.role === 'assistant' && m.tool_calls?.length);
			expect(assistantMsg).toBeDefined();
			expect(assistantMsg.content).toBe('Let me read that.');
			expect(assistantMsg.tool_calls).toEqual([{ function: { name: 'read_file', arguments: { path: 'x.md' } } }]);
		});

		it('converts image inlineData in history to message with images array', async () => {
			await client.generateModelResponse({
				prompt: '',
				userMessage: 'describe it',
				conversationHistory: [
					{
						role: 'user',
						parts: [{ text: 'look at this' }, { inlineData: { mimeType: 'image/png', data: 'abc123' } }],
					},
				],
			});

			const msgs = ollamaCalls.chat.mock.calls[0][0].messages;
			const imageMsg = msgs.find((m: any) => m.role === 'user' && m.images?.length);
			expect(imageMsg).toBeDefined();
			expect(imageMsg.content).toBe('look at this');
			expect(imageMsg.images).toEqual(['abc123']);
		});

		it('throws for non-image inlineData in history', async () => {
			await expect(
				client.generateModelResponse({
					prompt: '',
					userMessage: 'read it',
					conversationHistory: [
						{ role: 'user', parts: [{ inlineData: { mimeType: 'application/pdf', data: 'abc' } }] },
					],
				})
			).rejects.toThrow(/Ollama only supports image attachments/);
		});

		it('converts system role entry to system message', async () => {
			await client.generateModelResponse({
				prompt: '',
				userMessage: 'hi',
				conversationHistory: [{ role: 'system', parts: [{ text: 'system instruction' }] }],
			});

			const msgs = ollamaCalls.chat.mock.calls[0][0].messages;
			const systemMsgs = msgs.filter((m: any) => m.role === 'system');
			// At least 2 system messages: the built-in one and the history one
			const historySystem = systemMsgs.find((m: any) => m.content === 'system instruction');
			expect(historySystem).toBeDefined();
		});

		it('skips null entries in history', async () => {
			await client.generateModelResponse({
				prompt: '',
				userMessage: 'hi',
				conversationHistory: [null as any, { role: 'user', parts: [{ text: 'hello' }] }],
			});

			const msgs = ollamaCalls.chat.mock.calls[0][0].messages;
			const userMsgs = msgs.filter((m: any) => m.role === 'user' && m.content === 'hello');
			expect(userMsgs.length).toBe(1);
		});

		it('converts internal {role, text} format', async () => {
			await client.generateModelResponse({
				prompt: '',
				userMessage: 'go',
				conversationHistory: [{ role: 'model', text: 'hello' } as any],
			});

			const msgs = ollamaCalls.chat.mock.calls[0][0].messages;
			const assistantMsg = msgs.find((m: any) => m.role === 'assistant' && m.content === 'hello');
			expect(assistantMsg).toBeDefined();
		});

		it('converts internal {role, message} format', async () => {
			await client.generateModelResponse({
				prompt: '',
				userMessage: 'go',
				conversationHistory: [{ role: 'user', message: 'hey' } as any],
			});

			const msgs = ollamaCalls.chat.mock.calls[0][0].messages;
			const userMsg = msgs.find((m: any) => m.role === 'user' && m.content === 'hey');
			expect(userMsg).toBeDefined();
		});

		it('skips entries with empty text in internal format', async () => {
			await client.generateModelResponse({
				prompt: '',
				userMessage: 'go',
				conversationHistory: [{ role: 'user', text: '  ' } as any],
			});

			const msgs = ollamaCalls.chat.mock.calls[0][0].messages;
			// Only system + final user message; the empty-text entry is skipped
			const userMsgs = msgs.filter((m: any) => m.role === 'user');
			expect(userMsgs.length).toBe(1);
			expect(userMsgs[0].content).toBe('go');
		});

		it('maps "assistant" role in internal format to assistant', async () => {
			await client.generateModelResponse({
				prompt: '',
				userMessage: 'go',
				conversationHistory: [{ role: 'assistant', text: 'response' } as any],
			});

			const msgs = ollamaCalls.chat.mock.calls[0][0].messages;
			const assistantMsg = msgs.find((m: any) => m.role === 'assistant' && m.content === 'response');
			expect(assistantMsg).toBeDefined();
		});
	});

	describe('buildOptions() with maxOutputTokens', () => {
		it('maps maxOutputTokens to num_predict', async () => {
			const configWithMax: OllamaClientConfig = {
				...baseConfig,
				maxOutputTokens: 1024,
			};
			const c = new OllamaClient(configWithMax, undefined, buildPlugin());
			ollamaCalls.generate.mockResolvedValue({
				response: 'ok',
				prompt_eval_count: 1,
				eval_count: 1,
				done: true,
			});

			await c.generateModelResponse({ prompt: 'test' });

			expect(ollamaCalls.generate.mock.calls[0][0].options.num_predict).toBe(1024);
		});
	});

	describe('toUsageMetadata()', () => {
		it('returns only promptTokenCount when only promptTokens given', () => {
			const result = (client as any).toUsageMetadata(10, undefined);
			expect(result).toEqual({ promptTokenCount: 10 });
			expect(result.totalTokenCount).toBeUndefined();
		});

		it('returns only candidatesTokenCount when only candidateTokens given', () => {
			const result = (client as any).toUsageMetadata(undefined, 5);
			expect(result).toEqual({ candidatesTokenCount: 5 });
			expect(result.totalTokenCount).toBeUndefined();
		});

		it('returns all three fields when both are provided', () => {
			const result = (client as any).toUsageMetadata(10, 5);
			expect(result).toEqual({
				promptTokenCount: 10,
				candidatesTokenCount: 5,
				totalTokenCount: 15,
			});
		});

		it('returns undefined when both are undefined', () => {
			const result = (client as any).toUsageMetadata(undefined, undefined);
			expect(result).toBeUndefined();
		});
	});

	describe('toModelResponse() with thinking', () => {
		it('maps message.thinking to result.thoughts', () => {
			const response = {
				message: { role: 'assistant', content: 'answer', thinking: 'chain of thought' },
				prompt_eval_count: 1,
				eval_count: 1,
				done: true,
			};
			const result = (client as any).toModelResponse(response);
			expect(result.thoughts).toBe('chain of thought');
			expect(result.markdown).toBe('answer');
		});

		it('defaults gracefully when message is missing', () => {
			const response = {
				prompt_eval_count: 1,
				eval_count: 1,
				done: true,
			};
			const result = (client as any).toModelResponse(response);
			expect(result.markdown).toBe('');
			expect(result.thoughts).toBeUndefined();
		});
	});

	describe('streaming with BaseModelRequest (generate path)', () => {
		it('accumulates generate chunks and reports usageMetadata', async () => {
			async function* genStream() {
				yield { response: 'hel', done: false };
				yield { response: 'lo', done: false };
				yield { response: '!', done: true, prompt_eval_count: 7, eval_count: 3 };
			}
			const stream: any = genStream();
			stream.abort = vi.fn();
			ollamaCalls.generate.mockResolvedValue(stream);

			const chunks: string[] = [];
			const streaming = client.generateStreamingResponse({ prompt: 'hello' }, (chunk) => chunks.push(chunk.text));
			const result = await streaming.complete;

			expect(chunks.join('')).toBe('hello!');
			expect(result.markdown).toBe('hello!');
			expect(result.usageMetadata).toEqual({
				promptTokenCount: 7,
				candidatesTokenCount: 3,
				totalTokenCount: 10,
			});
		});
	});

	describe('streaming with tool calls and thinking', () => {
		it('accumulates tool calls from streaming chat chunks', async () => {
			async function* chatStream() {
				yield {
					message: {
						content: '',
						tool_calls: [{ function: { name: 'read_file', arguments: { path: 'a.md' } } }],
					},
					done: false,
				};
				yield { message: { content: '' }, done: true, prompt_eval_count: 2, eval_count: 1 };
			}
			const stream: any = chatStream();
			stream.abort = vi.fn();
			ollamaCalls.chat.mockResolvedValue(stream);

			const streaming = client.generateStreamingResponse(
				{ prompt: '', userMessage: 'hi', conversationHistory: [] },
				() => {}
			);
			const result = await streaming.complete;

			expect(result.toolCalls).toEqual([{ name: 'read_file', arguments: { path: 'a.md' } }]);
		});

		it('accumulates thinking from streaming chat chunks', async () => {
			async function* chatStream() {
				yield { message: { content: '', thinking: 'step 1' }, done: false };
				yield { message: { content: 'answer', thinking: ' step 2' }, done: true, prompt_eval_count: 1, eval_count: 1 };
			}
			const stream: any = chatStream();
			stream.abort = vi.fn();
			ollamaCalls.chat.mockResolvedValue(stream);

			const thoughts: string[] = [];
			const streaming = client.generateStreamingResponse(
				{ prompt: '', userMessage: 'think', conversationHistory: [] },
				(chunk) => {
					if (chunk.thought) thoughts.push(chunk.thought);
				}
			);
			const result = await streaming.complete;

			expect(result.thoughts).toBe('step 1 step 2');
			expect(result.markdown).toBe('answer');
			expect(thoughts).toEqual(['step 1', ' step 2']);
		});
	});

	describe('no model error', () => {
		it('generateModelResponse throws when no model configured', async () => {
			const c = new OllamaClient({ baseUrl: 'http://localhost:11434' }, undefined, buildPlugin());
			await expect(c.generateModelResponse({ prompt: 'test' })).rejects.toThrow('No Ollama model selected');
		});

		it('streaming throws when no model configured', async () => {
			const c = new OllamaClient({ baseUrl: 'http://localhost:11434' }, undefined, buildPlugin());
			const streaming = c.generateStreamingResponse(
				{ prompt: '', userMessage: 'hi', conversationHistory: [] },
				() => {}
			);
			await expect(streaming.complete).rejects.toThrow('No Ollama model selected');
		});
	});

	describe('streaming error propagation', () => {
		it('logs and re-throws errors when not cancelled', async () => {
			ollamaCalls.chat.mockRejectedValue(new Error('connection refused'));

			const streaming = client.generateStreamingResponse(
				{ prompt: '', userMessage: 'hi', conversationHistory: [] },
				() => {}
			);

			await expect(streaming.complete).rejects.toThrow('connection refused');
			expect(mockLogger.error).toHaveBeenCalledWith('[OllamaClient] Streaming error:', expect.any(Error));
		});
	});
});
