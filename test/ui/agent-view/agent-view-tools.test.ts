import { describe, test, expect, vi, beforeEach } from 'vitest';
// `vi.mock` is hoisted above the imports, so `AgentViewTools` picks up the
// stubbed `AgentLoop` / `AgentViewToolDisplay` below even though this is a
// static import.
import { AgentViewTools } from '../../../src/ui/agent-view/agent-view-tools';
import type { AgentLoopHooks, AgentLoopResult } from '../../../src/agent/agent-loop';
import { DEFAULT_TURN_BUDGET_REMIND_AT } from '../../../src/agent/turn-budget';
import type { ToolCall } from '../../../src/api/interfaces/model-api';
import type { GeminiConversationEntry } from '../../../src/types/conversation';
import { t } from '../../../src/i18n';

// `AgentViewTools` is an adapter: it constructs an `AgentLoop`, hands it a
// `hooks` object, and turns the loop's callbacks into UI calls and
// session-history writes. So these tests mock the loop with a `run()` that
// replays a scripted hook sequence and returns a scripted `AgentLoopResult`,
// then assert on the adapter's observable effects — which hooks fired in what
// order, what reached `sessionHistory`, what reached the progress/display
// surfaces. `AgentViewToolDisplay` is stubbed too, so the assertions are about
// dispatch decisions rather than markup.
//
// The streaming hooks' own contract (the empty-bubble guard and the
// `onFollowUpStreamReady` → Stop-target forwarding) is covered in
// `agent-view-tools-streaming.test.ts`; the streaming container appears here
// only as an input to the terminal-disposition branches below.
const mocks = vi.hoisted(() => ({
	constructLoop: vi.fn(),
	run: vi.fn(),
	createToolGroup: vi.fn(),
	updateGroupSummary: vi.fn(),
	showToolExecution: vi.fn(),
	showToolResult: vi.fn(),
	showPermissionGranted: vi.fn(),
}));

vi.mock('../../../src/agent/agent-loop', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../../src/agent/agent-loop')>();
	return {
		...actual,
		AgentLoop: class {
			constructor() {
				mocks.constructLoop();
			}
			run = mocks.run;
		},
	};
});

vi.mock('../../../src/ui/agent-view/agent-view-tool-display', () => ({
	AgentViewToolDisplay: class {
		createToolGroup = mocks.createToolGroup;
		updateGroupSummary = mocks.updateGroupSummary;
		showToolExecution = mocks.showToolExecution;
		showToolResult = mocks.showToolResult;
		showPermissionGranted = mocks.showPermissionGranted;
	},
}));

/**
 * The model the fixture settings resolve to. Post-redesign shape: the source
 * calls `getActiveChatModel(plugin.settings)`, which routes through
 * `resolveFeatureModel` whenever `features` is present, so the fixture must
 * carry `features` rather than the legacy flat `chatModelName` key.
 */
const CHAT_MODEL = 'gemini-fixture-chat';

const TOOL_CALL: ToolCall = { name: 'read_file', arguments: { path: 'a.md' } };

/** A tool group the way `AgentViewToolDisplay.createToolGroup` builds it. */
function makeGroup(totalCount: number): HTMLElement {
	const group = document.createElement('div');
	group.dataset.totalCount = String(totalCount);
	const body = document.createElement('div');
	body.className = 'gemini-tool-group-body';
	group.appendChild(body);
	return group;
}

/** A live follow-up streaming container, attached so `.remove()` is observable. */
function makeStreamContainer(): HTMLElement {
	const container = document.createElement('div');
	const content = document.createElement('div');
	content.className = 'gemini-agent-message-content';
	container.appendChild(content);
	document.body.appendChild(container);
	return container;
}

/** A successful terminal `AgentLoopResult`, with per-test fields overridden. */
function loopResult(overrides: Partial<AgentLoopResult> = {}): AgentLoopResult {
	return {
		markdown: 'final answer',
		history: [],
		cancelled: false,
		fellBack: false,
		exhausted: false,
		loopAborted: false,
		iterations: 1,
		...overrides,
	};
}

type HookScript = (hooks: AgentLoopHooks) => Promise<void> | void;

/** Point the mocked `AgentLoop.run` at a hook script + terminal result. */
function scriptLoop(script: HookScript | undefined, result: AgentLoopResult = loopResult()) {
	mocks.run.mockImplementation(async (config: any) => {
		await script?.(config.options.hooks as AgentLoopHooks);
		return result;
	});
}

