import { describe, test, expect, vi, beforeEach } from 'vitest';
import { Notice } from 'obsidian';
import { AgentViewSend } from '../../../src/ui/agent-view/agent-view-send';

// Regression coverage for the Stop race (#1787, #1790) and the orphaned Allow
// card (#1780). Each turn owns its own token, so a stopped turn that is still
// unwinding can't reset, un-cancel, or steal the Stop target of the next turn.

const NoticeMock = Notice as unknown as ReturnType<typeof vi.fn>;

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

function deferred<T = void>() {
	let resolve!: (v: T) => void;
	const promise = new Promise<T>((r) => (resolve = r));
	return { promise, resolve };
}

/** Let pending microtasks (and a macrotask) run. */
const flush = () => new Promise((r) => setTimeout(r, 0));

function makeSend() {
	const sendButton = makeButton();
	const userInput = document.createElement('div');
	const settlePendingConfirmations = vi.fn();
	const settlePendingPlanApproval = vi.fn();
	const emit = vi.fn().mockResolvedValue(undefined);
	const ctx = {
		plugin: {
			agentEventBus: { emit },
			sessionHistory: { addEntryToSession: vi.fn().mockResolvedValue(undefined) },
			logger: { debug: vi.fn(), log: vi.fn(), warn: vi.fn(), error: vi.fn() },
		},
		getCurrentSession: () => ({ id: 's1' }),
		getUserInput: () => userInput,
		getShelf: () => ({
			getTextFiles: () => [],
			getPendingAttachments: () => [],
			markBinarySent: vi.fn(),
		}),
		getSendButton: () => sendButton,
		progress: { show: vi.fn(), hide: vi.fn(), update: vi.fn() },
		displayMessage: vi.fn().mockResolvedValue(undefined),
		updateTokenUsage: vi.fn().mockResolvedValue(undefined),
		messages: { settlePendingConfirmations, settlePendingPlanApproval },
	} as any;
	const send = new AgentViewSend(ctx);
	// Skip request assembly; each test controls dispatch.
	vi.spyOn(send as any, 'assembleTurnRequest').mockResolvedValue({ aborted: false });
	return { send, ctx, sendButton, userInput, emit, settlePendingConfirmations };
}

