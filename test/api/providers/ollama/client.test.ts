import type { Mock } from 'vitest';
import { OllamaClient } from '../../../../src/api/providers/ollama/client';
import type { OllamaClientConfig } from '../../../../src/api/providers/ollama/config';
import { ExtendedModelRequest } from '../../../../src/api/interfaces/model-api';
import { proxyFetch } from '../../../../src/utils/proxy-fetch';

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
				kind: 'base',
				prompt: 'say hi',
			});

			expect(ollamaCalls.generate).toHaveBeenCalledTimes(1);
			const args = ollamaCalls.generate.mock.calls[0][0];
			expect(args.model).toBe('llama3.2');
			expect(args.prompt).toBe('say hi');
			expect(args.stream).toBe(false);

			expect(response.markdown).toBe('hello world');
			expect(response.usageMetadata).toEqual({
				promptTokenCount: 10,
				candidatesTokenCount: 4,
				totalTokenCount: 14,
			});
		});

		it('returns empty markdown when the generate response omits `response`', async () => {
			ollamaCalls.generate.mockResolvedValue({ done: true });

			const response = await client.generateModelResponse({
				kind: 'base',
				prompt: 'say hi',
			});

			expect(response.markdown).toBe('');
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
				kind: 'extended',
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
				kind: 'extended',
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
				kind: 'extended',
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
					kind: 'extended',
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
				{ prompt: '', userMessage: 'hi', kind: 'extended', conversationHistory: [] },
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
				{ prompt: '', userMessage: 'hi', kind: 'extended', conversationHistory: [] },
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
				{ prompt: '', userMessage: 'hi', kind: 'extended', conversationHistory: [] },
				() => {}
			);
			await new Promise((r) => window.setTimeout(r, 0));
			streaming.cancel();
			const result = await streaming.complete;

			expect(result.markdown).toBe('partial');
			expect(result.usageMetadata).toBeUndefined();
		});

		it('cancel() before the stream resolves aborts the stream once it arrives', async () => {
			// The Ollama SDK's requests take no signal, so the stream reference
			// doesn't exist until the await resolves — the window the post-hoc
			// abort closes. cancel() firing inside that window must still reach
			// the daemon via abort(), not just stop the flag-driven loop.
			const abort = vi.fn();
			let resolveStream: (s: unknown) => void = () => {};
			const gate = new Promise((r) => (resolveStream = r));
			ollamaCalls.chat.mockImplementation(() => gate);

			const streaming = client.generateStreamingResponse(
				{ prompt: '', userMessage: 'hi', kind: 'extended', conversationHistory: [] },
				() => {}
			);
			// cancel() while `start` is still awaiting the gate — the reference
			// does not exist yet.
			streaming.cancel();
			resolveStream({
				[Symbol.asyncIterator]: async function* () {
					yield { message: { content: 'late' }, done: false };
				},
				abort,
			});

			const result = await streaming.complete;

			expect(abort).toHaveBeenCalled();
			expect(result.markdown).toBe(''); // no chunk was consumed
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
				kind: 'extended',
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
				kind: 'extended',
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
				kind: 'extended',
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
				kind: 'extended',
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
				kind: 'extended',
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
				kind: 'extended',
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
					kind: 'extended',
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
				kind: 'extended',
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
				kind: 'extended',
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
				kind: 'extended',
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
				kind: 'extended',
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
				kind: 'extended',
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
				kind: 'extended',
				conversationHistory: [{ role: 'assistant', text: 'response' } as any],
			});

			const msgs = ollamaCalls.chat.mock.calls[0][0].messages;
			const assistantMsg = msgs.find((m: any) => m.role === 'assistant' && m.content === 'response');
			expect(assistantMsg).toBeDefined();
		});

		// The two assertions below pin the provider differences that the shared
		// history walker must NOT erase (#1373). They are the adapter-level
		// regression net for "observably identical per provider".

		it('emits tool responses BEFORE the assistant message (the inverse of OpenAI)', async () => {
			await client.generateModelResponse({
				prompt: '',
				userMessage: 'go',
				kind: 'extended',
				conversationHistory: [
					{
						role: 'model',
						parts: [
							{ functionCall: { name: 'read_file', args: {} } },
							{ functionResponse: { name: 'read_file', response: { content: 'data' } } },
						],
					},
				],
			});

			const msgs = ollamaCalls.chat.mock.calls[0][0].messages;
			const toolIdx = msgs.findIndex((m: any) => m.role === 'tool');
			const assistantIdx = msgs.findIndex((m: any) => m.role === 'assistant' && m.tool_calls?.length);
			expect(toolIdx).toBeGreaterThanOrEqual(0);
			expect(assistantIdx).toBeGreaterThanOrEqual(0);
			expect(toolIdx).toBeLessThan(assistantIdx);
		});

		it("leaves an empty assistant turn's content as '' (OpenAI coalesces to null)", async () => {
			await client.generateModelResponse({
				prompt: '',
				userMessage: 'go',
				kind: 'extended',
				conversationHistory: [{ role: 'model', parts: [{ text: '   ' }] }],
			});

			const msgs = ollamaCalls.chat.mock.calls[0][0].messages;
			const assistantMsg = msgs.find((m: any) => m.role === 'assistant');
			expect(assistantMsg).toBeDefined();
			expect(assistantMsg.content).toBe('');
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

			await c.generateModelResponse({ kind: 'base', prompt: 'test' });

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
			const streaming = client.generateStreamingResponse({ kind: 'base', prompt: 'hello' }, (chunk) =>
				chunks.push(chunk.text)
			);
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
				{ prompt: '', userMessage: 'hi', kind: 'extended', conversationHistory: [] },
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
				{ prompt: '', userMessage: 'think', kind: 'extended', conversationHistory: [] },
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
			await expect(c.generateModelResponse({ kind: 'base', prompt: 'test' })).rejects.toThrow(
				'No Ollama model selected'
			);
		});

		it('streaming throws when no model configured', async () => {
			const c = new OllamaClient({ baseUrl: 'http://localhost:11434' }, undefined, buildPlugin());
			const streaming = c.generateStreamingResponse(
				{ prompt: '', userMessage: 'hi', kind: 'extended', conversationHistory: [] },
				() => {}
			);
			await expect(streaming.complete).rejects.toThrow('No Ollama model selected');
		});
	});

	describe('streaming error propagation', () => {
		it('logs and re-throws errors when not cancelled', async () => {
			ollamaCalls.chat.mockRejectedValue(new Error('connection refused'));

			const streaming = client.generateStreamingResponse(
				{ prompt: '', userMessage: 'hi', kind: 'extended', conversationHistory: [] },
				() => {}
			);

			await expect(streaming.complete).rejects.toThrow('connection refused');
			expect(mockLogger.error).toHaveBeenCalledWith('[OllamaClient] Streaming error:', expect.any(Error));
		});
	});
});

