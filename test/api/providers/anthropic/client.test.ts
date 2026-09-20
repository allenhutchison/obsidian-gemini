import type { Mock } from 'vitest';
import { AnthropicClient } from '../../../../src/api/providers/anthropic/client';
import { buildFunctionCallParts, buildToolHistoryTurns } from '../../../../src/agent/agent-loop-helpers';
import type { ExtendedModelRequest } from '../../../../src/api/interfaces/model-api';

const { anthropicCalls } = vi.hoisted(() => {
	const anthropicCalls: { create: Mock; stream: Mock; constructorOpts: unknown } = {
		create: vi.fn(),
		stream: vi.fn(),
		constructorOpts: undefined,
	};
	return { anthropicCalls };
});

vi.mock('@anthropic-ai/sdk', () => ({
	// Function syntax so `new Anthropic()` is constructable under vitest.
	default: vi.fn().mockImplementation(function (this: any, opts: any) {
		anthropicCalls.constructorOpts = opts;
		this.beta = {
			messages: {
				create: (...args: any[]) => anthropicCalls.create(...args),
				stream: (...args: any[]) => anthropicCalls.stream(...args),
			},
		};
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

function message(overrides: Record<string, unknown> = {}) {
	return {
		id: 'msg_1',
		type: 'message',
		role: 'assistant',
		model: 'claude-opus-5',
		content: [{ type: 'text', text: 'hello' }],
		stop_reason: 'end_turn',
		stop_details: null,
		usage: { input_tokens: 10, output_tokens: 4, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
		...overrides,
	};
}

/** A stand-in for the SDK's MessageStream: async-iterable events plus `finalMessage()`. */
function fakeStream(events: any[], final: any) {
	return {
		async *[Symbol.asyncIterator]() {
			for (const event of events) yield event;
		},
		finalMessage: vi.fn(async () => final),
	};
}

const extended = (overrides: Partial<ExtendedModelRequest> = {}): ExtendedModelRequest => ({
	kind: 'extended',
	prompt: '',
	userMessage: 'hi there',
	conversationHistory: [],
	...overrides,
});

describe('AnthropicClient', () => {
	beforeEach(() => {
		anthropicCalls.create.mockReset();
		anthropicCalls.stream.mockReset();
		mockLogger.warn.mockReset();
		mockLogger.error.mockReset();
	});

	const client = (model = 'claude-opus-5') =>
		new AnthropicClient({ apiKey: 'sk-ant-test', model }, undefined, buildPlugin());

	it('constructs the SDK for a renderer process with SDK retries off', () => {
		client();
		expect(anthropicCalls.constructorOpts).toEqual({
			apiKey: 'sk-ant-test',
			dangerouslyAllowBrowser: true,
			maxRetries: 0,
		});
	});

	it('throws when no model is configured', async () => {
		await expect(client('').generateModelResponse({ kind: 'base', prompt: 'x' })).rejects.toThrow(
			'No Anthropic model selected'
		);
	});

	describe('request shaping', () => {
		it('sends a base prompt as one user message with caching, adaptive thinking, and fallbacks on Opus 5', async () => {
			anthropicCalls.create.mockResolvedValue(message());
			const response = await client().generateModelResponse({ kind: 'base', prompt: 'say hi' });

			const args = anthropicCalls.create.mock.calls[0][0];
			expect(args).toMatchObject({
				model: 'claude-opus-5',
				max_tokens: 16000,
				stream: false,
				messages: [{ role: 'user', content: 'say hi' }],
				cache_control: { type: 'ephemeral' },
				thinking: { type: 'adaptive', display: 'summarized' },
				betas: ['server-side-fallback-2026-07-01'],
				fallbacks: 'default',
			});
			expect(args).not.toHaveProperty('temperature');
			expect(response.markdown).toBe('hello');
		});

		it('omits thinking and fallbacks on Haiku 4.5 and on ids outside the catalog', async () => {
			anthropicCalls.create.mockResolvedValue(message());
			for (const model of ['claude-haiku-4-5', 'claude-3-opus']) {
				await client(model).generateModelResponse({ kind: 'base', prompt: 'x' });
			}
			for (const [args] of anthropicCalls.create.mock.calls) {
				expect(args).not.toHaveProperty('thinking');
				expect(args).not.toHaveProperty('betas');
				expect(args).not.toHaveProperty('fallbacks');
			}
		});

		it('uses adaptive thinking without fallbacks on Sonnet 5', async () => {
			anthropicCalls.create.mockResolvedValue(message());
			await client('claude-sonnet-5').generateModelResponse({ kind: 'base', prompt: 'x' });
			const args = anthropicCalls.create.mock.calls[0][0];
			expect(args.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
			expect(args).not.toHaveProperty('fallbacks');
		});

		it('builds system, history, tools, and the final user turn for an extended request', async () => {
			anthropicCalls.create.mockResolvedValue(message());
			await client().generateModelResponse(
				extended({
					perTurnContext: 'context files: a.md',
					conversationHistory: [
						{ role: 'user', parts: [{ text: 'earlier question' }] },
						{ role: 'model', parts: [{ text: 'earlier answer' }] },
					],
					availableTools: [
						{
							name: 'read_file',
							description: 'reads a file',
							parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
						},
					],
				})
			);

			const args = anthropicCalls.create.mock.calls[0][0];
			expect(typeof args.system).toBe('string');
			expect(args.system.length).toBeGreaterThan(0);
			expect(args.messages).toEqual([
				{ role: 'user', content: [{ type: 'text', text: 'earlier question' }] },
				{ role: 'assistant', content: [{ type: 'text', text: 'earlier answer' }] },
				{
					role: 'user',
					content: [
						{ type: 'text', text: 'hi there' },
						{ type: 'text', text: 'context files: a.md' },
					],
				},
			]);
			expect(args.tools).toEqual([
				{
					name: 'read_file',
					description: 'reads a file',
					input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
				},
			]);
		});

		it('sends image and PDF attachments ahead of the text, and rejects audio', async () => {
			anthropicCalls.create.mockResolvedValue(message());
			await client().generateModelResponse(
				extended({
					inlineAttachments: [
						{ mimeType: 'image/png', base64: 'aW1n' },
						{ mimeType: 'application/pdf', base64: 'cGRm' },
					],
				})
			);
			expect(anthropicCalls.create.mock.calls[0][0].messages[0].content).toEqual([
				{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW1n' } },
				{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'cGRm' } },
				{ type: 'text', text: 'hi there' },
			]);

			await expect(
				client().generateModelResponse(extended({ inlineAttachments: [{ mimeType: 'audio/mp3', base64: 'x' }] }))
			).rejects.toThrow('only supports image and PDF attachments');
		});

		it('opens with a placeholder user turn when history starts with the assistant', async () => {
			anthropicCalls.create.mockResolvedValue(message());
			await client().generateModelResponse(
				extended({ conversationHistory: [{ role: 'model', parts: [{ text: 'summary so far' }] }] })
			);
			const { messages } = anthropicCalls.create.mock.calls[0][0];
			expect(messages[0].role).toBe('user');
			expect(messages[1]).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'summary so far' }] });
		});
	});

	describe('response mapping', () => {
		it('maps text, thinking, tool calls, and cache-aware usage', async () => {
			anthropicCalls.create.mockResolvedValue(
				message({
					stop_reason: 'tool_use',
					content: [
						{ type: 'thinking', thinking: 'I should read it.', signature: 'sig-1' },
						{ type: 'text', text: 'Reading.' },
						{ type: 'tool_use', id: 'toolu_01', name: 'read_file', input: { path: 'a.md' } },
					],
					usage: { input_tokens: 5, output_tokens: 7, cache_creation_input_tokens: 20, cache_read_input_tokens: 100 },
				})
			);
			const response = await client().generateModelResponse(extended());

			expect(response.markdown).toBe('Reading.');
			expect(response.thoughts).toBe('I should read it.');
			expect(response.toolCalls).toHaveLength(1);
			expect(response.toolCalls?.[0]).toMatchObject({
				id: 'toolu_01',
				name: 'read_file',
				arguments: { path: 'a.md' },
			});
			expect(response.toolCalls?.[0].thoughtSignature).toMatch(/^anthropic-thinking:/);
			expect(response.usageMetadata).toEqual({
				promptTokenCount: 125,
				candidatesTokenCount: 7,
				totalTokenCount: 132,
				cachedContentTokenCount: 100,
			});
		});

		it('throws on a refusal instead of returning an empty answer', async () => {
			anthropicCalls.create.mockResolvedValue(
				message({
					content: [],
					stop_reason: 'refusal',
					stop_details: { type: 'refusal', category: 'cyber', explanation: null },
				})
			);
			await expect(client().generateModelResponse(extended())).rejects.toThrow(
				'Claude declined to respond to this request (cyber).'
			);
		});

		it('drops tool calls from a response cut off by max_tokens', async () => {
			anthropicCalls.create.mockResolvedValue(
				message({
					stop_reason: 'max_tokens',
					content: [{ type: 'tool_use', id: 'toolu_01', name: 'write_file', input: { path: 'a' } }],
				})
			);
			const response = await client().generateModelResponse(extended());
			expect(response.toolCalls).toBeUndefined();
			expect(mockLogger.warn).toHaveBeenCalled();
		});

		it('logs and rethrows API errors', async () => {
			const error = Object.assign(new Error('bad key'), { status: 401, type: 'authentication_error' });
			anthropicCalls.create.mockRejectedValue(error);
			await expect(client().generateModelResponse(extended())).rejects.toBe(error);
			expect(mockLogger.error.mock.calls[0][1]).toBe('HTTP 401 [authentication_error]: bad key');
		});
	});

	describe('tool-round history', () => {
		it('replays thinking blocks before tool_use and pairs tool_result ids', async () => {
			anthropicCalls.create.mockResolvedValueOnce(
				message({
					stop_reason: 'tool_use',
					content: [
						{ type: 'thinking', thinking: 'plan', signature: 'sig-1' },
						{ type: 'redacted_thinking', data: 'opaque' },
						{ type: 'tool_use', id: 'toolu_01', name: 'read_file', input: { path: 'a.md' } },
						{ type: 'tool_use', id: 'toolu_02', name: 'read_file', input: { path: 'b.md' } },
					],
				})
			);
			const first = await client().generateModelResponse(extended());

			// Rebuild history exactly as AgentLoop does.
			const history = buildToolHistoryTurns({
				conversationHistory: [],
				userMessage: 'hi there',
				toolCalls: first.toolCalls!,
				toolResults: first.toolCalls!.map((call, sourceIndex) => ({
					toolName: call.name,
					toolArguments: call.arguments,
					id: call.id,
					sourceIndex,
					result: call.arguments.path === 'b.md' ? { success: false, error: 'missing' } : { success: true, data: 'A' },
				})),
			});

			anthropicCalls.create.mockResolvedValueOnce(message());
			await client().generateModelResponse(extended({ userMessage: '', conversationHistory: history }));

			const { messages } = anthropicCalls.create.mock.calls[1][0];
			expect(messages).toEqual([
				{ role: 'user', content: [{ type: 'text', text: 'hi there' }] },
				{
					role: 'assistant',
					content: [
						{ type: 'thinking', thinking: 'plan', signature: 'sig-1' },
						{ type: 'redacted_thinking', data: 'opaque' },
						{ type: 'tool_use', id: 'toolu_01', name: 'read_file', input: { path: 'a.md' } },
						{ type: 'tool_use', id: 'toolu_02', name: 'read_file', input: { path: 'b.md' } },
					],
				},
				{
					role: 'user',
					content: [
						{ type: 'tool_result', tool_use_id: 'toolu_01', content: '{"success":true,"data":"A"}' },
						{
							type: 'tool_result',
							tool_use_id: 'toolu_02',
							content: '{"success":false,"error":"missing"}',
							is_error: true,
						},
					],
				},
			]);
		});

		it('ignores a non-Anthropic thoughtSignature and mints ids for id-less calls', async () => {
			anthropicCalls.create.mockResolvedValue(message());
			const history = [
				{
					role: 'model',
					parts: buildFunctionCallParts([{ name: 'list_files', arguments: {}, thoughtSignature: 'gemini-sig' }]),
				},
				{ role: 'user', parts: [{ functionResponse: { name: 'list_files', response: { success: true } } }] },
			];
			await client().generateModelResponse(extended({ conversationHistory: history }));

			const { messages } = anthropicCalls.create.mock.calls[0][0];
			const assistant = messages.find((m: any) => m.role === 'assistant');
			expect(assistant.content).toEqual([{ type: 'tool_use', id: 'toolu_0', name: 'list_files', input: {} }]);
			expect(messages[2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_0' });
		});

		it('drops a tool_result whose tool_use was compacted away', async () => {
			anthropicCalls.create.mockResolvedValue(message());
			await client().generateModelResponse(
				extended({
					conversationHistory: [
						{
							role: 'user',
							parts: [
								{ functionResponse: { name: 'read_file', response: { success: true }, id: 'toolu_gone' } },
								{ text: 'follow-up' },
							],
						},
					],
				})
			);
			const { messages } = anthropicCalls.create.mock.calls[0][0];
			expect(messages[0]).toEqual({ role: 'user', content: [{ type: 'text', text: 'follow-up' }] });
		});

		it('carries PDF parts from history as document blocks', async () => {
			anthropicCalls.create.mockResolvedValue(message());
			await client().generateModelResponse(
				extended({
					conversationHistory: [
						{ role: 'user', parts: [{ inlineData: { mimeType: 'application/pdf', data: 'cGRm' } }, { text: 'see' }] },
					],
				})
			);
			expect(anthropicCalls.create.mock.calls[0][0].messages[0].content).toEqual([
				{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'cGRm' } },
				{ type: 'text', text: 'see' },
			]);
		});
	});

	describe('generateStreamingResponse', () => {
		it('forwards text and thinking deltas and resolves with the final message', async () => {
			const final = message({
				content: [
					{ type: 'thinking', thinking: 'hmm', signature: 's' },
					{ type: 'text', text: 'Hello!' },
				],
			});
			anthropicCalls.stream.mockReturnValue(
				fakeStream(
					[
						{ type: 'message_start' },
						{ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } },
						{ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hello' } },
						{ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '!' } },
					],
					final
				)
			);

			const chunks: any[] = [];
			const response = await client().generateStreamingResponse(extended(), (chunk) => chunks.push(chunk)).complete;

			const [params, options] = anthropicCalls.stream.mock.calls[0];
			expect(params.max_tokens).toBe(64000);
			expect(params).not.toHaveProperty('stream');
			expect(options.signal).toBeInstanceOf(AbortSignal);
			expect(chunks).toEqual([{ text: '', thought: 'hmm' }, { text: 'Hello' }, { text: '!' }]);
			expect(response.markdown).toBe('Hello!');
			expect(response.thoughts).toBe('hmm');
		});

		it('returns the partial text when cancelled mid-stream', async () => {
			let release!: () => void;
			const gate = new Promise<void>((resolve) => (release = resolve));
			anthropicCalls.stream.mockImplementation((_params: unknown, { signal }: { signal: AbortSignal }) => ({
				async *[Symbol.asyncIterator]() {
					yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'partial' } };
					await gate;
					if (signal.aborted) throw new Error('Request was aborted.');
				},
				finalMessage: vi.fn(),
			}));

			const streaming = client().generateStreamingResponse(extended(), () => {});
			await vi.waitFor(() => expect(anthropicCalls.stream).toHaveBeenCalled());
			await new Promise((resolve) => window.setTimeout(resolve, 0));
			streaming.cancel();
			release();

			const response = await streaming.complete;
			expect(response.markdown).toBe('partial');
			expect(mockLogger.error).not.toHaveBeenCalled();
		});

		it('cancel() aborts the signal threaded into messages.stream', async () => {
			// The openai/client.test.ts pattern: the signal the client passes to
			// the SDK must be the helper's own — assert it is observed aborted at
			// the SDK boundary, so a regression that drops the threading fails
			// here rather than silently degrading Stop to flag-only.
			let captured!: AbortSignal;
			let release!: () => void;
			const gate = new Promise<void>((resolve) => (release = resolve));
			anthropicCalls.stream.mockImplementation((_params: unknown, { signal }: { signal: AbortSignal }) => {
				captured = signal;
				return {
					// eslint-disable-next-line require-yield -- blocks until cancelled, like a stalled read
					async *[Symbol.asyncIterator]() {
						await gate;
					},
					finalMessage: vi.fn(),
				};
			});

			const streaming = client().generateStreamingResponse(extended(), () => {});
			await vi.waitFor(() => expect(anthropicCalls.stream).toHaveBeenCalled());
			expect(captured).toBeInstanceOf(AbortSignal);
			expect(captured.aborted).toBe(false);

			streaming.cancel();
			release();

			await streaming.complete;
			expect(captured.aborted).toBe(true);
		});

		it('does not create the SDK stream when cancel() lands during buildParams', async () => {
			// Pre-migration behavior: `if (cancelled) return partialResult()`
			// sat between buildParams and stream creation. The helper checks
			// cancellation only after start resolves, so the client guards
			// with throwIfAborted — otherwise the SDK's request path starts
			// even with an already-aborted signal.
			let releaseParams!: () => void;
			const paramsGate = new Promise<void>((resolve) => (releaseParams = resolve));
			const buildParamsSpy = vi.spyOn(AnthropicClient.prototype, 'buildParams' as never) as any;
			buildParamsSpy.mockImplementation(() =>
				paramsGate.then(
					() =>
						// minimal params shape; the real impl is bypassed
						({ model: 'claude-opus-5', max_tokens: 64000, messages: [] }) as any
				)
			);

			const streaming = client().generateStreamingResponse(extended(), () => {});
			await vi.waitFor(() => expect(buildParamsSpy).toHaveBeenCalled());
			streaming.cancel(); // cancel while buildParams is pending
			releaseParams();

			await streaming.complete;
			expect(anthropicCalls.stream).not.toHaveBeenCalled();
			buildParamsSpy.mockRestore();
		});

		it('returns the partial when cancel() races the finalMessage aggregate', async () => {
			// The iterable finishes cleanly, but finalMessage() is still in
			// flight when cancel() lands — the SDK's aggregate rejects on
			// abort. The cancelled stream must resolve to the partial, never
			// reject.
			let releaseIterable!: () => void;
			const iterableGate = new Promise<void>((resolve) => (releaseIterable = resolve));
			let releaseFinal!: () => void;
			const finalGate = new Promise<void>((resolve) => (releaseFinal = resolve));
			anthropicCalls.stream.mockImplementation((_params: unknown, { signal }: { signal: AbortSignal }) => ({
				async *[Symbol.asyncIterator]() {
					yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'kept' } };
					await iterableGate;
				},
				finalMessage: vi.fn(async () => {
					await finalGate;
					if (signal.aborted) throw new Error('Request was aborted.');
					return { content: [{ type: 'text', text: 'final' }], usage: {} };
				}),
			}));

			const streaming = client().generateStreamingResponse(extended(), () => {});
			await vi.waitFor(() => expect(anthropicCalls.stream).toHaveBeenCalled());
			releaseIterable(); // iterable ends -> finalize -> finalMessage blocks on finalGate
			await new Promise((r) => window.setTimeout(r, 0));
			streaming.cancel(); // cancel while finalMessage is in flight
			releaseFinal();

			const response = await streaming.complete;
			expect(response.markdown).toBe('kept');
			expect(response).not.toHaveProperty('thoughts');
		});

		it('rejects with the stream error when not cancelled', async () => {
			anthropicCalls.stream.mockReturnValue({
				// eslint-disable-next-line require-yield -- throws before yielding, like a failed request
				async *[Symbol.asyncIterator]() {
					throw new Error('overloaded');
				},
				finalMessage: vi.fn(),
			});
			await expect(client().generateStreamingResponse(extended(), () => {}).complete).rejects.toThrow('overloaded');
		});
	});
});
