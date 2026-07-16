import { describe, test, expect, vi, beforeEach } from 'vitest';
import { AgentViewSession } from '../../../src/ui/agent-view/agent-view-session';
import { formatLocalDate } from '../../../src/utils/format-utils';

// Mock the model factory so autoLabelSessionIfNeeded gets a deterministic
// generated title without touching a real API client.
const generateModelResponse = vi.fn();
vi.mock('../../../src/api', () => ({
	ModelClientFactory: {
		createChatModel: vi.fn(() => ({ generateModelResponse })),
	},
}));

vi.mock('../../../src/models', () => ({
	getActiveChatModel: vi.fn(() => 'test-model'),
}));

// Regression coverage for the auto-label rename collision: when the
// AI-generated title matches an existing file in Agent-Sessions/,
// fileManager.renameFile used to throw "Destination file already exists!".
// The rename must resolve a numeric-suffixed path instead, and skip entirely
// when the file already carries the generated name.

const SESSIONS_DIR = 'gemini-scribe/Agent-Sessions/';

function makeHarness(existingPaths: string[], oldPath: string) {
	const existing = new Set([oldPath, ...existingPaths]);
	const renameFile = vi.fn(async (_file: unknown, newPath: string) => {
		if (existing.has(newPath)) throw new Error('Destination file already exists!');
		existing.add(newPath);
	});
	const app = {
		vault: {
			getAbstractFileByPath: vi.fn((path: string) => (existing.has(path) ? { path } : null)),
		},
		fileManager: { renameFile },
	} as any;

	const logError = vi.fn();
	const plugin = {
		// No agentEventBus — the constructor's optional chaining tolerates it.
		agentEventBus: undefined,
		settings: {},
		logger: { log: vi.fn(), error: logError, warn: vi.fn() },
		sessionHistory: {
			getHistoryForSession: vi.fn(async () => [
				{ role: 'user', message: 'hello' },
				{ role: 'model', message: 'hi there' },
			]),
			updateSessionMetadata: vi.fn(async () => undefined),
		},
	} as any;

	const uiCallbacks = {
		clearChat: vi.fn(),
		displayMessage: vi.fn(),
		updateSessionHeader: vi.fn(),
		updateContextPanel: vi.fn(),
		showEmptyState: vi.fn(),
		focusInput: vi.fn(),
	};
	const state = { allowedWithoutConfirmation: new Set<string>(), userInput: null as any };

	const manager = new AgentViewSession(app, plugin, uiCallbacks, state);
	const session = {
		id: 's1',
		title: 'Agent Session 2026-07-16',
		metadata: {},
		historyPath: oldPath,
		context: { contextFiles: [] },
	} as any;
	manager.setCurrentSession(session);

	return { manager, session, renameFile, logError };
}

describe('AgentViewSession.autoLabelSessionIfNeeded rename collisions', () => {
	const datePrefix = formatLocalDate();
	const generatedTitle = 'My Topic';
	const targetPath = `${SESSIONS_DIR}${datePrefix} ${generatedTitle}.md`;

	beforeEach(() => {
		generateModelResponse.mockReset();
		generateModelResponse.mockResolvedValue({ markdown: generatedTitle });
	});

	test('renames to the generated title when the target path is free', async () => {
		const oldPath = `${SESSIONS_DIR}Agent Session 1.md`;
		const { manager, session, renameFile, logError } = makeHarness([], oldPath);

		await manager.autoLabelSessionIfNeeded();

		expect(renameFile).toHaveBeenCalledWith(expect.objectContaining({ path: oldPath }), targetPath);
		expect(session.historyPath).toBe(targetPath);
		expect(session.title).toBe(`${datePrefix} ${generatedTitle}`);
		expect(logError).not.toHaveBeenCalled();
	});

	test('appends a numeric suffix when the target path already exists', async () => {
		const oldPath = `${SESSIONS_DIR}Agent Session 1.md`;
		const { manager, session, renameFile, logError } = makeHarness([targetPath], oldPath);

		await manager.autoLabelSessionIfNeeded();

		const suffixedPath = `${SESSIONS_DIR}${datePrefix} ${generatedTitle}-1.md`;
		expect(renameFile).toHaveBeenCalledWith(expect.objectContaining({ path: oldPath }), suffixedPath);
		expect(session.historyPath).toBe(suffixedPath);
		// The rename must not have thrown into the catch-all error handler.
		expect(logError).not.toHaveBeenCalled();
	});

	test('skips past multiple occupied suffixes', async () => {
		const oldPath = `${SESSIONS_DIR}Agent Session 1.md`;
		const stem = `${SESSIONS_DIR}${datePrefix} ${generatedTitle}`;
		const { manager, session, renameFile } = makeHarness([targetPath, `${stem}-1.md`, `${stem}-2.md`], oldPath);

		await manager.autoLabelSessionIfNeeded();

		expect(renameFile).toHaveBeenCalledWith(expect.anything(), `${stem}-3.md`);
		expect(session.historyPath).toBe(`${stem}-3.md`);
	});

	test('skips the rename when the file already has the generated name', async () => {
		// The session file already carries the generated title — renaming would
		// self-collide (the "existing file" is the file being renamed).
		const oldPath = targetPath;
		const { manager, session, renameFile, logError } = makeHarness([], oldPath);

		await manager.autoLabelSessionIfNeeded();

		expect(renameFile).not.toHaveBeenCalled();
		expect(session.historyPath).toBe(oldPath);
		// Title and metadata still update even though no rename was needed.
		expect(session.title).toBe(`${datePrefix} ${generatedTitle}`);
		expect(session.metadata.autoLabeled).toBe(true);
		expect(logError).not.toHaveBeenCalled();
	});
});