/** Sends one simple request so the client builds its (lazily created) SDK client. */
async function sendOnce(client: OllamaClient): Promise<void> {
	ollamaCalls.generate.mockResolvedValue({ response: 'ok' });
	await client.generateModelResponse({ prompt: 'hi' } as any);
}

describe('OllamaClient auth headers (#1764)', () => {
	it('passes a bearer token to ollama-js when an API key is configured', async () => {
		const { Ollama } = await import('ollama/browser');
		(Ollama as unknown as Mock).mockClear();
		await sendOnce(new OllamaClient({ baseUrl: 'https://ollama.com', apiKey: 'secret', model: 'gpt-oss:120b' }));
		expect(Ollama).toHaveBeenCalledWith({
			host: 'https://ollama.com',
			headers: { Authorization: 'Bearer secret' },
			fetch: proxyFetch,
		});
	});

	it('sends no auth header for a keyless local daemon', async () => {
		const { Ollama } = await import('ollama/browser');
		(Ollama as unknown as Mock).mockClear();
		await sendOnce(new OllamaClient({ baseUrl: 'http://localhost:11434', model: 'llama3.2' }));
		expect(Ollama).toHaveBeenCalledWith({ host: 'http://localhost:11434', headers: {} });
	});
});

describe('OllamaClient transport (#1785)', () => {
	it('builds the cloud client on the requestUrl-backed fetch, since ollama.com rejects CORS', async () => {
		const { Ollama } = await import('ollama/browser');
		(Ollama as unknown as Mock).mockClear();
		await sendOnce(
			new OllamaClient({ baseUrl: 'http://localhost:11434', apiKey: 'secret', model: 'cloud::gpt-oss:120b' })
		);
		const [config] = (Ollama as unknown as Mock).mock.calls[0];
		expect(config.host).toBe('https://ollama.com');
		expect(config.fetch).toBe(proxyFetch);
	});

	it('keeps the browser fetch for a local daemon so replies still stream', async () => {
		const { Ollama } = await import('ollama/browser');
		(Ollama as unknown as Mock).mockClear();
		await sendOnce(new OllamaClient({ baseUrl: 'http://localhost:11434', apiKey: 'secret', model: 'llama3.2' }));
		const [config] = (Ollama as unknown as Mock).mock.calls[0];
		expect(config.host).toBe('http://localhost:11434');
		expect(config).not.toHaveProperty('fetch');
	});

	it('uses the requestUrl-backed fetch for a cloud-only endpoint', async () => {
		const { Ollama } = await import('ollama/browser');
		(Ollama as unknown as Mock).mockClear();
		await sendOnce(new OllamaClient({ baseUrl: 'https://ollama.com', apiKey: 'secret', model: 'gpt-oss:120b' }));
		expect((Ollama as unknown as Mock).mock.calls[0][0].fetch).toBe(proxyFetch);
	});
});

