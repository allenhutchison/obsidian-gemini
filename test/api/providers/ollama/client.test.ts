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
		it('embeds perTurnContext into the system message under "## Turn Context"', async () => {
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
			const systemMessage = args.messages.find((m: any) => m.role === 'system');
			expect(systemMessage).toBeDefined();
			expect(systemMessage.content).toContain('## Turn Context');
			expect(systemMessage.content).toContain('The quick brown fox jumps over the lazy dog.');
			expect(systemMessage.content).toContain('always cite file paths');
			expect(systemMessage.content).toContain('2026-05-09T10:00:00');
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
			await new Promise((r) => setTimeout(r, 0));
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
			await new Promise((r) => setTimeout(r, 0));
			streaming.cancel();
			const result = await streaming.complete;

			expect(result.markdown).toBe('partial');
			expect(result.usageMetadata).toBeUndefined();
		});
	});
});
