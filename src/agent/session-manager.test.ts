import { SessionManager } from './session-manager';
import { SessionType } from '../types/agent';

// Mock plugin
const mockPlugin = {
	app: {
		vault: {
			getAbstractFileByPath: jest.fn(),
			createFolder: jest.fn(),
			read: jest.fn()
		},
		metadataCache: {
			getFileCache: jest.fn()
		}
	},
	settings: {
		historyFolder: 'gemini-scribe'
	}
} as any;

// Mock TFile
const mockFile = {
	path: 'test.md',
	basename: 'test',
	stat: {
		ctime: Date.now(),
		mtime: Date.now()
	}
} as any;

describe('SessionManager', () => {
	let sessionManager: SessionManager;

	beforeEach(() => {
		sessionManager = new SessionManager(mockPlugin);
		jest.clearAllMocks();
	});

	describe('createAgentSession', () => {
		it('should sanitize file names with forbidden characters', async () => {
			const session = await sessionManager.createAgentSession('Agent: Test Mode');
			
			// Should replace colon with dash
			expect(session.title).toBe('Agent- Test Mode');
			expect(session.historyPath).toContain('Agent- Test Mode.md');
		});

		it('should handle various forbidden characters', async () => {
			const session = await sessionManager.createAgentSession('Test\\File/Name:With*Forbidden?Chars"<>|');
			
			// Should replace all forbidden characters with dashes
			expect(session.title).toBe('Test-File-Name-With-Forbidden-Chars----');
		});

		it('should limit file name length', async () => {
			const longTitle = 'A'.repeat(150);
			const session = await sessionManager.createAgentSession(longTitle);
			
			// Should be limited to 100 characters
			expect(session.title.length).toBeLessThanOrEqual(100);
		});

		it('should normalize whitespace', async () => {
			const session = await sessionManager.createAgentSession('  Test   Multiple   Spaces  ');
			
			// Should normalize multiple spaces to single spaces and trim
			expect(session.title).toBe('Test Multiple Spaces');
		});

		it('should create default title when none provided', async () => {
			const session = await sessionManager.createAgentSession();
			
			// Should create a default title with current date
			expect(session.title).toMatch(/Agent Session/);
			expect(session.type).toBe(SessionType.AGENT_SESSION);
		});
	});

	describe('createNoteChatSession', () => {
		it('should sanitize note chat session titles', async () => {
			const fileWithSpecialChars = {
				...mockFile,
				basename: 'Test:File*Name'
			};

			const session = await sessionManager.createNoteChatSession(fileWithSpecialChars);
			
			// Should sanitize the basename in the title
			expect(session.title).toBe('Test-File-Name Chat');
			expect(session.historyPath).toContain('Test-File-Name Chat.md');
		});

		it('should create note chat session with proper type', async () => {
			const session = await sessionManager.createNoteChatSession(mockFile);
			
			expect(session.type).toBe(SessionType.NOTE_CHAT);
			expect(session.sourceNotePath).toBe(mockFile.path);
			expect(session.context.contextFiles).toContain(mockFile);
		});
	});

	describe('getNoteChatSession', () => {
		it('should use sanitized file name when checking for existing history', async () => {
			const fileWithSpecialChars = {
				...mockFile,
				basename: 'Test:File'
			};

			// Mock that no file exists
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(null);

			const session = await sessionManager.getNoteChatSession(fileWithSpecialChars);
			
			// Should have called getAbstractFileByPath with sanitized name
			expect(mockPlugin.app.vault.getAbstractFileByPath).toHaveBeenCalledWith(
				expect.stringContaining('Test-File Chat.md')
			);
		});
	});
});