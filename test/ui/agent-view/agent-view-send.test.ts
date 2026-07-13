import { describe, test, expect, vi, beforeEach } from 'vitest';
import { Notice } from 'obsidian';
import { AgentViewSend } from '../../../src/ui/agent-view/agent-view-send';
import type { GeminiConversationEntry } from '../../../src/types/conversation';
import type { InlineAttachment } from '../../../src/ui/agent-view/inline-attachment';

// Mock the vault-persistence helper so the attachment-persistence phase can be
// driven without a real Obsidian vault. The rest of the module (types/helpers)
// is preserved via importActual.
const saveAttachmentToVault = vi.fn();
vi.mock('../../../src/ui/agent-view/inline-attachment', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../../src/ui/agent-view/inline-attachment')>();
	return { ...actual, saveAttachmentToVault };
});

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

// Unit coverage for the `persistAttachments` phase extracted from `sendMessage`
// (#1196). It writes not-yet-saved attachments to the vault, skips ones already
// carrying a `vaultPath` (e.g. from drag-drop), and reports save failures to the
// user while still returning the successes. Previously this was only reachable by
// driving the whole ~540-line `sendMessage`.

function makeAttachment(id: string, vaultPath?: string): InlineAttachment {
	return { base64: 'AAAA', mimeType: 'image/png', id, vaultPath };
}

// Invoke the private helper under test without widening its visibility.
function persist(send: AgentViewSend, attachments: InlineAttachment[]) {
	return (send as any).persistAttachments(attachments) as Promise<
		Array<{ attachment: InlineAttachment; path: string }>
	>;
}

describe('AgentViewSend.persistAttachments', () => {
	beforeEach(() => {
		NoticeMock.mockClear();
		saveAttachmentToVault.mockReset();
	});

	function makeSendCtx() {
		const error = vi.fn();
		const app = { name: 'app' };
		const ctx = { app, plugin: { logger: { error } } } as any;
		return { send: new AgentViewSend(ctx), app, error };
	}

	test('saves not-yet-persisted attachments to the vault and returns their paths', async () => {
		const { send, app } = makeSendCtx();
		saveAttachmentToVault.mockResolvedValueOnce('vault/a.png').mockResolvedValueOnce('vault/b.png');
		const a = makeAttachment('a');
		const b = makeAttachment('b');

		const result = await persist(send, [a, b]);

		expect(saveAttachmentToVault).toHaveBeenCalledTimes(2);
		expect(saveAttachmentToVault).toHaveBeenNthCalledWith(1, app, a);
		expect(saveAttachmentToVault).toHaveBeenNthCalledWith(2, app, b);
		expect(result).toEqual([
			{ attachment: a, path: 'vault/a.png' },
			{ attachment: b, path: 'vault/b.png' },
		]);
		// The saved path is recorded back onto the attachment.
		expect(a.vaultPath).toBe('vault/a.png');
		expect(b.vaultPath).toBe('vault/b.png');
		expect(NoticeMock).not.toHaveBeenCalled();
	});

	test('skips attachments already in the vault (drag-drop) without re-saving', async () => {
		const { send } = makeSendCtx();
		const dropped = makeAttachment('d', 'vault/dropped.png');

		const result = await persist(send, [dropped]);

		expect(saveAttachmentToVault).not.toHaveBeenCalled();
		expect(result).toEqual([{ attachment: dropped, path: 'vault/dropped.png' }]);
		expect(NoticeMock).not.toHaveBeenCalled();
	});

	test('a save failure is logged and notified; the attachment is omitted but others still return', async () => {
		const { send, error } = makeSendCtx();
		const boom = new Error('disk full');
		saveAttachmentToVault.mockRejectedValueOnce(boom).mockResolvedValueOnce('vault/ok.png');
		const bad = makeAttachment('bad');
		const good = makeAttachment('good');

		const result = await persist(send, [bad, good]);

		expect(result).toEqual([{ attachment: good, path: 'vault/ok.png' }]);
		expect(bad.vaultPath).toBeUndefined();
		expect(error).toHaveBeenCalledWith('Failed to save attachment to vault:', boom);
		// The failure surfaces to the user as a notice (attachment still sent to the model).
		expect(NoticeMock).toHaveBeenCalledTimes(1);
	});

	test('empty input returns an empty list and touches nothing', async () => {
		const { send } = makeSendCtx();

		const result = await persist(send, []);

		expect(result).toEqual([]);
		expect(saveAttachmentToVault).not.toHaveBeenCalled();
		expect(NoticeMock).not.toHaveBeenCalled();
	});
});