describe('OllamaClient cancel while the request is outstanding (#1785)', () => {
	it('settles complete on cancel and aborts the stream once it arrives late', async () => {
		let resolveChat!: (value: unknown) => void;
		ollamaCalls.chat.mockReset();
		ollamaCalls.chat.mockReturnValue(new Promise((resolve) => (resolveChat = resolve)));
		const client = new OllamaClient(
			{ baseUrl: 'http://localhost:11434', apiKey: 'secret', model: 'cloud::gpt-oss:120b' },
			undefined,
			buildPlugin()
		);
		const stream = client.generateStreamingResponse(
			{ kind: 'extended', userMessage: 'hi', conversationHistory: [] } as any,
			() => {}
		);
		await vi.waitFor(() => expect(ollamaCalls.chat).toHaveBeenCalled());

		stream.cancel();
		await expect(stream.complete).resolves.toMatchObject({ markdown: '' });

		const lateAbort = vi.fn();
		resolveChat({ abort: lateAbort, async *[Symbol.asyncIterator]() {} });
		await vi.waitFor(() => expect(lateAbort).toHaveBeenCalled());
	});
});

describe('OllamaClient routing local and cloud models', () => {
	it('sends a cloud-prefixed model to ollama.com under its bare name', async () => {
		const { Ollama } = await import('ollama/browser');
		(Ollama as unknown as Mock).mockClear();
		ollamaCalls.generate.mockReset();
		await sendOnce(
			new OllamaClient({ baseUrl: 'http://localhost:11434', apiKey: 'secret', model: 'cloud::gpt-oss:120b' })
		);
		expect(Ollama).toHaveBeenCalledTimes(1);
		expect(Ollama).toHaveBeenCalledWith({
			host: 'https://ollama.com',
			headers: { Authorization: 'Bearer secret' },
			fetch: proxyFetch,
		});
		expect(ollamaCalls.generate).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-oss:120b' }));
	});

	it('sends a plain model to the configured base URL', async () => {
		const { Ollama } = await import('ollama/browser');
		(Ollama as unknown as Mock).mockClear();
		ollamaCalls.generate.mockReset();
		await sendOnce(new OllamaClient({ baseUrl: 'http://localhost:11434', apiKey: 'secret', model: 'gpt-oss:120b' }));
		expect(Ollama).toHaveBeenCalledWith({
			host: 'http://localhost:11434',
			headers: { Authorization: 'Bearer secret' },
		});
		expect(ollamaCalls.generate).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-oss:120b' }));
	});

	it('routes per request, reusing one SDK client per endpoint', async () => {
		const { Ollama } = await import('ollama/browser');
		(Ollama as unknown as Mock).mockClear();
		ollamaCalls.generate.mockReset().mockResolvedValue({ response: 'ok' });
		const client = new OllamaClient({ baseUrl: 'http://localhost:11434', apiKey: 'secret' });
		await client.generateModelResponse({ prompt: 'a', model: 'llama3.2' } as any);
		await client.generateModelResponse({ prompt: 'b', model: 'cloud::gpt-oss:120b' } as any);
		await client.generateModelResponse({ prompt: 'c', model: 'llama3.2' } as any);
		expect((Ollama as unknown as Mock).mock.calls.map(([opts]) => opts.host)).toEqual([
			'http://localhost:11434',
			'https://ollama.com',
		]);
		expect(ollamaCalls.generate.mock.calls.map(([req]) => req.model)).toEqual(['llama3.2', 'gpt-oss:120b', 'llama3.2']);
	});

	it('refuses a cloud-prefixed model when no key is configured', async () => {
		ollamaCalls.generate.mockReset();
		const client = new OllamaClient({ baseUrl: 'http://localhost:11434', model: 'cloud::gpt-oss:120b' });
		await expect(client.generateModelResponse({ prompt: 'hi' } as any)).rejects.toThrow(/API key/);
		expect(ollamaCalls.generate).not.toHaveBeenCalled();
	});

	it('routes the same model name to separate SDK clients across chat and streaming requests', async () => {
		const { Ollama } = await import('ollama/browser');
		const local = {
			chat: vi.fn().mockResolvedValue({ message: { content: 'local chat' } }),
			generate: vi.fn(),
		};
		const cloud = {
			chat: vi.fn(),
			generate: vi.fn().mockResolvedValue({ response: 'cloud generate' }),
		};
		async function* cloudChat() {
			yield { message: { content: 'cloud stream' }, done: true };
		}
		async function* localGenerate() {
			yield { response: 'local stream', done: true };
		}
		cloud.chat.mockResolvedValue(Object.assign(cloudChat(), { abort: vi.fn() }));
		local.generate.mockResolvedValue(Object.assign(localGenerate(), { abort: vi.fn() }));
		const constructor = (Ollama as unknown as Mock).mockClear();
		constructor.mockImplementationOnce(function () {
			return local;
		});
		constructor.mockImplementationOnce(function () {
			return cloud;
		});

		const client = new OllamaClient({ ...baseConfig, apiKey: 'secret' }, undefined, buildPlugin());
		const chatRequest: ExtendedModelRequest = {
			kind: 'extended',
			prompt: '',
			userMessage: 'hi',
			conversationHistory: [],
			model: 'llama3.2',
		};
		const localChat = await client.generateModelResponse(chatRequest);
		const cloudStream = client.generateStreamingResponse({ ...chatRequest, model: 'cloud::llama3.2' }, vi.fn());
		const localStream = client.generateStreamingResponse({ kind: 'base', prompt: 'hi' }, vi.fn());
		const cloudGenerate = await client.generateModelResponse({
			kind: 'base',
			prompt: 'hi',
			model: 'cloud::llama3.2',
		});

		expect(localChat.markdown).toBe('local chat');
		expect(cloudGenerate.markdown).toBe('cloud generate');
		await expect(cloudStream.complete).resolves.toMatchObject({ markdown: 'cloud stream' });
		await expect(localStream.complete).resolves.toMatchObject({ markdown: 'local stream' });
		expect(constructor.mock.calls.map(([options]) => options.host)).toEqual([
			'http://localhost:11434',
			'https://ollama.com',
		]);
		expect(local.chat).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ model: 'llama3.2', stream: false }));
		expect(cloud.chat).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ model: 'llama3.2', stream: true }));
		expect(local.generate).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ model: 'llama3.2', stream: true })
		);
		expect(cloud.generate).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ model: 'llama3.2', stream: false })
		);
	});

	it('rejects a keyless cloud stream before sending the request without blocking local streaming', async () => {
		ollamaCalls.generate.mockReset();
		const client = new OllamaClient(baseConfig);
		const request = { kind: 'base', prompt: 'hi' } as const;
		const cloud = client.generateStreamingResponse({ ...request, model: 'cloud::llama3.2' }, vi.fn());
		await expect(cloud.complete).rejects.toThrow(/API key/);
		expect(ollamaCalls.generate).not.toHaveBeenCalled();

		async function* localGenerate() {
			yield { response: 'local stream', done: true };
		}
		ollamaCalls.generate.mockResolvedValue(Object.assign(localGenerate(), { abort: vi.fn() }));
		await expect(client.generateStreamingResponse(request, vi.fn()).complete).resolves.toMatchObject({
			markdown: 'local stream',
		});
	});
});

