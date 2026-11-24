import { describe, test, expect, vi } from 'vitest';
import { AgentViewSend } from '../../../src/ui/agent-view/agent-view-send';

// `turnEnd` reports how each turn ended (#1806). The agent-turn hook trigger
// and users' prompts read these values, so every way a turn can end is pinned.

function makeButton(): HTMLButtonElement {
	const btn = document.createElement('button') as any;
	btn.empty = function () {
		this.innerHTML = '';
	};
	btn.addClass = function (c: string) {
		this.classList.add(c);
	};
	btn.removeClass = function (c: string) {
		this.classList.remove(c);
	};
	return btn;
}

function makeSend() {
	const userInput = document.createElement('div');
	const emit = vi.fn().mockResolvedValue(undefined);
	const ctx = {
		plugin: {
			agentEventBus: { emit },
			sessionHistory: { addEntryToSession: vi.fn().mockResolvedValue(undefined) },
			logger: { debug: vi.fn(), log: vi.fn(), warn: vi.fn(), error: vi.fn() },
		},
		getCurrentSession: () => ({ id: 's1', title: 'Session' }),
		getUserInput: () => userInput,
		getShelf: () => ({
			getTextFiles: () => [],
			getPendingAttachments: () => [],
			markBinarySent: vi.fn(),
		}),
		getSendButton: () => makeButton(),
		progress: { show: vi.fn(), hide: vi.fn(), update: vi.fn() },
		displayMessage: vi.fn().mockResolvedValue(undefined),
		updateTokenUsage: vi.fn().mockResolvedValue(undefined),
		messages: { settlePendingConfirmations: vi.fn(), settlePendingPlanApproval: vi.fn() },
	} as any;
	const send = new AgentViewSend(ctx);
	vi.spyOn(send as any, 'assembleTurnRequest').mockResolvedValue({ aborted: false });
	return { send, userInput, emit };
}

/**
 * Run one turn whose dispatch step is `dispatch` (it gets the turn token and
 * the send instance) and return the `turnEnd` payload.
 */
async function turnEndFor(dispatch: (turn: any, send: AgentViewSend) => Promise<void> | void) {
	const { send, userInput, emit } = makeSend();
	const dispatchImpl = async (...args: unknown[]): Promise<void> => {
		await dispatch(args[3], send);
	};
	vi.spyOn(send as any, 'dispatchResponse').mockImplementation(dispatchImpl as any);
	userInput.innerText = 'do the thing';
	await send.sendMessage();
	const payloads = emit.mock.calls.filter(([event]) => event === 'turnEnd').map(([, p]) => p);
	expect(payloads).toHaveLength(1);
	return payloads[0];
}

describe('AgentViewSend turnEnd outcome', () => {
	test('complete when the turn recorded a final answer', async () => {
		const payload = await turnEndFor((turn) => {
			turn.result = 'complete';
		});
		expect(payload.outcome).toBe('complete');
	});

	test('incomplete when the turn ended without a final answer', async () => {
		const payload = await turnEndFor(() => {});
		expect(payload.outcome).toBe('incomplete');
	});

	test('carries what the tool loop reported through the turn handle', async () => {
		const payload = await turnEndFor((turn, send) => {
			(send as any).turnHandle(turn).reportOutcome('failed');
		});
		expect(payload.outcome).toBe('failed');
	});

	test('failed when dispatch throws', async () => {
		const payload = await turnEndFor(() => {
			throw new Error('API down');
		});
		expect(payload.outcome).toBe('failed');
	});

	test('cancelled when the user pressed Stop', async () => {
		const payload = await turnEndFor((turn, send) => {
			turn.result = 'complete';
			send.stopAgentLoop();
		});
		expect(payload.outcome).toBe('cancelled');
	});

	test('cancelled wins when a stopped turn also throws while unwinding', async () => {
		const payload = await turnEndFor((_turn, send) => {
			send.stopAgentLoop();
			throw new Error('stream aborted');
		});
		expect(payload.outcome).toBe('cancelled');
	});

	test("carries the user's message and the tool-call count", async () => {
		const payload = await turnEndFor((turn) => {
			turn.toolCallCount = 2;
			turn.result = 'complete';
		});
		expect(payload.userMessage).toBe('do the thing');
		expect(payload.toolCallCount).toBe(2);
	});
});
