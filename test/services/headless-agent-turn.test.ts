import type { Mock } from 'vitest';
import { runHeadlessAgentTurn } from '../../src/services/headless-agent-turn';
import type { HeadlessAgentTurnSpec } from '../../src/services/headless-agent-turn';
import type { AgentLoopResult } from '../../src/agent/agent-loop';
import { PolicyPreset } from '../../src/types/tool-policy';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('obsidian', () => ({
	normalizePath: (p: string) => p,
	TFile: class {},
}));

vi.mock('../../src/utils/format-utils', () => ({
	formatLocalDate: vi.fn().mockReturnValue('2026-07-28'),
	formatLocalTimestamp: vi.fn().mockReturnValue('2026-07-28 08:00'),
}));

vi.mock('../../src/utils/turn-preamble', () => ({
	buildTurnPreamble: vi.fn().mockReturnValue('[preamble] '),
}));

vi.mock('../../src/api', () => ({
	ModelClientFactory: {
		createChatModel: vi.fn(),
	},
}));

/**
 * Stub out `AgentLoop` so tests don't pull in the real agent infrastructure,
 * but keep every other export — notably `DEFAULT_HEADLESS_MAX_ITERATIONS` —
 * pointing at the real module. Hard-coding the default here would let the
 * driver's actual default drift while the assertions below still passed.
 */
const mockAgentLoopRun = vi.fn();
vi.mock('../../src/agent/agent-loop', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../src/agent/agent-loop')>();
	return {
		...actual,
		AgentLoop: vi.fn().mockImplementation(function () {
			return { run: mockAgentLoopRun };
		}),
	};
});

import { ModelClientFactory } from '../../src/api';
import { DEFAULT_HEADLESS_MAX_ITERATIONS } from '../../src/agent/agent-loop';

function createMockModelApi(responseText = 'Model answer.', toolCalls: any[] = []) {
	return {
		generateModelResponse: vi.fn().mockResolvedValue({
			markdown: responseText,
			toolCalls,
		}),
	};
}

function successfulLoopResult(markdown = 'Tool result text.'): AgentLoopResult {
	return {
		markdown,
		history: [],
		cancelled: false,
		retried: false,
		fellBack: false,
		exhausted: false,
		loopAborted: false,
		iterations: 1,
	};
}

/** The auto-approved subset the registry is expected to hand to the request. */
const AUTO_APPROVED_TOOLS = [{ name: 'read_file' }];
/** The full registry, which must NOT reach the request in a headless run. */
const ALL_ENABLED_TOOLS = [{ name: 'read_file' }, { name: 'ask_user' }];