describe('OllamaClient Ollama Cloud guards (#1764)', () => {
	it('withholds the key over plain HTTP to a non-loopback host', async () => {
		const { Ollama } = await import('ollama/browser');
		(Ollama as unknown as Mock).mockClear();
		await sendOnce(new OllamaClient({ baseUrl: 'http://192.168.1.20:11434', apiKey: 'secret', model: 'llama3.2' }));
		expect(Ollama).toHaveBeenCalledWith({ host: 'http://192.168.1.20:11434', headers: {} });
		(Ollama as unknown as Mock).mockClear();
		await sendOnce(new OllamaClient({ baseUrl: 'http://localhost:11434', apiKey: 'secret', model: 'llama3.2' }));
		expect(Ollama).toHaveBeenCalledWith({
			host: 'http://localhost:11434',
			headers: { Authorization: 'Bearer secret' },
		});
	});

	it('refuses to send a keyless request to ollama.com', async () => {
		ollamaCalls.generate.mockReset();
		const client = new OllamaClient({ baseUrl: 'https://ollama.com', model: 'gpt-oss:120b' });
		await expect(client.generateModelResponse({ prompt: 'hi' } as any)).rejects.toThrow(/API key/);
		expect(ollamaCalls.generate).not.toHaveBeenCalled();
	});
});