/**
 * Build an `AgentViewTools` over stub plugin/context collaborators, plus a
 * `turn()` helper that drives one user turn through the adapter.
 *
 * @param options.withFinalize Whether the view supports `finalizeFollowUpStream`
 *   — false exercises the `displayMessage` fallback path.
 */
function makeHarness(options: { withFinalize?: boolean } = {}) {
	const { withFinalize = true } = options;
	const addEntryToSession = vi.fn().mockResolvedValue(undefined);
	const logger = { error: vi.fn(), warn: vi.fn(), log: vi.fn(), debug: vi.fn() };
	const plugin = {
		settings: { features: { chat: { provider: 'gemini', model: CHAT_MODEL } } },
		sessionHistory: { addEntryToSession },
		logger,
	} as any;
	const session = { id: 's1', historyPath: 'Agent-Sessions/s1.md', modelConfig: {} } as any;
	const context = {
		getCurrentSession: vi.fn().mockReturnValue(session),
		isCancellationRequested: vi.fn().mockReturnValue(false),
		updateProgress: vi.fn(),
		hideProgress: vi.fn(),
		displayMessage: vi.fn().mockResolvedValue(undefined),
		renderReasoning: vi.fn().mockResolvedValue(undefined),
		updateTokenUsage: vi.fn().mockResolvedValue(undefined),
		incrementToolCallCount: vi.fn(),
		confirmationProvider: {},
		viewActions: {},
		createFollowUpStream: vi.fn(() => makeStreamContainer()),
		registerFollowUpStream: vi.fn(),
		...(withFinalize ? { finalizeFollowUpStream: vi.fn().mockResolvedValue(undefined) } : {}),
	} as any;
	const tools = new AgentViewTools(document.createElement('div'), plugin, context);
	/** Drive one user turn through the adapter. */
	const turn = (precedingThoughts?: string) =>
		tools.handleToolCalls(
			[TOOL_CALL],
			'user message',
			[],
			{} as GeminiConversationEntry,
			undefined,
			undefined,
			precedingThoughts
		);
	return { tools, plugin, context, session, addEntryToSession, logger, turn };
}

beforeEach(() => {
	vi.clearAllMocks();
	document.body.innerHTML = '';
	mocks.createToolGroup.mockImplementation((count: number) => makeGroup(count));
	scriptLoop(undefined);
});

describe('AgentViewTools.handleToolCalls — session gate', () => {
	test('does nothing when there is no current session', async () => {
		const { context, addEntryToSession, turn } = makeHarness();
		context.getCurrentSession.mockReturnValue(null);

		await turn('some reasoning');

		expect(mocks.constructLoop).not.toHaveBeenCalled();
		expect(mocks.run).not.toHaveBeenCalled();
		expect(addEntryToSession).not.toHaveBeenCalled();
	});
});

describe('AgentViewTools.handleToolCalls — pre-tool reasoning', () => {
	test('persists preceding reasoning once and renders it as the first row of the group', async () => {
		const { context, addEntryToSession, turn } = makeHarness();
		scriptLoop(async (hooks) => {
			await hooks.onToolBatchStart?.([TOOL_CALL], 0);
			await hooks.onToolBatchStart?.([TOOL_CALL], 1);
		});

		await turn('thinking before tools');

		const reasoningEntries = addEntryToSession.mock.calls.filter(
			(call) => call[1].thoughts === 'thinking before tools'
		);
		expect(reasoningEntries).toHaveLength(1);
		expect(reasoningEntries[0][1]).toMatchObject({ role: 'model', message: '', notePath: '', model: CHAT_MODEL });

		// Rendered into the group body, once — the second batch must not re-render it.
		expect(context.renderReasoning).toHaveBeenCalledTimes(1);
		const [container, thoughts, sourcePath] = context.renderReasoning.mock.calls[0];
		expect((container as HTMLElement).className).toBe('gemini-tool-group-body');
		expect(thoughts).toBe('thinking before tools');
		expect(sourcePath).toBe('Agent-Sessions/s1.md');
	});

	test('whitespace-only preceding reasoning is neither persisted nor rendered', async () => {
		const { context, addEntryToSession, turn } = makeHarness();
		scriptLoop(async (hooks) => {
			await hooks.onToolBatchStart?.([TOOL_CALL], 0);
		});

		await turn('   \n  ');

		expect(addEntryToSession.mock.calls.filter((call) => call[1].thoughts)).toHaveLength(0);
		expect(context.renderReasoning).not.toHaveBeenCalled();
	});

	test('mid-loop reasoning is rendered in the group and persisted as a thoughts-only entry', async () => {
		const { context, addEntryToSession, turn } = makeHarness();
		scriptLoop(async (hooks) => {
			await hooks.onToolBatchStart?.([TOOL_CALL], 0);
			await hooks.onModelReasoning?.('why I am calling more tools');
		});

		await turn();

		expect(context.renderReasoning).toHaveBeenCalledTimes(1);
		expect(context.renderReasoning.mock.calls[0][1]).toBe('why I am calling more tools');
		const reasoningEntries = addEntryToSession.mock.calls.filter(
			(call) => call[1].thoughts === 'why I am calling more tools'
		);
		expect(reasoningEntries).toHaveLength(1);
		expect(reasoningEntries[0][1]).toMatchObject({ role: 'model', message: '', model: CHAT_MODEL });
	});
});