function createMockPlugin(): any {
	return {
		logger: { log: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
		settings: {
			chatModelName: 'plugin-default-model',
			temperature: 1,
			topP: 0.95,
		},
		sessionManager: {
			createAgentSession: vi.fn().mockResolvedValue({
				id: 'session-1',
				title: 'Headless: test',
				created: new Date(),
				context: { enabledTools: [], requireConfirmation: [] },
				modelConfig: {},
			}),
		},
		toolRegistry: {
			getEnabledTools: vi.fn().mockReturnValue(ALL_ENABLED_TOOLS),
			getAutoApprovedTools: vi.fn().mockReturnValue(AUTO_APPROVED_TOOLS),
		},
		toolExecutionEngine: {
			executeTool: vi.fn().mockResolvedValue({ success: true, output: 'ok' }),
		},
		app: { vault: {} },
	};
}

function makeSpec(overrides: Partial<HeadlessAgentTurnSpec> = {}): HeadlessAgentTurnSpec {
	return {
		sessionLabel: 'Scheduled: test-task',
		logPrefix: '[TestRunner]',
		subjectNoun: 'Task',
		subjectName: 'test-task',
		prompt: 'Write a daily summary.',
		...overrides,
	};
}

/** The request object handed to the (mocked) model API. */
function lastRequest(): any {
	return ((ModelClientFactory.createChatModel as Mock).mock.results[0].value.generateModelResponse as Mock).mock
		.calls[0][0];
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('runHeadlessAgentTurn', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		(ModelClientFactory.createChatModel as Mock).mockReturnValue(createMockModelApi());
		mockAgentLoopRun.mockResolvedValue(successfulLoopResult());
	});

	describe('missing agent services', () => {
		// Each of the three handles is checked, so a partially-initialised plugin
		// can't slip a headless run past the guard.
		it.each(['sessionManager', 'toolRegistry', 'toolExecutionEngine'])(
			'throws when %s is not initialised',
			async (service) => {
				const plugin = createMockPlugin();
				plugin[service] = null;

				await expect(runHeadlessAgentTurn(plugin, makeSpec(), () => false)).rejects.toThrow(
					'[TestRunner] Agent services not initialised'
				);
			}
		);
	});

	describe('cancellation', () => {
		it('returns undefined and never calls the model when cancelled up front', async () => {
			const plugin = createMockPlugin();

			const result = await runHeadlessAgentTurn(plugin, makeSpec(), () => true);

			expect(result).toBeUndefined();
			expect(
				(ModelClientFactory.createChatModel as Mock).mock.results[0].value.generateModelResponse
			).not.toHaveBeenCalled();
		});

		it('returns undefined when cancellation flips true during the model call', async () => {
			const plugin = createMockPlugin();
			// False for the pre-call check, true for the post-call check.
			let calls = 0;
			const isCancelled = () => calls++ > 0;

			const result = await runHeadlessAgentTurn(plugin, makeSpec(), isCancelled);

			expect(result).toBeUndefined();
			// The model was reached, but its answer is discarded.
			expect(
				(ModelClientFactory.createChatModel as Mock).mock.results[0].value.generateModelResponse
			).toHaveBeenCalled();
		});

		it('returns undefined when AgentLoop reports cancellation', async () => {
			(ModelClientFactory.createChatModel as Mock).mockReturnValue(
				createMockModelApi('', [{ name: 'list_files', arguments: {} }])
			);
			mockAgentLoopRun.mockResolvedValue({ ...successfulLoopResult(), cancelled: true, markdown: '' });

			const result = await runHeadlessAgentTurn(createMockPlugin(), makeSpec(), () => false);

			expect(result).toBeUndefined();
		});
	});

	describe('no tool calls', () => {
		it('returns the initial response markdown without invoking AgentLoop', async () => {
			(ModelClientFactory.createChatModel as Mock).mockReturnValue(createMockModelApi('Straight answer.'));

			const result = await runHeadlessAgentTurn(createMockPlugin(), makeSpec(), () => false);

			expect(result).toBe('Straight answer.');
			expect(mockAgentLoopRun).not.toHaveBeenCalled();
		});

		it('falls back to an empty string when the model returns null markdown', async () => {
			(ModelClientFactory.createChatModel as Mock).mockReturnValue({
				generateModelResponse: vi.fn().mockResolvedValue({ markdown: null, toolCalls: [] }),
			});

			const result = await runHeadlessAgentTurn(createMockPlugin(), makeSpec(), () => false);

			// Empty string, not undefined — callers distinguish "cancelled"
			// (undefined) from "ran but produced nothing" (empty).
			expect(result).toBe('');
		});
	});

	describe('tool-call path', () => {
		beforeEach(() => {
			(ModelClientFactory.createChatModel as Mock).mockReturnValue(
				createMockModelApi('', [{ name: 'list_files', arguments: { path: '/' } }])
			);
		});

		it('hands off to AgentLoop and returns its markdown', async () => {
			mockAgentLoopRun.mockResolvedValue(successfulLoopResult('Loop answer.'));
			const plugin = createMockPlugin();

			const result = await runHeadlessAgentTurn(plugin, makeSpec(), () => false);

			expect(result).toBe('Loop answer.');
			expect(mockAgentLoopRun).toHaveBeenCalledWith(
				expect.objectContaining({
					initialUserMessage: '[preamble] Write a daily summary.',
					initialHistory: [],
					options: expect.objectContaining({
						plugin,
						headless: true,
						isCancelled: expect.any(Function),
						maxIterations: DEFAULT_HEADLESS_MAX_ITERATIONS,
						// Regression guard: headless runs must supply their own
						// confirmation provider so AgentLoop never has to fall back.
						confirmationProvider: expect.objectContaining({
							showConfirmationInChat: expect.any(Function),
							isToolAllowedWithoutConfirmation: expect.any(Function),
							allowToolWithoutConfirmation: expect.any(Function),
						}),
					}),
				})
			);
		});

		it('forwards a per-run maxIterations override', async () => {
			await runHeadlessAgentTurn(createMockPlugin(), makeSpec({ maxIterations: 50 }), () => false);

			expect(mockAgentLoopRun).toHaveBeenCalledWith(
				expect.objectContaining({ options: expect.objectContaining({ maxIterations: 50 }) })
			);
		});

		it('throws on exhaustion, naming the caller, subject, cap and actual count', async () => {
			mockAgentLoopRun.mockResolvedValue({
				...successfulLoopResult(),
				exhausted: true,
				iterations: 8,
				markdown: '',
			});

			// A deliberately non-default cap, so the message is proven to report
			// the *configured* value rather than coincidentally matching the
			// shared default.
			await expect(
				runHeadlessAgentTurn(createMockPlugin(), makeSpec({ maxIterations: 7 }), () => false)
			).rejects.toThrow(
				'[TestRunner] Task "test-task" exhausted its tool-iteration budget (cap 7, ran 8) without producing a response'
			);
		});

		it('uses the caller-supplied subject noun in the exhaustion message', async () => {
			mockAgentLoopRun.mockResolvedValue({ ...successfulLoopResult(), exhausted: true, markdown: '' });

			await expect(
				runHeadlessAgentTurn(
					createMockPlugin(),
					makeSpec({ logPrefix: '[HookRunner]', subjectNoun: 'Hook', subjectName: 'my-hook' }),
					() => false
				)
			).rejects.toThrow('[HookRunner] Hook "my-hook" exhausted');
		});
	});

	describe('tool exposure', () => {
		// The headless invariant: only APPROVE-class tools reach the request.
		// Exposing ASK_USER tools would silently bypass the user's "ask first"
		// intent, because there is no UI to ask on.
		it('sends the auto-approved subset, not the full enabled registry', async () => {
			const plugin = createMockPlugin();

			await runHeadlessAgentTurn(plugin, makeSpec(), () => false);

			expect(plugin.toolRegistry.getAutoApprovedTools).toHaveBeenCalled();
			expect(plugin.toolRegistry.getEnabledTools).not.toHaveBeenCalled();
			expect(lastRequest().availableTools).toBe(AUTO_APPROVED_TOOLS);
		});

		it('builds the tool context with the spec tool policy', async () => {
			const plugin = createMockPlugin();
			const toolPolicy = { preset: PolicyPreset.READ_ONLY };

			await runHeadlessAgentTurn(plugin, makeSpec({ toolPolicy }), () => false);

			expect(plugin.toolRegistry.getAutoApprovedTools).toHaveBeenCalledWith(
				expect.objectContaining({ plugin, featureToolPolicy: toolPolicy })
			);
		});
	});

	describe('session and request construction', () => {
		it('creates the session with the spec label and tool policy', async () => {
			const plugin = createMockPlugin();
			const toolPolicy = { preset: PolicyPreset.READ_ONLY };

			await runHeadlessAgentTurn(plugin, makeSpec({ sessionLabel: 'Hook: my-hook', toolPolicy }), () => false);

			expect(plugin.sessionManager.createAgentSession).toHaveBeenCalledWith(
				'Hook: my-hook',
				expect.objectContaining({ toolPolicy, requireConfirmation: [] })
			);
		});

		it('passes toolPolicy: undefined so the session inherits the global policy', async () => {
			const plugin = createMockPlugin();

			await runHeadlessAgentTurn(plugin, makeSpec({ toolPolicy: undefined }), () => false);

			expect(plugin.sessionManager.createAgentSession).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({ toolPolicy: undefined })
			);
		});

		it('applies a model override to both the session and the request', async () => {
			const plugin = createMockPlugin();
			const session = { modelConfig: {} as any, created: new Date() };
			plugin.sessionManager.createAgentSession = vi.fn().mockResolvedValue(session);

			await runHeadlessAgentTurn(plugin, makeSpec({ model: 'override-model' }), () => false);

			expect(session.modelConfig).toEqual({ model: 'override-model' });
			expect(lastRequest().model).toBe('override-model');
		});

		it('falls back to the plugin chat model when no override is given', async () => {
			await runHeadlessAgentTurn(createMockPlugin(), makeSpec(), () => false);

			expect(lastRequest().model).toBe('plugin-default-model');
		});

		it('prepends the turn preamble to the caller-rendered prompt', async () => {
			await runHeadlessAgentTurn(createMockPlugin(), makeSpec({ prompt: 'Do the thing.' }), () => false);

			expect(lastRequest().userMessage).toBe('[preamble] Do the thing.');
		});

		it('sends a non-rendering, history-free extended request with plugin sampling settings', async () => {
			await runHeadlessAgentTurn(createMockPlugin(), makeSpec(), () => false);

			expect(lastRequest()).toMatchObject({
				kind: 'extended',
				conversationHistory: [],
				prompt: '',
				renderContent: false,
				temperature: 1,
				topP: 0.95,
			});
		});

		it('forwards a non-empty projectSkills list as the skill include-list', async () => {
			await runHeadlessAgentTurn(createMockPlugin(), makeSpec({ projectSkills: ['research'] }), () => false);

			expect(lastRequest().projectSkills).toEqual(['research']);
		});

		it.each([
			['an empty list', [] as string[]],
			['an absent list', undefined],
		])('omits projectSkills for %s (inherit-all default)', async (_label, projectSkills) => {
			await runHeadlessAgentTurn(createMockPlugin(), makeSpec({ projectSkills }), () => false);

			expect(lastRequest().projectSkills).toBeUndefined();
		});
	});

	describe('HeadlessConfirmationProvider wiring', () => {
		it('auto-approves confirmations and reports all tools allowed', async () => {
			(ModelClientFactory.createChatModel as Mock).mockReturnValue(
				createMockModelApi('', [{ name: 'list_files', arguments: {} }])
			);
			mockAgentLoopRun.mockResolvedValue(successfulLoopResult('Tool output.'));

			await runHeadlessAgentTurn(createMockPlugin(), makeSpec(), () => false);

			const provider = mockAgentLoopRun.mock.calls[0][0].options.confirmationProvider;

			await expect(provider.showConfirmationInChat({}, {}, 'exec-1')).resolves.toEqual({
				confirmed: true,
				allowWithoutConfirmation: false,
			});
			expect(provider.isToolAllowedWithoutConfirmation('any_tool')).toBe(true);
			// No-ops; just verify they don't throw.
			provider.allowToolWithoutConfirmation('any_tool');
			provider.updateProgress('msg', 'status');
		});
	});
});