describe('AgentViewSend turn ownership', () => {
	beforeEach(() => {
		NoticeMock.mockClear();
	});

	test("a stopped turn's late cleanup leaves the next turn's Stop button alone (#1787, #1790)", async () => {
		const { send, sendButton, userInput, emit } = makeSend();
		// Turn A dispatches at once; turn B stays in flight until released.
		const dispatchB = deferred();
		vi.spyOn(send as any, 'dispatchResponse')
			.mockResolvedValueOnce(undefined)
			.mockReturnValueOnce(dispatchB.promise);

		// Hold turn A's turnEnd handlers pending (e.g. a slow history save).
		const turnEndA = deferred();
		let turnEnds = 0;
		emit.mockImplementation((event: string) => {
			if (event === 'turnEnd' && turnEnds++ === 0) return turnEndA.promise;
			return Promise.resolve();
		});

		userInput.innerText = 'first';
		const turnA = send.sendMessage();
		await flush();

		send.stopAgentLoop();
		expect(send.getIsExecuting()).toBe(false);

		userInput.innerText = 'second';
		const turnB = send.sendMessage();
		await flush();
		expect(send.getIsExecuting()).toBe(true);

		// A's cleanup resumes now, while B is still running.
		turnEndA.resolve();
		await turnA;

		expect(send.getIsExecuting()).toBe(true);
		expect(sendButton.classList.contains('gemini-agent-stop-btn')).toBe(true);

		dispatchB.resolve();
		await turnB;
		expect(send.getIsExecuting()).toBe(false);
	});

	test("a stopped turn keeps seeing its own cancellation after the next turn starts, and can't take B's Stop target", async () => {
		const { send, userInput } = makeSend();
		const turns: any[] = [];
		const releases: Array<() => void> = [];
		const dispatch = (...args: unknown[]): Promise<void> => {
			turns.push(args[3]);
			const d = deferred();
			releases.push(d.resolve);
			return d.promise;
		};
		vi.spyOn(send as any, 'dispatchResponse').mockImplementation(dispatch as any);

		userInput.innerText = 'first';
		const turnA = send.sendMessage();
		await flush();
		send.stopAgentLoop();

		userInput.innerText = 'second';
		const turnB = send.sendMessage();
		await flush();

		const handleA = (send as any).turnHandle(turns[0]);
		const handleB = (send as any).turnHandle(turns[1]);
		expect(handleA.isCancelled()).toBe(true);
		expect(handleB.isCancelled()).toBe(false);

		// B registers a follow-up stream; A settling late clears only its own slot.
		const streamB = { cancel: vi.fn() };
		handleB.registerStream(streamB);
		handleA.registerStream({ cancel: vi.fn() });
		handleA.registerStream(null);

		send.stopAgentLoop();
		expect(streamB.cancel).toHaveBeenCalled();

		releases.forEach((r) => r());
		await Promise.all([turnA, turnB]);
	});

	test('starting a turn while another still owns the button stops it and settles its Allow card (#1780)', async () => {
		const { send, userInput, settlePendingConfirmations } = makeSend();
		const releases: Array<() => void> = [];
		const dispatch = (): Promise<void> => {
			const d = deferred();
			releases.push(d.resolve);
			return d.promise;
		};
		vi.spyOn(send as any, 'dispatchResponse').mockImplementation(dispatch as any);

		userInput.innerText = 'first';
		const turnA = send.sendMessage();
		await flush();
		expect(settlePendingConfirmations).not.toHaveBeenCalled();

		// A programmatic send (no Stop click) while A waits on a confirmation.
		userInput.innerText = 'second';
		const turnB = send.sendMessage();
		await flush();

		expect(settlePendingConfirmations).toHaveBeenCalledTimes(1);
		expect(send.getIsExecuting()).toBe(true);

		releases.forEach((r) => r());
		await Promise.all([turnA, turnB]);
		expect(send.getIsExecuting()).toBe(false);
	});

	test('Stop settles pending tool confirmations', async () => {
		const { send, userInput, settlePendingConfirmations } = makeSend();
		const d = deferred();
		vi.spyOn(send as any, 'dispatchResponse').mockReturnValue(d.promise);

		userInput.innerText = 'first';
		const turn = send.sendMessage();
		await flush();
		send.stopAgentLoop();
		expect(settlePendingConfirmations).toHaveBeenCalledTimes(1);

		d.resolve();
		await turn;
	});

	test('a cancelled stream that settles empty does not add the empty-response notice (#1790)', async () => {
		const { send, ctx } = makeSend();
		const renderEntry = vi.fn();
		const stopped = { cancelled: true, stream: null, toolCallCount: 0 };
		await (send as any).finalizeNoToolCallResponse(
			{ markdown: '' },
			undefined,
			'm',
			{ id: 's1' },
			renderEntry,
			stopped
		);

		expect(NoticeMock).not.toHaveBeenCalled();
		expect(ctx.plugin.logger.warn).not.toHaveBeenCalled();
		expect(ctx.progress.hide).toHaveBeenCalled();
		expect(renderEntry).not.toHaveBeenCalled();
	});

	test("a stopped turn settling empty after the next turn started leaves that turn's progress alone", async () => {
		const { send, ctx, userInput } = makeSend();
		const turns: any[] = [];
		const releases: Array<() => void> = [];
		vi.spyOn(send as any, 'dispatchResponse').mockImplementation(((...args: unknown[]) => {
			turns.push(args[3]);
			const d = deferred();
			releases.push(d.resolve);
			return d.promise;
		}) as any);

		userInput.innerText = 'first';
		const turnA = send.sendMessage();
		await flush();
		send.stopAgentLoop();
		userInput.innerText = 'second';
		const turnB = send.sendMessage();
		await flush();
		ctx.progress.hide.mockClear();

		await (send as any).finalizeNoToolCallResponse({ markdown: '' }, undefined, 'm', { id: 's1' }, vi.fn(), turns[0]);
		expect(ctx.progress.hide).not.toHaveBeenCalled();

		await (send as any).finalizeNoToolCallResponse({ markdown: 'hi' }, undefined, 'm', { id: 's1' }, vi.fn(), turns[1]);
		expect(ctx.progress.hide).toHaveBeenCalledTimes(1);

		releases.forEach((r) => r());
		await Promise.all([turnA, turnB]);
	});

	test('a tool that completes after Stop counts on its own turn, not the next one', async () => {
		const { send, userInput, emit } = makeSend();
		const turns: any[] = [];
		const releases: Array<() => void> = [];
		vi.spyOn(send as any, 'dispatchResponse').mockImplementation(((...args: unknown[]) => {
			turns.push(args[3]);
			const d = deferred();
			releases.push(d.resolve);
			return d.promise;
		}) as any);

		userInput.innerText = 'first';
		const turnA = send.sendMessage();
		await flush();
		send.stopAgentLoop();
		userInput.innerText = 'second';
		const turnB = send.sendMessage();
		await flush();

		(send as any).turnHandle(turns[0]).countTool(1);

		releases.forEach((r) => r());
		await Promise.all([turnA, turnB]);
		const turnEnds = emit.mock.calls.filter(([event]) => event === 'turnEnd').map(([, payload]) => payload);
		expect(turnEnds.map((p: any) => p.toolCallCount)).toEqual([1, 0]);
	});

	test("a stopped turn's handle doesn't hide the next turn's progress", async () => {
		const { send, ctx, userInput } = makeSend();
		const turns: any[] = [];
		const releases: Array<() => void> = [];
		vi.spyOn(send as any, 'dispatchResponse').mockImplementation(((...args: unknown[]) => {
			turns.push(args[3]);
			const d = deferred();
			releases.push(d.resolve);
			return d.promise;
		}) as any);

		userInput.innerText = 'first';
		const turnA = send.sendMessage();
		await flush();
		send.stopAgentLoop();
		userInput.innerText = 'second';
		const turnB = send.sendMessage();
		await flush();
		ctx.progress.hide.mockClear();

		(send as any).turnHandle(turns[0]).hideProgress();
		expect(ctx.progress.hide).not.toHaveBeenCalled();
		(send as any).turnHandle(turns[1]).hideProgress();
		expect(ctx.progress.hide).toHaveBeenCalledTimes(1);

		releases.forEach((r) => r());
		await Promise.all([turnA, turnB]);
	});

	test('a turn stopped before its plan request starts never sends it', async () => {
		const { send } = makeSend();
		const modelApi = { generateStreamingResponse: vi.fn(), generateModelResponse: vi.fn() };
		const stopped = { cancelled: true, stream: null, toolCallCount: 0 };

		const result = await (send as any).conductPlanApproval(modelApi, {}, { id: 's1' }, [], stopped);

		expect(result).toBeNull();
		expect(modelApi.generateStreamingResponse).not.toHaveBeenCalled();
		expect(modelApi.generateModelResponse).not.toHaveBeenCalled();
	});
});
