import type { Mock } from 'vitest';
import { AgentLoop } from '../../src/agent/agent-loop';
import type { ToolCall, ModelResponse, ModelApi } from '../../src/api/interfaces/model-api';
import type { IConfirmationProvider } from '../../src/tools/types';

// None of these tests exercise the confirmation UI branch (enabledTools/requireConfirmation
// are empty, so no tool requires confirmation) — the loop only needs *some* provider to
// hand through to the engine. A noop stub is fine.
const confirmationProvider: IConfirmationProvider = {
	showConfirmationInChat: vi.fn().mockResolvedValue({ confirmed: false, allowWithoutConfirmation: false }),
	isToolAllowedWithoutConfirmation: vi.fn().mockReturnValue(false),
	allowToolWithoutConfirmation: vi.fn(),
};

// Build a minimal plugin stub with just enough surface for AgentLoop and the
// followup helpers to walk through. Each test customises only what it cares about.
function buildPlugin(overrides: any = {}) {
	const toolRegistry = {
		getTool: vi.fn().mockImplementation(function (name: string) {
			return {
				name,
				displayName: name,
			};
		}),
		getEnabledTools: vi.fn().mockReturnValue([]),
		...overrides.toolRegistry,
	};

	const toolExecutionEngine = {
		executeTool: vi
			.fn()
			.mockImplementation((tc: ToolCall) => Promise.resolve({ success: true, data: { tool: tc.name } })),
		...overrides.toolExecutionEngine,
	};

	const agentEventBus = { emit: vi.fn().mockResolvedValue(undefined), ...overrides.agentEventBus };

	const logger = { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), ...overrides.logger };

	const settings = {
		chatModelName: 'gemini-test',
		temperature: 0.5,
		topP: 0.9,
		...overrides.settings,
	};

	const sessionHistory = { addEntryToSession: vi.fn().mockResolvedValue(undefined), ...overrides.sessionHistory };

	return {
		toolRegistry,
		toolExecutionEngine,
		agentEventBus,
		logger,
		settings,
		sessionHistory,
		...overrides,
	} as any;
}

function buildSession(): any {
	return {
		id: 'test-session',
		type: 'agent-session',
		modelConfig: {},
		context: { contextFiles: [], contextDepth: 0, enabledTools: [], requireConfirmation: [] },
	};
}

// A model API stub that returns a queued sequence of responses for each
// generateModelResponse call. Lets tests script multi-iteration loops.
function makeScriptedModelApi(responses: ModelResponse[]): ModelApi & { calls: number } {
	let calls = 0;
	const api = {
		get calls() {
			return calls;
		},
		generateModelResponse: vi.fn().mockImplementation(() => {
			const next = responses[calls];
			calls++;
			if (!next) throw new Error(`Scripted model API ran out of responses at call ${calls}`);
			return Promise.resolve(next);
		}),
	} as any;
	return api;
}

const tc = (name: string, args: Record<string, any> = {}, extra: Partial<ToolCall> = {}): ToolCall => ({
	name,
	arguments: args,
	...extra,
});

const textResponse = (markdown: string): ModelResponse => ({ markdown, rendered: '' });
const toolResponse = (toolCalls: ToolCall[]): ModelResponse => ({ markdown: '', rendered: '', toolCalls });

