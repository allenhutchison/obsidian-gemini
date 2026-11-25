import { describe, test, expect, vi, beforeEach } from 'vitest';
import { Notice } from 'obsidian';
import { AgentViewSend, loadProjectInstructions } from '../../../src/ui/agent-view/agent-view-send';
import type { GeminiConversationEntry } from '../../../src/types/conversation';
import type { InlineAttachment } from '../../../src/ui/agent-view/inline-attachment';
import { GEMINI_MODELS, setGeminiModels } from '../../../src/models';

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

// Unit coverage for the project-instruction assembly phase (#1506). The
// discovery-scope statement is folded into `projectInstructions` so it rides
// the byte-stable PerTurnContext threading to every model call in a turn.

describe('loadProjectInstructions', () => {
	function makePlugin(project?: { instructions?: string; rootPath?: string }, getProjectError?: Error) {
		const getProject = vi.fn(async () => {
			if (getProjectError) throw getProjectError;
			return project;
		});
		const logger = { log: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() };
		const plugin = { projectManager: { getProject }, logger };
		return { plugin, getProject, logger };
	}

	test('appends the scope statement with the project root to existing instructions', async () => {
		const { plugin } = makePlugin({ instructions: 'Keep it terse.', rootPath: 'projects/my-app' });

		const result = await loadProjectInstructions(
			plugin as unknown as Parameters<typeof loadProjectInstructions>[0],
			'projects/my-app.md'
		);

		expect(result).toContain('Keep it terse.');
		expect(result).toContain('`projects/my-app`');
		expect(result).toContain('rejected with an error');
		// Instructions first, scope statement after, separated by a blank line.
		expect(result?.indexOf('Keep it terse.')).toBeLessThan(result?.indexOf('`projects/my-app`') ?? Infinity);
	});

	test('returns the scope statement alone when the project has no instructions', async () => {
		const { plugin } = makePlugin({ instructions: '', rootPath: 'projects/my-app' });

		const result = await loadProjectInstructions(
			plugin as unknown as Parameters<typeof loadProjectInstructions>[0],
			'projects/my-app.md'
		);

		expect(result).toContain('`projects/my-app`');
		expect(result).not.toContain('\n\n');
	});

	test('states discovery is vault-wide for a vault-root project', async () => {
		const { plugin } = makePlugin({ rootPath: '' });

		const result = await loadProjectInstructions(
			plugin as unknown as Parameters<typeof loadProjectInstructions>[0],
			'project.md'
		);

		expect(result).toContain('vault root');
		expect(result).not.toContain('rejected');
	});

	test('returns undefined when the session has no linked project', async () => {
		const { plugin } = makePlugin();

		const result = await loadProjectInstructions(
			plugin as unknown as Parameters<typeof loadProjectInstructions>[0],
			undefined
		);

		expect(result).toBeUndefined();
		expect(plugin.projectManager.getProject).not.toHaveBeenCalled();
	});

	test('returns undefined when the project file no longer exists', async () => {
		const { plugin } = makePlugin(undefined);

		const result = await loadProjectInstructions(
			plugin as unknown as Parameters<typeof loadProjectInstructions>[0],
			'projects/deleted.md'
		);

		expect(result).toBeUndefined();
	});

	test('logs and returns undefined when loading fails, keeping the prompt renderable', async () => {
		const boom = new Error('read failed');
		const { plugin, logger } = makePlugin(undefined, boom);

		const result = await loadProjectInstructions(
			plugin as unknown as Parameters<typeof loadProjectInstructions>[0],
			'projects/my-app.md'
		);

		expect(result).toBeUndefined();
		expect(logger.error).toHaveBeenCalledWith('Error loading project instructions:', boom);
	});
});

// A turn resolves its chat model once (#1679). With none to resolve (a provider
// whose model list hasn't loaded, nothing picked), an empty request model would
// make each client re-read the model from live settings, so the send stops
// before it clears the input, saves anything or builds a client.
function makeSendMessageCtx(chatModel: string) {
	const progress = { show: vi.fn(), hide: vi.fn() };
	const none = { provider: 'none', model: '' };
	const addEntryToSession = vi.fn();
	const ctx = {
		getCurrentSession: () => ({ id: 's1' }),
		getUserInput: () => ({ innerText: 'hi' }),
		getShelf: () => ({ getTextFiles: () => [], getPendingAttachments: () => [] }),
		displayMessage: vi.fn().mockResolvedValue(undefined),
		updateTokenUsage: vi.fn().mockResolvedValue(undefined),
		progress,
		plugin: {
			logger: { error: vi.fn() },
			settings: {
				features: {
					chat: { provider: 'ollama', model: chatModel },
					summary: none,
					completions: none,
					rewrite: none,
					webSearch: none,
					deepResearch: none,
					rag: none,
					imageGen: none,
				},
			},
			sessionHistory: { addEntryToSession },
		},
	} as any;
	const send = new AgentViewSend(ctx);
	const internals = send as any;
	const capture = vi.spyOn(internals, 'captureTurnInput').mockResolvedValue({
		turnTimestamp: new Date(),
		message: 'hi',
		savedAttachments: [],
	});
	// Stand in for the Stop-button UI while still registering the turn, so
	// the turn-scoped progress and cleanup paths run as they do for real.
	vi.spyOn(internals, 'beginExecutionUi').mockImplementation(() => {
		const turn = { cancelled: false, stream: null, toolCallCount: 0 };
		internals.activeTurn = turn;
		return turn;
	});
	vi.spyOn(internals, 'resetExecutionUiState').mockImplementation(() => {});
	return { send, internals, progress, capture, addEntryToSession, ctx };
}

