import { GeminiHistory } from '../../src/history/history';
// import { SessionHistory } from '../../src/agent/session-history';
import type { ChatSession } from '../../src/types/agent';
import type { GeminiConversationEntry } from '../../src/types/conversation';
import { SessionType, DestructiveAction } from '../../src/types/agent';
import { TFile } from 'obsidian';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('obsidian', () => ({
	TFile: vi.fn(),
	normalizePath: vi.fn((p: string) => p),
}));

const mockSessionHistoryInstance = {
	getHistoryForSession: vi.fn(),
	addEntryToSession: vi.fn(),
	updateSessionMetadata: vi.fn(),
	deleteSessionHistory: vi.fn(),
	getAllAgentSessions: vi.fn(),
};

vi.mock('../../src/agent/session-history', () => {
	return {
		SessionHistory: class MockSessionHistory {
			constructor(_plugin: any) {
				// Return the shared mock instance so tests can set up return values
				return mockSessionHistoryInstance as any;
			}
		},
	};
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMockPlugin(overrides: Record<string, any> = {}): any {
	return {
		settings: { chatHistory: true },
		logger: {
			log: vi.fn(),
			debug: vi.fn(),
			error: vi.fn(),
			warn: vi.fn(),
		},
		...overrides,
	};
}

function createMockSession(overrides: Partial<ChatSession> = {}): ChatSession {
	return {
		id: 'test-session-id',
		type: SessionType.AGENT_SESSION,
		title: 'Test Session',
		context: {
			contextFiles: [],
			requireConfirmation: [DestructiveAction.MODIFY_FILES],
		},
		created: new Date('2025-01-01'),
		lastActive: new Date('2025-01-02'),
		historyPath: 'gemini-scribe/Agent-Sessions/test-session.md',
		...overrides,
	};
}

function createMockEntry(overrides: Partial<GeminiConversationEntry> = {}): GeminiConversationEntry {
	return {
		role: 'user',
		message: 'Hello, world!',
		notePath: '',
		created_at: new Date(),
		...overrides,
	};
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GeminiHistory', () => {
	let mockPlugin: any;
	let history: GeminiHistory;

	beforeEach(() => {
		// Reset mock call counts but keep implementations
		mockSessionHistoryInstance.getHistoryForSession.mockReset();
		mockSessionHistoryInstance.addEntryToSession.mockReset();
		mockSessionHistoryInstance.updateSessionMetadata.mockReset();
		mockSessionHistoryInstance.deleteSessionHistory.mockReset();
		mockSessionHistoryInstance.getAllAgentSessions.mockReset();

		mockPlugin = createMockPlugin();
		history = new GeminiHistory(mockPlugin);
	});

	describe('constructor', () => {
		it('creates a GeminiHistory instance successfully', () => {
			expect(history).toBeDefined();
		});
	});

	describe('setupHistoryCommands', () => {
		it('returns early when chatHistory is disabled', async () => {
			mockPlugin.settings.chatHistory = false;
			await history.setupHistoryCommands();
			// No error thrown, method exits early
		});

		it('completes without error when chatHistory is enabled', async () => {
			mockPlugin.settings.chatHistory = true;
			await expect(history.setupHistoryCommands()).resolves.toBeUndefined();
		});
	});

	describe('onLayoutReady', () => {
		it('completes without error', async () => {
			await expect(history.onLayoutReady()).resolves.toBeUndefined();
		});
	});

	describe('onUnload', () => {
		it('completes without error', async () => {
			await expect(history.onUnload()).resolves.toBeUndefined();
		});
	});

	describe('getHistoryForSession', () => {
		it('delegates to SessionHistory.getHistoryForSession', async () => {
			const session = createMockSession();
			const mockEntries: GeminiConversationEntry[] = [createMockEntry()];
			mockSessionHistoryInstance.getHistoryForSession.mockResolvedValue(mockEntries);

			const result = await history.getHistoryForSession(session);

			expect(mockSessionHistoryInstance.getHistoryForSession).toHaveBeenCalledWith(session);
			expect(result).toBe(mockEntries);
		});
	});

	describe('addEntryToSession', () => {
		it('delegates to SessionHistory.addEntryToSession', async () => {
			const session = createMockSession();
			const entry = createMockEntry();
			mockSessionHistoryInstance.addEntryToSession.mockResolvedValue(undefined);

			await history.addEntryToSession(session, entry);

			expect(mockSessionHistoryInstance.addEntryToSession).toHaveBeenCalledWith(session, entry, undefined);
		});

		it('passes explicitTimestamp to SessionHistory.addEntryToSession', async () => {
			const session = createMockSession();
			const entry = createMockEntry();
			const timestamp = new Date('2025-06-15T12:00:00Z');
			mockSessionHistoryInstance.addEntryToSession.mockResolvedValue(undefined);

			await history.addEntryToSession(session, entry, timestamp);

			expect(mockSessionHistoryInstance.addEntryToSession).toHaveBeenCalledWith(session, entry, timestamp);
		});
	});

	describe('updateSessionMetadata', () => {
		it('delegates to SessionHistory.updateSessionMetadata', async () => {
			const session = createMockSession();
			mockSessionHistoryInstance.updateSessionMetadata.mockResolvedValue(undefined);

			await history.updateSessionMetadata(session);

			expect(mockSessionHistoryInstance.updateSessionMetadata).toHaveBeenCalledWith(session);
		});
	});

	describe('deleteSessionHistory', () => {
		it('delegates to SessionHistory.deleteSessionHistory', async () => {
			const session = createMockSession();
			mockSessionHistoryInstance.deleteSessionHistory.mockResolvedValue(undefined);

			await history.deleteSessionHistory(session);

			expect(mockSessionHistoryInstance.deleteSessionHistory).toHaveBeenCalledWith(session);
		});
	});

	describe('getAllAgentSessions', () => {
		it('delegates to SessionHistory.getAllAgentSessions', async () => {
			const mockFiles = [new TFile(), new TFile()];
			mockSessionHistoryInstance.getAllAgentSessions.mockResolvedValue(mockFiles);

			const result = await history.getAllAgentSessions();

			expect(mockSessionHistoryInstance.getAllAgentSessions).toHaveBeenCalled();
			expect(result).toBe(mockFiles);
		});
	});
});
