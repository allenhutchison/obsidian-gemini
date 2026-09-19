import { SessionManager } from '../../src/agent/session-manager';
import { SessionHistory } from '../../src/agent/session-history';
import { SessionType } from '../../src/types/agent';
import { PolicyPreset } from '../../src/types/tool-policy';
import { TFolder } from 'obsidian';

// Mock Obsidian
vi.mock('obsidian', async () => ({
	...(await vi.importActual<any>('../../__mocks__/obsidian.js')),
	Notice: vi.fn(),
	normalizePath: vi.fn((path: string) => path),
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
		// Track created folders so ensureFolderExists can verify them
		const createdFolders: Record<string, any> = {};

		// Mock plugin with full structure
		plugin = {
			settings: {
				historyFolder: 'gemini-scribe',
				chatModelName: 'gemini-1.5-flash',
				agentModelName: 'gemini-1.5-pro',
				enabledTools: ['read_files', 'find_files_by_name'],
				requireConfirmation: {
					modify_files: true,
					delete_files: true,
				},
				chatHistory: true,
			},
			app: {
				vault: {
					getAbstractFileByPath: vi.fn().mockImplementation((path: string) => {
						return createdFolders[path] || null;
					}),
					getMarkdownFiles: vi.fn().mockReturnValue([]),
					create: vi.fn(),
					createFolder: vi.fn().mockImplementation(async (path: string) => {
						const folder = new TFolder();
						folder.path = path;
						folder.name = path.split('/').pop() || '';
						folder.children = [];
						createdFolders[path] = folder;
					}),
					adapter: {
						exists: vi.fn().mockResolvedValue(false),
					},
				},
				fileManager: {
					processFrontMatter: vi.fn(),
				},
			},
		};

		// Create history after plugin is fully initialized
		plugin.history = new SessionHistory(plugin);
		sessionManager = new SessionManager(plugin);
	});

	describe('Session Lifecycle', () => {
		it('should handle complete session lifecycle', async () => {
			// Create session
			const session = await sessionManager.createAgentSession('Test Session', {
				contextFiles: [],
				toolPolicy: { preset: PolicyPreset.READ_ONLY },
			});

			expect(session).toBeDefined();
			expect(session.id).toBeTruthy();
			expect(sessionManager.getSession(session.id)).toBe(session);

			// End session - SessionManager doesn't have endSession method
			// Just verify we can get the session
			expect(sessionManager.getSession(session.id)).toBeDefined();
		});

		it('should handle concurrent sessions', async () => {
			// Create multiple sessions
			const session1 = await sessionManager.createAgentSession();
			const session2 = await sessionManager.createAgentSession();

			// Verify all sessions were created
			expect(session1).toBeDefined();
			expect(session2).toBeDefined();

			// Verify session types
			expect(session1.type).toBe(SessionType.AGENT_SESSION);
			expect(session2.type).toBe(SessionType.AGENT_SESSION);
		});
	});

	describe('Error Handling', () => {
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
			const originalDate = window.Date;
			window.Date = vi.fn(function () {
				return mockDate;
			}) as any;
			window.Date.now = vi.fn(() => mockDate.getTime());

			try {
				// Agent session
				const agentSession = await sessionManager.createAgentSession();
				expect(agentSession.title).toContain('Agent Session');
			} finally {
				// vi.restoreAllMocks() doesn't undo direct global assignments — only
				// spies registered via vi.spyOn — so we have to restore Date by hand
				// before any other test runs.
				window.Date = originalDate;
				vi.restoreAllMocks();
			}
		});
	});
});