describe('AgentLoop', () => {
	describe('happy path', () => {
		test('single batch followed by terminal text response', async () => {
			const plugin = buildPlugin();
			const session = buildSession();
			const api = makeScriptedModelApi([textResponse('all done')]);

			const loop = new AgentLoop();
			const result = await loop.run({
				initialResponse: toolResponse([tc('read_file', { path: 'a.md' })]),
				initialUserMessage: 'do the thing',
				initialHistory: [],
				options: {
					plugin,
					session,
					confirmationProvider,
					isCancelled: () => false,
					createModelApi: () => api,
				},
			});

			expect(result.cancelled).toBe(false);
			expect(result.fellBack).toBe(false);
			expect(result.exhausted).toBe(false);
			expect(result.markdown).toBe('all done');
			expect(result.iterations).toBe(1);
			expect(plugin.toolExecutionEngine.executeTool).toHaveBeenCalledTimes(1);
			expect(api.calls).toBe(1);
		});

		test('multi-iteration: tools → more tools → text', async () => {
			const plugin = buildPlugin();
			const session = buildSession();
			const api = makeScriptedModelApi([
				toolResponse([tc('write_file', { path: 'b.md', content: 'x' })]),
				textResponse('done after two batches'),
			]);

			const loop = new AgentLoop();
			const result = await loop.run({
				initialResponse: toolResponse([tc('read_file', { path: 'a.md' })]),
				initialUserMessage: 'first message',
				initialHistory: [],
				options: { plugin, session, confirmationProvider, isCancelled: () => false, createModelApi: () => api },
			});

			expect(result.markdown).toBe('done after two batches');
			expect(result.iterations).toBe(2);
			expect(plugin.toolExecutionEngine.executeTool).toHaveBeenCalledTimes(2);
			// First execute = read_file from initial; second = write_file from follow-up
			expect(plugin.toolExecutionEngine.executeTool.mock.calls[0][0].name).toBe('read_file');
			expect(plugin.toolExecutionEngine.executeTool.mock.calls[1][0].name).toBe('write_file');
		});
	});

	describe('tool sorting', () => {
		test('reads execute before writes within a batch', async () => {
			const plugin = buildPlugin();
			const session = buildSession();
			const api = makeScriptedModelApi([textResponse('ok')]);

			const loop = new AgentLoop();
			await loop.run({
				initialResponse: toolResponse([
					tc('delete_file', { path: 'old.md' }),
					tc('write_file', { path: 'new.md', content: 'x' }),
					tc('read_file', { path: 'src.md' }),
				]),
				initialUserMessage: 'q',
				initialHistory: [],
				options: { plugin, session, confirmationProvider, isCancelled: () => false, createModelApi: () => api },
			});

			const executedNames = plugin.toolExecutionEngine.executeTool.mock.calls.map((c: any[]) => c[0].name);
			expect(executedNames).toEqual(['read_file', 'write_file', 'delete_file']);
		});
	});

	describe('cancellation', () => {
		test('cancellation before first iteration returns immediately', async () => {
			const plugin = buildPlugin();
			const session = buildSession();
			const api = makeScriptedModelApi([textResponse('never reached')]);

			const loop = new AgentLoop();
			const result = await loop.run({
				initialResponse: toolResponse([tc('read_file', { path: 'a.md' })]),
				initialUserMessage: 'q',
				initialHistory: [],
				options: { plugin, session, confirmationProvider, isCancelled: () => true, createModelApi: () => api },
			});

			expect(result.cancelled).toBe(true);
			expect(result.markdown).toBe('');
			expect(plugin.toolExecutionEngine.executeTool).not.toHaveBeenCalled();
			expect(api.calls).toBe(0);
		});

		test('cancellation between tools in a batch stops further execution', async () => {
			const plugin = buildPlugin();
			const session = buildSession();
			const api = makeScriptedModelApi([textResponse('skipped')]);

			let cancelled = false;
			plugin.toolExecutionEngine.executeTool = vi.fn().mockImplementation(() => {
				cancelled = true; // flip after the first tool runs
				return Promise.resolve({ success: true });
			});

			const loop = new AgentLoop();
			const result = await loop.run({
				initialResponse: toolResponse([
					tc('read_file', { path: 'a' }),
					tc('read_file', { path: 'b' }),
					tc('read_file', { path: 'c' }),
				]),
				initialUserMessage: 'q',
				initialHistory: [],
				options: { plugin, session, confirmationProvider, isCancelled: () => cancelled, createModelApi: () => api },
			});

			// First tool ran (and flipped the flag); the loop's per-tool cancel check
			// fires before the next tool — and the post-batch cancel check returns early.
			expect(plugin.toolExecutionEngine.executeTool).toHaveBeenCalledTimes(1);
			expect(result.cancelled).toBe(true);
		});

		test('cancellation between iterations skips the follow-up request', async () => {
			const plugin = buildPlugin();
			const session = buildSession();
			const api = makeScriptedModelApi([toolResponse([tc('read_file')]), textResponse('never')]);

			let toolsRun = 0;
			plugin.toolExecutionEngine.executeTool = vi.fn().mockImplementation(() => {
				toolsRun++;
				return Promise.resolve({ success: true });
			});

			// Cancel after the first tool batch completes
			const isCancelled = () => toolsRun >= 1;

			const loop = new AgentLoop();
			const result = await loop.run({
				initialResponse: toolResponse([tc('read_file')]),
				initialUserMessage: 'q',
				initialHistory: [],
				options: { plugin, session, confirmationProvider, isCancelled, createModelApi: () => api },
			});

			expect(result.cancelled).toBe(true);
			expect(api.calls).toBe(0); // never reached the follow-up
		});
	});

	describe('empty-response handling', () => {
		test('retry succeeds — returns retry text and marks retried=true, fellBack=false', async () => {
			const plugin = buildPlugin();
			const session = buildSession();
			const api = makeScriptedModelApi([textResponse(''), textResponse('summary text')]);

			const loop = new AgentLoop();
			const result = await loop.run({
				initialResponse: toolResponse([tc('read_file', { path: 'a' })]),
				initialUserMessage: 'q',
				initialHistory: [],
				options: { plugin, session, confirmationProvider, isCancelled: () => false, createModelApi: () => api },
			});

			expect(result.markdown).toBe('summary text');
			expect(result.retried).toBe(true);
			expect(result.fellBack).toBe(false);
			expect(api.calls).toBe(2); // follow-up + retry
		});

		test('retry also empty — returns fallback message and marks fellBack=true', async () => {
			const plugin = buildPlugin();
			const session = buildSession();
			const api = makeScriptedModelApi([textResponse(''), textResponse('   ')]);

			const loop = new AgentLoop();
			const result = await loop.run({
				initialResponse: toolResponse([tc('read_file', { path: 'a' })]),
				initialUserMessage: 'q',
				initialHistory: [],
				options: { plugin, session, confirmationProvider, isCancelled: () => false, createModelApi: () => api },
			});

			expect(result.fellBack).toBe(true);
			expect(result.retried).toBe(true);
			// Fallback message references the executed tool's display name
			expect(result.markdown).toContain('read_file');
			expect(result.markdown).toContain('completed the requested actions');
		});

		test('emits onEmptyResponseRetry hook', async () => {
			const plugin = buildPlugin();
			const session = buildSession();
			const api = makeScriptedModelApi([textResponse(''), textResponse('done')]);
			const onEmptyResponseRetry = vi.fn();

			const loop = new AgentLoop();
			await loop.run({
				initialResponse: toolResponse([tc('read_file')]),
				initialUserMessage: 'q',
				initialHistory: [],
				options: {
					plugin,
					session,
					confirmationProvider,
					isCancelled: () => false,
					createModelApi: () => api,
					hooks: { onEmptyResponseRetry },
				},
			});

			expect(onEmptyResponseRetry).toHaveBeenCalledTimes(1);
		});
	});

	describe('iteration cap', () => {
		test('exhausts when maxIterations is reached without terminal text', async () => {
			const plugin = buildPlugin();
			const session = buildSession();
			// Model always returns more tool calls — would loop forever without a cap
			const api = {
				generateModelResponse: vi.fn().mockResolvedValue(toolResponse([tc('read_file')])),
			} as any;

			const loop = new AgentLoop();
			const result = await loop.run({
				initialResponse: toolResponse([tc('read_file')]),
				initialUserMessage: 'q',
				initialHistory: [],
				options: {
					plugin,
					session,
					confirmationProvider,
					isCancelled: () => false,
					maxIterations: 3,
					createModelApi: () => api,
				},
			});

			expect(result.exhausted).toBe(true);
			expect(result.iterations).toBe(3);
			expect(result.markdown).toBe('');
			expect(plugin.toolExecutionEngine.executeTool).toHaveBeenCalledTimes(3);
		});

		test('no cap by default — runs until model produces text', async () => {
			const plugin = buildPlugin();
			const session = buildSession();
			const api = makeScriptedModelApi([
				toolResponse([tc('read_file')]),
				toolResponse([tc('read_file')]),
				toolResponse([tc('read_file')]),
				toolResponse([tc('read_file')]),
				toolResponse([tc('read_file')]),
				textResponse('finally done'),
			]);

			const loop = new AgentLoop();
			const result = await loop.run({
				initialResponse: toolResponse([tc('read_file')]),
				initialUserMessage: 'q',
				initialHistory: [],
				options: { plugin, session, confirmationProvider, isCancelled: () => false, createModelApi: () => api },
			});

			expect(result.markdown).toBe('finally done');
			expect(result.iterations).toBe(6);
			expect(result.exhausted).toBe(false);
		});
	});

	describe('hooks', () => {
		test('fires onToolCallStart and onToolCallComplete in order, once per tool', async () => {
			const plugin = buildPlugin();
			const session = buildSession();
			const api = makeScriptedModelApi([textResponse('done')]);
			const events: string[] = [];

			const loop = new AgentLoop();
			await loop.run({
				initialResponse: toolResponse([tc('read_file', { path: 'a' }), tc('read_file', { path: 'b' })]),
				initialUserMessage: 'q',
				initialHistory: [],
				options: {
					plugin,
					session,
					confirmationProvider,
					isCancelled: () => false,
					createModelApi: () => api,
					hooks: {
						onToolCallStart: (tcArg) => {
							events.push(`start:${tcArg.name}:${tcArg.arguments?.path}`);
						},
						onToolCallComplete: (tcArg) => {
							events.push(`complete:${tcArg.name}:${tcArg.arguments?.path}`);
						},
					},
				},
			});

			expect(events).toEqual([
				'start:read_file:a',
				'complete:read_file:a',
				'start:read_file:b',
				'complete:read_file:b',
			]);
		});

		test('passes the description string to onToolCallStart', async () => {
			const plugin = buildPlugin();
			plugin.toolRegistry.getTool = vi.fn().mockReturnValue({
				name: 'read_file',
				displayName: 'Read File',
				getProgressDescription: () => 'Custom description here',
			});
			const session = buildSession();
			const api = makeScriptedModelApi([textResponse('done')]);
			const onToolCallStart = vi.fn();

			const loop = new AgentLoop();
			await loop.run({
				initialResponse: toolResponse([tc('read_file', { path: 'a' })]),
				initialUserMessage: 'q',
				initialHistory: [],
				options: {
					plugin,
					session,
					confirmationProvider,
					isCancelled: () => false,
					createModelApi: () => api,
					hooks: { onToolCallStart },
				},
			});

			expect(onToolCallStart).toHaveBeenCalledWith(
				expect.objectContaining({ name: 'read_file' }),
				expect.any(String),
				'Custom description here'
			);
		});

		test('fires onToolBatchStart once per iteration with the sorted batch', async () => {
			const plugin = buildPlugin();
			const session = buildSession();
			const api = makeScriptedModelApi([
				toolResponse([tc('write_file', { path: 'b' }), tc('read_file', { path: 'c' })]),
				textResponse('done'),
			]);
			const onToolBatchStart = vi.fn();

			const loop = new AgentLoop();
			await loop.run({
				initialResponse: toolResponse([tc('delete_file', { path: 'a' })]),
				initialUserMessage: 'q',
				initialHistory: [],
				options: {
					plugin,
					session,
					confirmationProvider,
					isCancelled: () => false,
					createModelApi: () => api,
					hooks: { onToolBatchStart },
				},
			});

			expect(onToolBatchStart).toHaveBeenCalledTimes(2);

			// First batch: only delete_file (priority order: delete_file alone)
			const firstBatch = onToolBatchStart.mock.calls[0][0];
			expect(firstBatch.map((c: ToolCall) => c.name)).toEqual(['delete_file']);
			expect(onToolBatchStart.mock.calls[0][1]).toBe(0);

			// Second batch: read sorts before write
			const secondBatch = onToolBatchStart.mock.calls[1][0];
			expect(secondBatch.map((c: ToolCall) => c.name)).toEqual(['read_file', 'write_file']);
			expect(onToolBatchStart.mock.calls[1][1]).toBe(1);
		});

		test('fires onFollowUpRequestStart before each follow-up', async () => {
			const plugin = buildPlugin();
			const session = buildSession();
			const api = makeScriptedModelApi([toolResponse([tc('read_file')]), textResponse('done')]);
			const onFollowUpRequestStart = vi.fn();

			const loop = new AgentLoop();
			await loop.run({
				initialResponse: toolResponse([tc('read_file')]),
				initialUserMessage: 'q',
				initialHistory: [],
				options: {
					plugin,
					session,
					confirmationProvider,
					isCancelled: () => false,
					createModelApi: () => api,
					hooks: { onFollowUpRequestStart },
				},
			});

			// One per iteration
			expect(onFollowUpRequestStart).toHaveBeenCalledTimes(2);
		});

		test('fires onToolCounted once per executed tool, even on failure', async () => {
			const plugin = buildPlugin();
			plugin.toolExecutionEngine.executeTool = vi
				.fn()
				.mockResolvedValueOnce({ success: true })
				.mockRejectedValueOnce(new Error('boom'));
			const session = buildSession();
			const api = makeScriptedModelApi([textResponse('done')]);
			const onToolCounted = vi.fn();

			const loop = new AgentLoop();
			await loop.run({
				initialResponse: toolResponse([tc('read_file', { path: 'a' }), tc('read_file', { path: 'b' })]),
				initialUserMessage: 'q',
				initialHistory: [],
				options: {
					plugin,
					session,
					confirmationProvider,
					isCancelled: () => false,
					createModelApi: () => api,
					hooks: { onToolCounted },
				},
			});

			expect(onToolCounted).toHaveBeenCalledTimes(2);
		});
	});

	describe('event bus emissions', () => {
		test('emits toolExecutionComplete per tool, toolChainComplete per batch, apiResponseReceived per model call with metadata', async () => {
			const plugin = buildPlugin();
			const session = buildSession();
			const api = makeScriptedModelApi([
				{
					markdown: 'done',
					rendered: '',
					usageMetadata: { promptTokenCount: 50, totalTokenCount: 75 },
				},
			]);

			const loop = new AgentLoop();
			await loop.run({
				initialResponse: toolResponse([tc('read_file', { path: 'a' }), tc('read_file', { path: 'b' })]),
				initialUserMessage: 'q',
				initialHistory: [],
				options: { plugin, session, confirmationProvider, isCancelled: () => false, createModelApi: () => api },
			});

			const calls = plugin.agentEventBus.emit.mock.calls;
			const eventNames = calls.map((c: any[]) => c[0]);

			// 2 tools => 2 toolExecutionComplete; 1 batch => 1 toolChainComplete; 1 model call with usage => 1 apiResponseReceived
			expect(eventNames.filter((n: string) => n === 'toolExecutionComplete')).toHaveLength(2);
			expect(eventNames.filter((n: string) => n === 'toolChainComplete')).toHaveLength(1);
			expect(eventNames.filter((n: string) => n === 'apiResponseReceived')).toHaveLength(1);
		});

		test('does not emit apiResponseReceived when model response has no usageMetadata', async () => {
			const plugin = buildPlugin();
			const session = buildSession();
			const api = makeScriptedModelApi([textResponse('done')]); // no usageMetadata

			const loop = new AgentLoop();
			await loop.run({
				initialResponse: toolResponse([tc('read_file')]),
				initialUserMessage: 'q',
				initialHistory: [],
				options: { plugin, session, confirmationProvider, isCancelled: () => false, createModelApi: () => api },
			});

			const eventNames = plugin.agentEventBus.emit.mock.calls.map((c: any[]) => c[0]);
			expect(eventNames).not.toContain('apiResponseReceived');
		});
	});

	describe('error handling', () => {
		test('tool throw is captured as a failed result and the loop continues', async () => {
			const plugin = buildPlugin();
			plugin.toolExecutionEngine.executeTool = vi
				.fn()
				.mockRejectedValueOnce(new Error('disk full'))
				.mockResolvedValueOnce({ success: true });
			const session = buildSession();
			const api = makeScriptedModelApi([textResponse('done despite error')]);

			const loop = new AgentLoop();
			const result = await loop.run({
				initialResponse: toolResponse([tc('read_file', { path: 'a' }), tc('read_file', { path: 'b' })]),
				initialUserMessage: 'q',
				initialHistory: [],
				options: { plugin, session, confirmationProvider, isCancelled: () => false, createModelApi: () => api },
			});

			expect(result.markdown).toBe('done despite error');
			expect(plugin.toolExecutionEngine.executeTool).toHaveBeenCalledTimes(2);
			expect(plugin.logger.error).toHaveBeenCalledWith(
				expect.stringContaining('[AgentLoop] Tool execution error'),
				expect.any(Error)
			);
		});
	});

	describe('hook robustness', () => {
		test('a throwing onToolBatchStart hook is logged and the loop continues', async () => {
			const plugin = buildPlugin();
			const session = buildSession();
			const api = makeScriptedModelApi([textResponse('done despite hook throw')]);

			const loop = new AgentLoop();
			const result = await loop.run({
				initialResponse: toolResponse([tc('read_file', { path: 'a' })]),
				initialUserMessage: 'q',
				initialHistory: [],
				options: {
					plugin,
					session,
					confirmationProvider,
					isCancelled: () => false,
					createModelApi: () => api,
					hooks: {
						onToolBatchStart: () => {
							throw new Error('UI broke');
						},
					},
				},
			});

			expect(result.markdown).toBe('done despite hook throw');
			expect(plugin.toolExecutionEngine.executeTool).toHaveBeenCalledTimes(1);
			expect(plugin.logger.error).toHaveBeenCalledWith(
				expect.stringContaining('Hook onToolBatchStart threw'),
				expect.any(Error)
			);
		});

		test('a throwing onToolCallComplete does NOT corrupt the tool result', async () => {
			const plugin = buildPlugin();
			const session = buildSession();
			const api = makeScriptedModelApi([textResponse('done')]);

			const loop = new AgentLoop();
			await loop.run({
				initialResponse: toolResponse([tc('read_file', { path: 'a' })]),
				initialUserMessage: 'q',
				initialHistory: [],
				options: {
					plugin,
					session,
					confirmationProvider,
					isCancelled: () => false,
					createModelApi: () => api,
					hooks: {
						onToolCallComplete: () => {
							throw new Error('UI render failed');
						},
					},
				},
			});

			// The follow-up request should carry the SUCCESSFUL tool result through —
			// the onToolCallComplete throw must not roll the result back to a failure.
			const followUpRequest = (api.generateModelResponse as Mock).mock.calls[0][0];
			const fnResponseTurn = followUpRequest.conversationHistory.find(
				(t: any) => t.role === 'user' && t.parts.some((p: any) => p.functionResponse)
			);
			const fnResponsePart = fnResponseTurn.parts.find((p: any) => p.functionResponse);
			expect(fnResponsePart.functionResponse.response.success).toBe(true);
		});

		test('a throwing event bus subscriber does not abort the loop', async () => {
			const plugin = buildPlugin();
			plugin.agentEventBus.emit = vi.fn().mockImplementation((event: string) => {
				if (event === 'toolChainComplete') {
					return Promise.reject(new Error('subscriber broke'));
				}
				return Promise.resolve();
			});
			const session = buildSession();
			const api = makeScriptedModelApi([textResponse('done despite subscriber throw')]);

			const loop = new AgentLoop();
			const result = await loop.run({
				initialResponse: toolResponse([tc('read_file', { path: 'a' })]),
				initialUserMessage: 'q',
				initialHistory: [],
				options: { plugin, session, confirmationProvider, isCancelled: () => false, createModelApi: () => api },
			});

			expect(result.markdown).toBe('done despite subscriber throw');
			expect(plugin.logger.error).toHaveBeenCalledWith(
				expect.stringContaining('Event bus emit "toolChainComplete" threw'),
				expect.any(Error)
			);
		});
	});

	describe('thoughtSignature propagation', () => {
		test('preserves thoughtSignature in the conversation history sent to follow-up', async () => {
			const plugin = buildPlugin();
			const session = buildSession();
			const api = makeScriptedModelApi([textResponse('done')]);

			const loop = new AgentLoop();
			await loop.run({
				initialResponse: toolResponse([tc('read_file', { path: 'a' }, { thoughtSignature: 'sig_xyz' })]),
				initialUserMessage: 'q',
				initialHistory: [],
				options: { plugin, session, confirmationProvider, isCancelled: () => false, createModelApi: () => api },
			});

			const followUpRequest = (api.generateModelResponse as Mock).mock.calls[0][0];
			const modelTurn = followUpRequest.conversationHistory.find((t: any) => t.role === 'model');
			expect(modelTurn.parts[0]).toHaveProperty('thoughtSignature', 'sig_xyz');
		});
	});

	describe('degenerate input', () => {
		test('returns no-op result when initial response has no tool calls', async () => {
			const plugin = buildPlugin();
			const session = buildSession();
			const api = makeScriptedModelApi([]);

			const loop = new AgentLoop();
			const result = await loop.run({
				initialResponse: textResponse('caller already has the answer'),
				initialUserMessage: 'q',
				initialHistory: [],
				options: { plugin, session, confirmationProvider, isCancelled: () => false, createModelApi: () => api },
			});

			expect(result.iterations).toBe(0);
			expect(result.markdown).toBe('');
			expect(plugin.toolExecutionEngine.executeTool).not.toHaveBeenCalled();
		});
	});

	describe('per-turn context propagation', () => {
		// Count text parts across a request's conversationHistory that exactly
		// equal `text` — used to assert the per-turn context appears once, not
		// duplicated.
		const countContext = (history: any[], text: string): number =>
			(history ?? []).flatMap((c: any) => c.parts ?? []).filter((p: any) => p?.text === text).length;

		// `buildToolHistoryTurns` splices `perTurnContext` into the user turn of
		// the history it builds, so it reaches the model via `conversationHistory`.
		// It must NOT also ride on the follow-up/retry request: `buildContents`
		// would then append a second copy, duplicating the (potentially large)
		// context payload on every tool iteration — the opposite of the caching
		// win this design exists for. Session-static fields (projectInstructions,
		// projectSkills, sessionStartedAt) still thread onto every request because
		// they feed the byte-stable system prompt.
		test('follow-up request keeps per-turn context in history, not duplicated on the request', async () => {
			const plugin = buildPlugin();
			const session = buildSession();
			const api = makeScriptedModelApi([textResponse('done')]);

			const loop = new AgentLoop();
			await loop.run({
				initialResponse: toolResponse([tc('read_file', { path: 'a.md' })]),
				initialUserMessage: 'q',
				initialHistory: [],
				options: {
					plugin,
					session,
					confirmationProvider,
					isCancelled: () => false,
					createModelApi: () => api,
					perTurn: {
						perTurnContext: 'CONTEXT FILES: foo.md\n<rendered contents>',
						projectInstructions: 'be concise',
						projectSkills: ['code-review'],
						sessionStartedAt: '2026-05-09T10:00:00',
					},
				},
			});

			expect(api.generateModelResponse).toHaveBeenCalledTimes(1);
			const followUpRequest = (api.generateModelResponse as Mock).mock.calls[0][0];
			// Not on the request — otherwise buildContents appends a second copy.
			expect(followUpRequest.perTurnContext).toBeUndefined();
			// Still reaches the model, exactly once, via conversation history.
			expect(countContext(followUpRequest.conversationHistory, 'CONTEXT FILES: foo.md\n<rendered contents>')).toBe(1);
			// Session-static fields still thread through.
			expect(followUpRequest.projectInstructions).toBe('be concise');
			expect(followUpRequest.projectSkills).toEqual(['code-review']);
			expect(followUpRequest.sessionStartedAt).toBe('2026-05-09T10:00:00');
		});

		test('retry request (empty-response path) keeps per-turn context in history, not on the request', async () => {
			const plugin = buildPlugin();
			const session = buildSession();
			// First follow-up returns empty → triggers retry path.
			const api = makeScriptedModelApi([textResponse(''), textResponse('summary text')]);

			const loop = new AgentLoop();
			const result = await loop.run({
				initialResponse: toolResponse([tc('read_file', { path: 'a.md' })]),
				initialUserMessage: 'q',
				initialHistory: [],
				options: {
					plugin,
					session,
					confirmationProvider,
					isCancelled: () => false,
					createModelApi: () => api,
					perTurn: {
						perTurnContext: 'CTX',
						sessionStartedAt: '2026-05-09T10:00:00',
					},
				},
			});

			expect(result.retried).toBe(true);
			expect(api.generateModelResponse).toHaveBeenCalledTimes(2);
			const retryRequest = (api.generateModelResponse as Mock).mock.calls[1][0];
			expect(retryRequest.perTurnContext).toBeUndefined();
			expect(countContext(retryRequest.conversationHistory, 'CTX')).toBe(1);
			expect(retryRequest.sessionStartedAt).toBe('2026-05-09T10:00:00');
		});

		test('multi-iteration: per-turn context stays in history exactly once across all follow-ups', async () => {
			const plugin = buildPlugin();
			const session = buildSession();
			const api = makeScriptedModelApi([
				toolResponse([tc('write_file', { path: 'b.md', content: 'x' })]),
				textResponse('after two batches'),
			]);

			const loop = new AgentLoop();
			await loop.run({
				initialResponse: toolResponse([tc('read_file', { path: 'a.md' })]),
				initialUserMessage: 'q',
				initialHistory: [],
				options: {
					plugin,
					session,
					confirmationProvider,
					isCancelled: () => false,
					createModelApi: () => api,
					perTurn: { perTurnContext: 'CTX' },
				},
			});

			const calls = (api.generateModelResponse as Mock).mock.calls;
			expect(calls).toHaveLength(2);
			// Never on the request, and never accumulating across iterations:
			// exactly one copy lives in each follow-up's conversation history.
			expect(calls[0][0].perTurnContext).toBeUndefined();
			expect(calls[1][0].perTurnContext).toBeUndefined();
			expect(countContext(calls[0][0].conversationHistory, 'CTX')).toBe(1);
			expect(countContext(calls[1][0].conversationHistory, 'CTX')).toBe(1);
		});
	});

	describe('loop-detector escalation', () => {
		test('aborts the turn once loopDetected fires accumulate past threshold', async () => {
			const plugin = buildPlugin();
			// Every tool call comes back already blocked by the engine — mimics the
			// model stubbornly re-attempting the same call after being told to stop.
			plugin.toolExecutionEngine.executeTool = vi
				.fn()
				.mockResolvedValue({ success: false, loopDetected: true, error: 'Execution loop detected' });

			const session = buildSession();
			// Model keeps replying with more tool calls — would loop forever without the abort.
			const api = {
				generateModelResponse: vi.fn().mockResolvedValue(toolResponse([tc('read_file', { path: 'a' })])),
			} as any;

			const loop = new AgentLoop();
			const result = await loop.run({
				initialResponse: toolResponse([tc('read_file', { path: 'a' })]),
				initialUserMessage: 'q',
				initialHistory: [],
				options: { plugin, session, confirmationProvider, isCancelled: () => false, createModelApi: () => api },
			});

			expect(result.loopAborted).toBe(true);
			expect(result.cancelled).toBe(false);
			expect(result.exhausted).toBe(false);
			expect(result.markdown).toMatch(/loop detector fired/i);
			// Threshold is 3 — one blocked call per batch, so three batches run before abort.
			expect(result.iterations).toBe(3);
			expect(plugin.toolExecutionEngine.executeTool).toHaveBeenCalledTimes(3);
		});

		test('does not abort when only non-loop failures occur', async () => {
			const plugin = buildPlugin();
			// Regular failures without the loopDetected flag must not escalate.
			plugin.toolExecutionEngine.executeTool = vi.fn().mockResolvedValue({ success: false, error: 'generic failure' });

			const session = buildSession();
			const api = makeScriptedModelApi([textResponse('recovered')]);

			const loop = new AgentLoop();
			const result = await loop.run({
				initialResponse: toolResponse([tc('read_file'), tc('read_file'), tc('read_file'), tc('read_file')]),
				initialUserMessage: 'q',
				initialHistory: [],
				options: { plugin, session, confirmationProvider, isCancelled: () => false, createModelApi: () => api },
			});

			expect(result.loopAborted).toBe(false);
			expect(result.markdown).toBe('recovered');
		});
	});
});