describe('AgentViewTools.handleToolCalls — tool hook ordering', () => {
	test('batch → start → complete, with the executing/completed tool transitioning across the pair', async () => {
		const { tools, context, turn } = makeHarness();
		const order: string[] = [];
		const observed: Array<{ current: string | null; last: string | null }> = [];
		scriptLoop(async (hooks) => {
			await hooks.onToolBatchStart?.([TOOL_CALL], 0);
			order.push('batch');
			await hooks.onToolCallStart?.(TOOL_CALL, 'exec-1', 'Reading a.md');
			order.push('start');
			observed.push({ current: tools.getCurrentExecutingTool(), last: tools.getLastCompletedTool() });
			await hooks.onToolCallComplete?.(TOOL_CALL, { success: true }, 'exec-1');
			order.push('complete');
			observed.push({ current: tools.getCurrentExecutingTool(), last: tools.getLastCompletedTool() });
			hooks.onToolCounted?.();
		});

		await turn();

		expect(order).toEqual(['batch', 'start', 'complete']);
		expect(observed).toEqual([
			{ current: 'read_file', last: null },
			{ current: null, last: 'read_file' },
		]);
		expect(context.updateProgress).toHaveBeenCalledWith('Reading a.md', 'tool');
		expect(mocks.showToolExecution).toHaveBeenCalledWith(
			'read_file',
			TOOL_CALL.arguments,
			'exec-1',
			expect.any(HTMLElement)
		);
		expect(mocks.showToolResult).toHaveBeenCalledWith('read_file', { success: true }, 'exec-1');
		expect(context.incrementToolCallCount).toHaveBeenCalledWith(1);
	});
});

describe('AgentViewTools.handleToolCalls — tool group lifecycle', () => {
	test('one group spans nested batches within a turn, extending its running total', async () => {
		const { turn } = makeHarness();
		let group: HTMLElement | undefined;
		scriptLoop(async (hooks) => {
			await hooks.onToolBatchStart?.([TOOL_CALL, TOOL_CALL], 0);
			await hooks.onToolBatchStart?.([TOOL_CALL, TOOL_CALL, TOOL_CALL], 1);
			group = mocks.createToolGroup.mock.results[0].value as HTMLElement;
		});

		await turn();

		expect(mocks.createToolGroup).toHaveBeenCalledTimes(1);
		expect(mocks.createToolGroup).toHaveBeenCalledWith(2);
		expect(group?.dataset.totalCount).toBe('5');
		expect(mocks.updateGroupSummary).toHaveBeenCalledWith(group);
	});

	test('the group is cleared after the chain so the next turn opens a fresh one', async () => {
		const { turn } = makeHarness();
		scriptLoop(async (hooks) => {
			await hooks.onToolBatchStart?.([TOOL_CALL], 0);
		});

		await turn();
		await turn();

		expect(mocks.createToolGroup).toHaveBeenCalledTimes(2);
	});

	test('permission acknowledgments are routed into the active group', async () => {
		const { tools, turn } = makeHarness();
		scriptLoop(async (hooks) => {
			await hooks.onToolBatchStart?.([TOOL_CALL], 0);
			tools.showPermissionGranted('write_file');
		});

		await turn();

		expect(mocks.showPermissionGranted).toHaveBeenCalledWith('write_file', expect.any(HTMLElement));
	});
});

