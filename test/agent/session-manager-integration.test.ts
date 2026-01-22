import { SessionManager } from '../../src/agent/session-manager';
import { SessionHistory } from '../../src/agent/session-history';
import { SessionType, ToolCategory, DestructiveAction } from '../../src/types/agent';
import { TFile, TFolder } from 'obsidian';

// Mock Obsidian
jest.mock('obsidian', () => ({
	...jest.requireActual('../../__mocks__/obsidian.js'),
	Notice: jest.fn(),
	normalizePath: jest.fn((path: string) => path),
	TFile: class TFile {
		path: string = '';
		name: string = '';
		basename: string = '';
		stat = { size: 0, mtime: Date.now(), ctime: Date.now() };
	},
	TFolder: class TFolder {
		path: string = '';
		name: string = '';
		children: any[] = [];
	},
}));

describe('SessionManager Integration Tests', () => {
	let plugin: any;
	let sessionManager: SessionManager;

	beforeEach(() => {
		// Mock plugin with full structure
		plugin = {
			settings: {
				historyFolder: 'gemini-scribe',
				chatModelName: 'gemini-1.5-flash',
				agentModelName: 'gemini-1.5-pro',
				enabledTools: ['read_files', 'search_files'],
				requireConfirmation: {
					modify_files: true,
					delete_files: true,
				},
				chatHistory: true,
			},
			app: {
				vault: {
					getAbstractFileByPath: jest.fn(),
					getMarkdownFiles: jest.fn().mockReturnValue([]),
					create: jest.fn(),
					createFolder: jest.fn(),
					adapter: {
						exists: jest.fn().mockResolvedValue(false),
					},
				},
				fileManager: {
					processFrontMatter: jest.fn(),
				},
			},
		};

		// Create history after plugin is fully initialized
		plugin.history = new SessionHistory(plugin as any);
		sessionManager = new SessionManager(plugin);
	});

	describe('Session Lifecycle', () => {
		it('should handle complete session lifecycle', async () => {
			// Create session
			const session = await sessionManager.createAgentSession('Test Session', {
				contextFiles: [],
				enabledTools: [ToolCategory.READ_ONLY],
			});

			expect(session).toBeDefined();
			expect(session.id).toBeTruthy();
			expect(sessionManager.getSession(session.id)).toBe(session);

			// Update session
			await sessionManager.updateSessionModelConfig(session.id, {
				model: 'gemini-1.5-pro',
				temperature: 0.5,
			});

			const updated = sessionManager.getSession(session.id);
			expect(updated?.modelConfig?.model).toBe('gemini-1.5-pro');
			expect(updated?.modelConfig?.temperature).toBe(0.5);

			// End session - SessionManager doesn't have endSession method
			// Just verify we can get the session
			expect(sessionManager.getSession(session.id)).toBeDefined();
		});

		it('should handle concurrent sessions', async () => {
			// Create multiple sessions
			const session1 = await sessionManager.createAgentSession();
			const session2 = await sessionManager.createAgentSession();
			// Create mock file for note chat
			const mockFile = new TFile();
			mockFile.path = 'test.md';
			mockFile.basename = 'test';
			const session3 = await sessionManager.createNoteChatSession(mockFile);

			// Verify all sessions were created
			expect(session1).toBeDefined();
			expect(session2).toBeDefined();
			expect(session3).toBeDefined();

			// Verify session types
			expect(session1.type).toBe(SessionType.AGENT_SESSION);
			expect(session2.type).toBe(SessionType.AGENT_SESSION);
			expect(session3.type).toBe(SessionType.NOTE_CHAT);
		});

		it('should update session model config', async () => {
			// Mock file operations for persistence
			const mockFile = new TFile();
			mockFile.path = 'gemini-scribe/Agent-Sessions/test-session.md';
			plugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);
			plugin.app.vault.adapter.exists.mockResolvedValue(true);

			// Create session with custom config
			const session = await sessionManager.createAgentSession('Test Session', {
				contextFiles: [{ path: 'context.md', basename: 'context' } as TFile],
				enabledTools: [ToolCategory.READ_ONLY, ToolCategory.VAULT_OPERATIONS],
				requireConfirmation: [DestructiveAction.DELETE_FILES],
			});

			// Add model config
			await sessionManager.updateSessionModelConfig(session.id, {
				model: 'custom-model',
				temperature: 0.7,
				topP: 0.9,
				promptTemplate: 'custom-prompt.md',
			});

			// Verify session was updated
			const updated = sessionManager.getSession(session.id);
			expect(updated?.modelConfig?.model).toBe('custom-model');
			expect(updated?.modelConfig?.temperature).toBe(0.7);
		});
	});

	describe('Context Management', () => {
		it('should handle adding and removing context files', async () => {
			const session = await sessionManager.createAgentSession();

			// Create mock files
			const file1 = new TFile();
			file1.path = 'file1.md';
			file1.basename = 'file1';

			const file2 = new TFile();
			file2.path = 'file2.md';
			file2.basename = 'file2';

			// Add context files
			await sessionManager.addContextFiles(session.id, [file1, file2]);

			const updated = sessionManager.getSession(session.id);
			expect(updated?.context.contextFiles).toHaveLength(2);
			expect(updated?.context.contextFiles[0].path).toBe('file1.md');

			// Remove one file
			await sessionManager.removeContextFiles(session.id, ['file1.md']);

			const afterRemoval = sessionManager.getSession(session.id);
			expect(afterRemoval?.context.contextFiles).toHaveLength(1);
			expect(afterRemoval?.context.contextFiles[0].path).toBe('file2.md');
		});

		it('should prevent duplicate context files', async () => {
			// Create fresh session with no initial context files
			const session = await sessionManager.createAgentSession('Test Session', {
				contextFiles: [],
			});

			const file = new TFile();
			file.path = 'test.md';
			file.basename = 'test';

			// Add same file once
			await sessionManager.addContextFiles(session.id, [file]);

			let updated = sessionManager.getSession(session.id);
			expect(updated?.context.contextFiles).toHaveLength(1);

			// Try adding again - should still have only one
			await sessionManager.addContextFiles(session.id, [file]);
			updated = sessionManager.getSession(session.id);
			expect(updated?.context.contextFiles).toHaveLength(1);
		});
	});

	describe('Permission Updates', () => {
		it('should update session permissions dynamically', async () => {
			const session = await sessionManager.createAgentSession('Test Session', {
				enabledTools: [ToolCategory.READ_ONLY],
				requireConfirmation: [DestructiveAction.MODIFY_FILES],
			});

			// Update permissions
			await sessionManager.updateSessionContext(session.id, {
				enabledTools: [ToolCategory.READ_ONLY, ToolCategory.VAULT_OPERATIONS],
				requireConfirmation: [],
			});

			const updated = sessionManager.getSession(session.id);
			expect(updated?.context.enabledTools).toContain(ToolCategory.VAULT_OPERATIONS);
			expect(updated?.context.requireConfirmation).toHaveLength(0);
		});
	});

	describe('Error Handling', () => {
		it('should handle invalid session operations gracefully', async () => {
			// Try to update non-existent session
			await sessionManager.updateSessionModelConfig('invalid-id', {});
			// Should not throw

			// Try to add files to non-existent session
			await sessionManager.addContextFiles('invalid-id', []);
			// Should not throw
		});

		it('should handle session creation failures', async () => {
			// Mock folder creation failure
			plugin.app.vault.createFolder.mockRejectedValue(new Error('Permission denied'));

			// Should still create session even if folder creation fails
			const session = await sessionManager.createAgentSession();
			expect(session).toBeDefined();
		});
	});

	describe('Session Title Generation', () => {
		it('should generate appropriate session titles', async () => {
			// Mock date for consistent testing
			const mockDate = new Date('2024-01-15T10:30:00');
			// Mock Date for consistent testing
			const originalDate = Date;
			global.Date = jest.fn(() => mockDate) as any;
			global.Date.now = originalDate.now;

			// Agent session
			const agentSession = await sessionManager.createAgentSession();
			expect(agentSession.title).toContain('Agent Session');

			// Note chat session
			const mockFile = new TFile();
			mockFile.path = 'my-note.md';
			mockFile.basename = 'my-note';
			const noteSession = await sessionManager.createNoteChatSession(mockFile);
			expect(noteSession.title).toBe('my-note Chat');

			jest.restoreAllMocks();
		});
	});
});
