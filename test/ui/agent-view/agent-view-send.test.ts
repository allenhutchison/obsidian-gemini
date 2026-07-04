import { describe, test, expect, vi, beforeEach } from 'vitest';
import { Notice } from 'obsidian';
import { AgentViewSend } from '../../../src/ui/agent-view/agent-view-send';
import type { GeminiConversationEntry } from '../../../src/types/conversation';

// Unit coverage for the shared `finalizeNoToolCallResponse` helper extracted from
// the streaming and non-streaming send paths (#1102). It owns the three-way
// branch (answer / reasoning-only / empty); the per-path render step is supplied
// by the caller, so these tests drive it with a stub render callback and assert
// the shared work: entry construction, history persistence, and progress hiding.

const NoticeMock = Notice as unknown as ReturnType<typeof vi.fn>;

function makeCtx() {
	const addEntryToSession = vi.fn().mockResolvedValue(undefined);
	const hide = vi.fn();
	const warn = vi.fn();
	const ctx = {
		plugin: {
			sessionHistory: { addEntryToSession },
			logger: { warn },
		},
		progress: { hide },
	} as any;
	return { ctx, addEntryToSession, hide, warn };
}

const session = { id: 's1' } as any;

// Invoke the private helper under test without widening its visibility.
function finalize(
	send: AgentViewSend,
	response: { markdown: string },
	turnThoughts: string | undefined,
	modelName: string,
	renderEntry: (entry: GeminiConversationEntry, reasoningOnly: boolean) => Promise<void>
): Promise<void> {
	return (send as any).finalizeNoToolCallResponse(response, turnThoughts, modelName, session, renderEntry);
}

describe('AgentViewSend.finalizeNoToolCallResponse', () => {
	beforeEach(() => {
		NoticeMock.mockClear();
	});

	test('answer text: builds entry, renders with reasoningOnly=false, persists, hides progress', async () => {
		const { ctx, addEntryToSession, hide } = makeCtx();
		const send = new AgentViewSend(ctx);
		const calls: Array<{ entry: GeminiConversationEntry; reasoningOnly: boolean }> = [];
		const renderEntry = vi.fn(async (entry: GeminiConversationEntry, reasoningOnly: boolean) => {
			calls.push({ entry, reasoningOnly });
		});

		await finalize(send, { markdown: 'hello world' }, 'my reasoning', 'gemini-3-flash', renderEntry);

		expect(renderEntry).toHaveBeenCalledTimes(1);
		expect(calls[0].reasoningOnly).toBe(false);
		expect(calls[0].entry.role).toBe('model');
		expect(calls[0].entry.message).toBe('hello world');
		expect(calls[0].entry.model).toBe('gemini-3-flash');
		expect(calls[0].entry.thoughts).toBe('my reasoning');
		// The exact entry that was rendered is the one persisted to history.
		expect(addEntryToSession).toHaveBeenCalledWith(session, calls[0].entry);
		expect(hide).toHaveBeenCalledTimes(1);
		expect(NoticeMock).not.toHaveBeenCalled();
	});

	test('answer text without thoughts omits the thoughts field', async () => {
		const { ctx } = makeCtx();
		const send = new AgentViewSend(ctx);
		let captured: GeminiConversationEntry | undefined;

		await finalize(send, { markdown: 'hi' }, undefined, 'm', async (entry) => {
			captured = entry;
		});

		expect(captured).toBeDefined();
		expect('thoughts' in (captured as object)).toBe(false);
	});

	test('reasoning only (whitespace answer): renders with reasoningOnly=true, persists, hides progress', async () => {
		const { ctx, addEntryToSession, hide } = makeCtx();
		const send = new AgentViewSend(ctx);
		let captured: { entry: GeminiConversationEntry; reasoningOnly: boolean } | undefined;
		const renderEntry = vi.fn(async (entry: GeminiConversationEntry, reasoningOnly: boolean) => {
			captured = { entry, reasoningOnly };
		});

		// Whitespace-only markdown counts as "no answer" and falls to the reasoning branch.
		await finalize(send, { markdown: '   ' }, 'deep thoughts', 'm', renderEntry);

		expect(renderEntry).toHaveBeenCalledTimes(1);
		expect(captured!.reasoningOnly).toBe(true);
		expect(captured!.entry.message).toBe('');
		expect(captured!.entry.thoughts).toBe('deep thoughts');
		expect(addEntryToSession).toHaveBeenCalledWith(session, captured!.entry);
		expect(hide).toHaveBeenCalledTimes(1);
		expect(NoticeMock).not.toHaveBeenCalled();
	});

	test('empty response (no answer, no thoughts): warns, shows notice, hides progress, saves and renders nothing', async () => {
		const { ctx, addEntryToSession, hide, warn } = makeCtx();
		const send = new AgentViewSend(ctx);
		const renderEntry = vi.fn();

		await finalize(send, { markdown: '' }, undefined, 'm', renderEntry);

		expect(renderEntry).not.toHaveBeenCalled();
		expect(addEntryToSession).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalledWith('Model returned empty response');
		expect(NoticeMock).toHaveBeenCalledTimes(1);
		expect(hide).toHaveBeenCalledTimes(1);
	});
});