describe('AgentViewTools.handleToolCalls — terminal dispositions', () => {
	/** Script a turn that streams one follow-up chunk, so a live container exists. */
	const streamThenFinish = (result: AgentLoopResult) =>
		scriptLoop(async (hooks) => {
			await hooks.onFollowUpChunk?.({ text: 'partial answer' });
		}, result);

	test('cancelled: removes the partial container, hides progress, persists nothing', async () => {
		const { context, addEntryToSession, turn } = makeHarness();
		streamThenFinish(loopResult({ cancelled: true, markdown: '' }));

		await turn();

		const container = context.createFollowUpStream.mock.results[0].value as HTMLElement;
		expect(container.isConnected).toBe(false);
		expect(context.hideProgress).toHaveBeenCalled();
		expect(context.displayMessage).not.toHaveBeenCalled();
		expect(context.finalizeFollowUpStream).not.toHaveBeenCalled();
		expect(addEntryToSession).not.toHaveBeenCalled();
	});

	test('empty markdown: removes the partial container, hides progress, persists nothing', async () => {
		const { context, addEntryToSession, turn } = makeHarness();
		streamThenFinish(loopResult({ markdown: '' }));

		await turn();

		const container = context.createFollowUpStream.mock.results[0].value as HTMLElement;
		expect(container.isConnected).toBe(false);
		expect(context.hideProgress).toHaveBeenCalled();
		expect(context.displayMessage).not.toHaveBeenCalled();
		expect(addEntryToSession).not.toHaveBeenCalled();
	});

	test('streamed answer: finalizes the live container and persists the entry', async () => {
		const { context, addEntryToSession, turn } = makeHarness();
		streamThenFinish(loopResult({ markdown: 'final answer', thoughts: 'terminal reasoning' }));

		await turn();

		const container = context.createFollowUpStream.mock.results[0].value as HTMLElement;
		expect(context.finalizeFollowUpStream).toHaveBeenCalledTimes(1);
		const [finalizedContainer, entry] = context.finalizeFollowUpStream.mock.calls[0];
		expect(finalizedContainer).toBe(container);
		expect(entry).toMatchObject({
			role: 'model',
			message: 'final answer',
			model: CHAT_MODEL,
			thoughts: 'terminal reasoning',
		});
		// Finalization replaces the duplicate render, so displayMessage stays out of it.
		expect(context.displayMessage).not.toHaveBeenCalled();
		expect(addEntryToSession).toHaveBeenCalledWith(expect.anything(), entry);
		expect(context.hideProgress).toHaveBeenCalled();
	});

	test('no finalize support: removes the partial container and falls back to displayMessage', async () => {
		const { context, addEntryToSession, turn } = makeHarness({ withFinalize: false });
		streamThenFinish(loopResult({ markdown: 'final answer' }));

		await turn();

		const container = context.createFollowUpStream.mock.results[0].value as HTMLElement;
		expect(container.isConnected).toBe(false);
		expect(context.displayMessage).toHaveBeenCalledTimes(1);
		expect(context.displayMessage.mock.calls[0][0]).toMatchObject({ message: 'final answer' });
		expect(addEntryToSession).toHaveBeenCalledTimes(1);
	});

	test('an answer with no thoughts omits the thoughts key entirely', async () => {
		const { context, turn } = makeHarness({ withFinalize: false });
		scriptLoop(undefined, loopResult({ markdown: 'final answer' }));

		await turn();

		expect(context.displayMessage.mock.calls[0][0]).not.toHaveProperty('thoughts');
	});

	test.each([
		['fellBack', loopResult({ markdown: 'no response — tools ran', fellBack: true })],
		['loopAborted', loopResult({ markdown: 'loop detected, turn aborted', loopAborted: true })],
	])('%s notices are displayed but never persisted to session history', async (_label, result) => {
		const { context, addEntryToSession, turn } = makeHarness({ withFinalize: false });
		scriptLoop(undefined, result);

		await turn();

		expect(context.displayMessage).toHaveBeenCalledTimes(1);
		expect(context.displayMessage.mock.calls[0][0]).toMatchObject({ message: result.markdown });
		expect(addEntryToSession).not.toHaveBeenCalled();
	});
});