describe('AgentViewSend.sendMessage model snapshot', () => {
	beforeEach(() => {
		NoticeMock.mockClear();
	});

	test('with no chat model, notifies and stops before touching the input or history', async () => {
		const { send, internals, progress, capture, addEntryToSession } = makeSendMessageCtx('');
		const assemble = vi.spyOn(internals, 'assembleTurnRequest');

		await send.sendMessage();

		expect(NoticeMock).toHaveBeenCalledWith(
			'No chat model is selected. Choose a chat model in settings, or wait for the model list to load.'
		);
		expect(capture).not.toHaveBeenCalled();
		expect(progress.show).not.toHaveBeenCalled();
		expect(assemble).not.toHaveBeenCalled();
		expect(addEntryToSession).not.toHaveBeenCalled();
	});

	test('passes the pinned model config to turn assembly', async () => {
		const { send, internals } = makeSendMessageCtx('llama3.2');
		const assemble = vi.spyOn(internals, 'assembleTurnRequest').mockRejectedValue(new Error('stop'));

		await send.sendMessage();

		expect(assemble).toHaveBeenCalledTimes(1);
		expect(assemble.mock.calls[0][8]).toEqual({ model: 'llama3.2', provider: 'ollama' });
	});

	test("loads a pinned provider's models before resolving the turn model (#1679)", async () => {
		const { send, internals, ctx } = makeSendMessageCtx('llama3.2');
		const order: string[] = [];
		const session = { id: 's1', modelConfig: { provider: 'anthropic' } };
		ctx.getCurrentSession = () => session;
		ctx.getUserInput = () => {
			order.push('read-input');
			return { innerText: 'hi' };
		};
		ctx.plugin.getModelManager = () => ({
			ensureProviderModels: vi.fn(async (p: string) => {
				order.push(`ensure:${p}`);
				setGeminiModels([...original, { value: 'claude-test', label: 'Claude', provider: 'anthropic' }]);
			}),
		});
		const assemble = vi.spyOn(internals, 'assembleTurnRequest').mockRejectedValue(new Error('stop'));
		const original = [...GEMINI_MODELS];

		try {
			await send.sendMessage();
		} finally {
			setGeminiModels(original);
		}

		// The input is read only after the wait, so one value feeds the whole turn.
		expect(order[0]).toBe('ensure:anthropic');
		expect(order.slice(1).every((o) => o === 'read-input')).toBe(true);
		expect(assemble.mock.calls[0][8]).toEqual({ model: 'claude-test', provider: 'anthropic' });
	});

	test('drops the send when the session changes while provider models load', async () => {
		const { send, internals, ctx, capture } = makeSendMessageCtx('llama3.2');
		let session: any = { id: 's1', modelConfig: { provider: 'anthropic' } };
		ctx.getCurrentSession = () => session;
		const getUserInput = vi.fn(() => ({ innerText: 'other session draft' }));
		ctx.getUserInput = getUserInput;
		ctx.plugin.getModelManager = () => ({
			ensureProviderModels: vi.fn(async () => {
				session = { id: 's2' };
			}),
		});
		const assemble = vi.spyOn(internals, 'assembleTurnRequest');

		await send.sendMessage();

		expect(getUserInput).not.toHaveBeenCalled();
		expect(capture).not.toHaveBeenCalled();
		expect(assemble).not.toHaveBeenCalled();
	});

	test('hides progress when turn assembly fails', async () => {
		const { send, internals, progress } = makeSendMessageCtx('llama3.2');
		vi.spyOn(internals, 'assembleTurnRequest').mockRejectedValue(new Error('boom'));
		const dispatch = vi.spyOn(internals, 'dispatchResponse');

		await send.sendMessage();

		expect(progress.show).toHaveBeenCalled();
		expect(progress.hide).toHaveBeenCalled();
		expect(dispatch).not.toHaveBeenCalled();
		expect(NoticeMock).toHaveBeenCalledTimes(1);
	});
});
