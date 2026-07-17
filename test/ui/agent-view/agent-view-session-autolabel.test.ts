import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentViewSession } from '../../../src/ui/agent-view/agent-view-session';

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
// The rename must resolve a numeric-suffixed path instead, retry when a
// concurrent writer occupies the candidate mid-flight, and skip entirely
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
	const logWarn = vi.fn();
	const plugin = {
		// No agentEventBus — the constructor's optional chaining tolerates it.
		agentEventBus: undefined,
		settings: {},
		logger: { log: vi.fn(), error: logError, warn: logWarn },
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

	return { manager, session, existing, renameFile, logError, logWarn };
}

describe('AgentViewSession.autoLabelSessionIfNeeded rename collisions', () => {
	// The generated file name embeds formatLocalDate() evaluated inside
	// autoLabelSessionIfNeeded — pin the clock so the expected paths cannot
	// drift if a test run crosses midnight.
	const datePrefix = '2026-07-16';
	const generatedTitle = 'My Topic';
	const targetPath = `${SESSIONS_DIR}${datePrefix} ${generatedTitle}.md`;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 6, 16, 12, 0, 0));
		generateModelResponse.mockReset();
		generateModelResponse.mockResolvedValue({ markdown: generatedTitle });
	});

	afterEach(() => {
		vi.useRealTimers();
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

	test('retries when a concurrent writer occupies the target mid-flight', async () => {
		// resolveUniquePath + renameFile is non-atomic: the target is free at
		// check time, but another writer lands it before renameFile runs.
		const oldPath = `${SESSIONS_DIR}Agent Session 1.md`;
		const { manager, session, existing, renameFile, logError } = makeHarness([], oldPath);
		renameFile.mockImplementationOnce(async () => {
			existing.add(targetPath); // concurrent writer wins the race
			throw new Error('Destination file already exists!');
		});

		await manager.autoLabelSessionIfNeeded();

		const suffixedPath = `${SESSIONS_DIR}${datePrefix} ${generatedTitle}-1.md`;
		expect(renameFile).toHaveBeenCalledTimes(2);
		expect(renameFile).toHaveBeenNthCalledWith(1, expect.anything(), targetPath);
		expect(renameFile).toHaveBeenNthCalledWith(2, expect.anything(), suffixedPath);
		expect(session.historyPath).toBe(suffixedPath);
		expect(logError).not.toHaveBeenCalled();
	});

	test('gives up gracefully after repeated mid-flight collisions', async () => {
		const oldPath = `${SESSIONS_DIR}Agent Session 1.md`;
		const { manager, session, renameFile, logError, logWarn } = makeHarness([], oldPath);
		renameFile.mockRejectedValue(new Error('Destination file already exists!'));

		await manager.autoLabelSessionIfNeeded();

		expect(renameFile).toHaveBeenCalledTimes(3);
		// Rename skipped, but the title and metadata still updated.
		expect(session.historyPath).toBe(oldPath);
		expect(session.title).toBe(`${datePrefix} ${generatedTitle}`);
		expect(logWarn).toHaveBeenCalled();
		expect(logError).not.toHaveBeenCalled();
	});

	test('does not retry or swallow non-collision rename errors', async () => {
		const oldPath = `${SESSIONS_DIR}Agent Session 1.md`;
		const { manager, session, renameFile, logError } = makeHarness([], oldPath);
		renameFile.mockRejectedValue(new Error('EACCES: permission denied'));

		await manager.autoLabelSessionIfNeeded();

		// A single attempt only — the error propagates to the catch-all logger.
		expect(renameFile).toHaveBeenCalledTimes(1);
		expect(session.historyPath).toBe(oldPath);
		expect(logError).toHaveBeenCalled();
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