describe('AgentViewTools.handleToolCalls — thinking label budget counter', () => {
	const plainLabel = t('agent.progress.thinking');

	/** Fire the budget hook (when given) then the follow-up hook, and report the label. */
	async function labelFor(remaining: number | undefined, harness = makeHarness()) {
		scriptLoop(async (hooks) => {
			if (remaining !== undefined) {
				await hooks.onBudgetUpdate?.({ remaining, limit: undefined, extended: false });
			}
			await hooks.onFollowUpRequestStart?.();
		});
		await harness.turn();
		const thinkingCalls = (harness.context.updateProgress.mock.calls as unknown[][]).filter(
			(call) => call[1] === 'thinking'
		);
		return thinkingCalls[thinkingCalls.length - 1]?.[0] as string | undefined;
	}

	test('no budget update: plain label', async () => {
		expect(await labelFor(undefined)).toBe(plainLabel);
	});

	test('an unlimited budget shows the plain label', async () => {
		expect(await labelFor(Infinity)).toBe(plainLabel);
	});

	test('a budget above the reminder threshold shows the plain label', async () => {
		expect(await labelFor(DEFAULT_TURN_BUDGET_REMIND_AT + 1)).toBe(plainLabel);
	});

	test('at or below the reminder threshold the remaining count is appended', async () => {
		expect(await labelFor(DEFAULT_TURN_BUDGET_REMIND_AT)).toBe(
			t('agent.progress.thinkingWithBudget', { thinking: plainLabel, remaining: DEFAULT_TURN_BUDGET_REMIND_AT })
		);
	});

	test('the counter resets between turns', async () => {
		const harness = makeHarness();
		await labelFor(1, harness);
		harness.context.updateProgress.mockClear();

		// Second turn, no budget hook — a stale counter from the previous turn
		// must not leak into this label.
		expect(await labelFor(undefined, harness)).toBe(plainLabel);
	});
});

describe('AgentViewTools.handleToolCalls — mid-loop compaction', () => {
	test('refreshes token usage, then displays and persists the compaction notice', async () => {
		const { context, addEntryToSession, turn } = makeHarness({ withFinalize: false });
		scriptLoop(async (hooks) => {
			await hooks.onMidLoopCompaction?.({ estimatedTokens: 1234, summaryText: 'summary of earlier turns' });
		});

		await turn();

		expect(context.updateTokenUsage).toHaveBeenCalledTimes(1);
		const compactionEntry = context.displayMessage.mock.calls[0][0] as GeminiConversationEntry;
		expect(compactionEntry.message).toContain('[!info] Context Compacted');
		expect(compactionEntry.message).toContain('summary of earlier turns');
		expect(compactionEntry.model).toBe(CHAT_MODEL);
		expect(addEntryToSession).toHaveBeenCalledWith(expect.anything(), compactionEntry);
		// The header refresh reads AgentLoop's post-compaction usage metadata, so
		// it must happen before the notice is rendered.
		expect(context.updateTokenUsage.mock.invocationCallOrder[0]).toBeLessThan(
			context.displayMessage.mock.invocationCallOrder[0]
		);
	});

	test('a compaction with no summary text refreshes usage but renders no notice', async () => {
		const { context, addEntryToSession, turn } = makeHarness({ withFinalize: false });
		scriptLoop(async (hooks) => {
			await hooks.onMidLoopCompaction?.({ estimatedTokens: 1234 });
		});

		await turn();

		expect(context.updateTokenUsage).toHaveBeenCalledTimes(1);
		// Only the final answer is displayed — no compaction notice.
		expect(context.displayMessage).toHaveBeenCalledTimes(1);
		expect(context.displayMessage.mock.calls[0][0]).toMatchObject({ message: 'final answer' });
		expect(addEntryToSession).toHaveBeenCalledTimes(1);
	});
});

describe('AgentViewTools.handleToolCalls — error path', () => {
	test('a throwing loop is logged, clears both containers, and hides progress', async () => {
		const { context, logger, turn } = makeHarness();
		const failure = new Error('loop exploded');
		mocks.run.mockImplementation(async (config: any) => {
			const hooks = config.options.hooks as AgentLoopHooks;
			await hooks.onToolBatchStart?.([TOOL_CALL], 0);
			await hooks.onFollowUpChunk?.({ text: 'partial answer' });
			throw failure;
		});

		await turn();

		expect(logger.error).toHaveBeenCalledWith('[AgentViewTools] Failed to process tool results:', failure);
		const container = context.createFollowUpStream.mock.results[0].value as HTMLElement;
		expect(container.isConnected).toBe(false);
		expect(context.hideProgress).toHaveBeenCalled();

		// The tool group was cleared too, so the next turn opens a fresh one.
		scriptLoop(async (hooks) => {
			await hooks.onToolBatchStart?.([TOOL_CALL], 0);
		});
		await turn();
		expect(mocks.createToolGroup).toHaveBeenCalledTimes(2);
	});
});
