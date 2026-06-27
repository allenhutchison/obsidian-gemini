import { SessionHistory } from '../../src/agent/session-history';
import { TFile, TFolder } from 'obsidian';
import type { GeminiConversationEntry } from '../../src/types/conversation';
import type { ChatSession } from '../../src/types/agent';
import { SessionType } from '../../src/types/agent';

// Handlebars is used by SessionHistory to compile the history entry template.
// We let it load the real module and test via observable output (vault.modify calls).

// The HBS template is loaded by vitest's rawTextPlugin as a string export.
// No mock needed — we test the real template rendering via vault.modify output.

// Mock utility functions
vi.mock('../../src/utils/accessed-files', () => ({
	pathToWikilink: vi.fn((path: string) => {
		const filename = path.substring(path.lastIndexOf('/') + 1);
		const basename = filename.endsWith('.md') ? filename.slice(0, -3) : filename;
		return `[[${basename}]]`;
	}),
}));

vi.mock('../../src/utils/format-utils', () => ({
	formatLocalTimestamp: vi.fn((date: Date) => date.toISOString()),
}));

vi.mock('../../src/types/tool-policy', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../src/types/tool-policy')>();
	return {
		...actual,
		serializeToolPolicy: vi.fn((policy: any) => {
			if (!policy) return undefined;
			return { preset: policy.preset };
		}),
	};
});

function makeTFile(path: string): TFile {
	const basename = path.includes('/') ? path.split('/').pop()! : path;
	const extension = basename.includes('.') ? basename.split('.').pop()! : '';
	return Object.assign(new TFile(), { path, basename, extension });
}

function createMockPlugin(overrides: any = {}): any {
	return {
		app: {
			vault: {
				getAbstractFileByPath: vi.fn().mockReturnValue(null),
				read: vi.fn().mockResolvedValue(''),
				create: vi.fn().mockImplementation(async (path: string) => {
					const file = makeTFile(path);
					(file as any).stat = { ctime: Date.now(), mtime: Date.now() };
					return file;
				}),
				modify: vi.fn().mockResolvedValue(undefined),
				delete: vi.fn().mockResolvedValue(undefined),
			},
			metadataCache: {
				getFileCache: vi.fn().mockReturnValue(null),
			},
			fileManager: {
				processFrontMatter: vi.fn().mockImplementation(async (_file: any, callback: (fm: any) => void) => {
					const frontmatter: any = {};
					callback(frontmatter);
				}),
				trashFile: vi.fn().mockResolvedValue(undefined),
			},
		},
		settings: {
			chatHistory: true,
			historyFolder: 'gemini-scribe',
			userName: 'Captain Fun',
			...overrides.settings,
		},
		logger: {
			log: vi.fn(),
			debug: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			child: vi.fn().mockReturnThis(),
		},
		manifest: { version: '4.0.0' },
		...overrides,
	};
}

function createMockSession(overrides: Partial<ChatSession> = {}): ChatSession {
	return {
		id: 'session-123',
		type: SessionType.AGENT_SESSION,
		title: 'Test Session',
		context: {
			contextFiles: [],
			requireConfirmation: [],
		} as any,
		created: new Date('2026-01-01T00:00:00Z'),
		lastActive: new Date('2026-01-01T00:00:00Z'),
		historyPath: 'gemini-scribe/Agent-Sessions/Test Session.md',
		...overrides,
	} as ChatSession;
}

describe('SessionHistory', () => {
	let sessionHistory: SessionHistory;
	let mockPlugin: any;

	beforeEach(() => {
		mockPlugin = createMockPlugin();
		sessionHistory = new SessionHistory(mockPlugin);
		vi.clearAllMocks();
	});

	describe('constructor', () => {
		it('should create a functional SessionHistory instance', () => {
			expect(sessionHistory).toBeDefined();
			expect(sessionHistory).toBeInstanceOf(SessionHistory);
		});

		it('should have a working entryTemplate after construction', async () => {
			// Verify the template works by calling addEntryToSession and checking modify is called
			const mockFile = makeTFile('test.md');
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockPlugin.app.vault.read.mockResolvedValue('');

			const session = createMockSession();
			const entry: GeminiConversationEntry = {
				role: 'user',
				message: 'test',
				notePath: '',
				created_at: new Date(),
			};

			await sessionHistory.addEntryToSession(session, entry);

			// If the template compiled successfully, vault.modify is called with generated content
			expect(mockPlugin.app.vault.modify).toHaveBeenCalled();
		});
	});

	describe('getHistoryForSession', () => {
		it('should return empty array when chatHistory is disabled', async () => {
			mockPlugin.settings.chatHistory = false;
			sessionHistory = new SessionHistory(mockPlugin);
			const session = createMockSession();

			const result = await sessionHistory.getHistoryForSession(session);

			expect(result).toEqual([]);
			expect(mockPlugin.app.vault.getAbstractFileByPath).not.toHaveBeenCalled();
		});

		it('should return empty array when history file does not exist', async () => {
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(null);
			const session = createMockSession();

			const result = await sessionHistory.getHistoryForSession(session);

			expect(result).toEqual([]);
		});

		it('should return empty array when getAbstractFileByPath returns a non-TFile', async () => {
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue({ path: 'not-a-tfile' });
			const session = createMockSession();

			const result = await sessionHistory.getHistoryForSession(session);

			expect(result).toEqual([]);
		});

		it('should read the file and parse history content', async () => {
			const mockFile = makeTFile('gemini-scribe/Agent-Sessions/Test Session.md');
			(mockFile as any).extension = 'md';
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);

			const historyContent = [
				'## User',
				'',
				'> [!user]+',
				'> Hello, can you help me?',
				'',
				'> [!metadata]- Message Info',
				'> | Property | Value |',
				'> | -------- | ----- |',
				'> | Time | 2026-01-01T00:00:00Z |',
				'',
				'---',
			].join('\n');

			mockPlugin.app.vault.read.mockResolvedValue(historyContent);
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue(null);

			const session = createMockSession();
			const result = await sessionHistory.getHistoryForSession(session);

			expect(mockPlugin.app.vault.read).toHaveBeenCalledWith(mockFile);
			expect(result).toBeInstanceOf(Array);
		});

		it('should return empty array and log error on read failure', async () => {
			const mockFile = makeTFile('test.md');
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockPlugin.app.vault.read.mockRejectedValue(new Error('read failed'));

			const session = createMockSession();
			const result = await sessionHistory.getHistoryForSession(session);

			expect(result).toEqual([]);
			expect(mockPlugin.logger.error).toHaveBeenCalledWith(
				expect.stringContaining('Error reading agent session history'),
				expect.any(Error)
			);
		});
	});

	describe('parseHistoryContent (via getHistoryForSession)', () => {
		let mockFile: TFile;

		beforeEach(() => {
			mockFile = makeTFile('gemini-scribe/Agent-Sessions/Test.md');
			(mockFile as any).extension = 'md';
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue(null);
		});

		it('should parse user callouts correctly', async () => {
			const content = ['## Captain Fun', '', '> [!user]+', '> Hello there', '', '---'].join('\n');

			mockPlugin.app.vault.read.mockResolvedValue(content);

			const session = createMockSession();
			const result = await sessionHistory.getHistoryForSession(session);

			expect(result).toHaveLength(1);
			expect(result[0].role).toBe('user');
			expect(result[0].message).toBe('Hello there');
		});

		it('should parse assistant/model callouts correctly', async () => {
			const content = [
				'## Model',
				'',
				'> [!assistant]+',
				'> I can help you with that.',
				'> Here is the answer.',
				'',
				'---',
			].join('\n');

			mockPlugin.app.vault.read.mockResolvedValue(content);

			const session = createMockSession();
			const result = await sessionHistory.getHistoryForSession(session);

			expect(result).toHaveLength(1);
			expect(result[0].role).toBe('model');
			expect(result[0].message).toContain('I can help you with that.');
			expect(result[0].message).toContain('Here is the answer.');
		});

		it('should parse multi-turn conversations', async () => {
			const content = [
				'## User',
				'',
				'> [!user]+',
				'> First message',
				'',
				'---',
				'## Model',
				'',
				'> [!assistant]+',
				'> First response',
				'',
				'---',
				'## User',
				'',
				'> [!user]+',
				'> Second message',
				'',
				'---',
			].join('\n');

			mockPlugin.app.vault.read.mockResolvedValue(content);

			const session = createMockSession();
			const result = await sessionHistory.getHistoryForSession(session);

			expect(result).toHaveLength(3);
			expect(result[0].role).toBe('user');
			expect(result[1].role).toBe('model');
			expect(result[2].role).toBe('user');
		});

		it('should extract timestamp from metadata', async () => {
			const content = [
				'## Model',
				'',
				'> [!metadata]- Message Info',
				'> | Property | Value |',
				'> | -------- | ----- |',
				'> | Time | 2026-05-01T12:00:00Z |',
				'',
				'> [!assistant]+',
				'> Response text',
				'',
				'---',
			].join('\n');

			mockPlugin.app.vault.read.mockResolvedValue(content);

			const session = createMockSession();
			const result = await sessionHistory.getHistoryForSession(session);

			expect(result).toHaveLength(1);
			expect(result[0].created_at).toEqual(new Date('2026-05-01T12:00:00Z'));
		});

		it('should extract model name from metadata', async () => {
			const content = [
				'## Model',
				'',
				'> [!metadata]- Message Info',
				'> | Property | Value |',
				'> | -------- | ----- |',
				'> | Time | 2026-05-01T12:00:00Z |',
				'> | Model | gemini-2.5-pro |',
				'',
				'> [!assistant]+',
				'> Response text',
				'',
				'---',
			].join('\n');

			mockPlugin.app.vault.read.mockResolvedValue(content);

			const session = createMockSession();
			const result = await sessionHistory.getHistoryForSession(session);

			expect(result).toHaveLength(1);
			expect(result[0].model).toBe('gemini-2.5-pro');
		});

		it('should extract tool execution info', async () => {
			const content = [
				'## Model',
				'',
				'> [!assistant]+',
				'> I executed a tool.',
				'',
				'**Tool:** `read_file`',
				'**Status:** Success',
				'',
				'---',
			].join('\n');

			mockPlugin.app.vault.read.mockResolvedValue(content);

			const session = createMockSession();
			const result = await sessionHistory.getHistoryForSession(session);

			expect(result).toHaveLength(1);
			expect(result[0].metadata?.toolName).toBe('read_file');
			expect(result[0].metadata?.toolStatus).toBe('success');
		});

		it('should return empty array for content with no callouts', async () => {
			const content = 'Just some plain text with no callout blocks';

			mockPlugin.app.vault.read.mockResolvedValue(content);

			const session = createMockSession();
			const result = await sessionHistory.getHistoryForSession(session);

			expect(result).toEqual([]);
		});

		it('should skip sections without role headers', async () => {
			const content = [
				'Some random content here',
				'---',
				'## User',
				'',
				'> [!user]+',
				'> Valid message',
				'',
				'---',
			].join('\n');

			mockPlugin.app.vault.read.mockResolvedValue(content);

			const session = createMockSession();
			const result = await sessionHistory.getHistoryForSession(session);

			expect(result).toHaveLength(1);
			expect(result[0].message).toBe('Valid message');
		});

		it('should skip frontmatter when cache provides frontmatterPosition', async () => {
			const content = [
				'---',
				'session_id: test-123',
				'title: Test',
				'---',
				'## User',
				'',
				'> [!user]+',
				'> After frontmatter',
				'',
				'---',
			].join('\n');

			// The position offset points past the frontmatter closing ---
			const frontmatterEndOffset = content.indexOf('---', 4) + 4; // past the closing ---
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatterPosition: {
					end: { offset: frontmatterEndOffset },
				},
			});
			mockPlugin.app.vault.read.mockResolvedValue(content);

			const session = createMockSession();
			const result = await sessionHistory.getHistoryForSession(session);

			expect(result).toHaveLength(1);
			expect(result[0].message).toBe('After frontmatter');
		});

		it('should handle empty callout content gracefully', async () => {
			const content = ['## User', '', '> [!user]+', '', '---'].join('\n');

			mockPlugin.app.vault.read.mockResolvedValue(content);

			const session = createMockSession();
			const result = await sessionHistory.getHistoryForSession(session);

			// No message content to extract, so entry is skipped
			expect(result).toEqual([]);
		});

		it('should parse plan callouts with isPlan: true and role: model', async () => {
			const content = [
				'## Plan',
				'',
				'> [!plan]+',
				'> Step 1: Do the thing.',
				'> Step 2: Verify it worked.',
				'',
				'---',
			].join('\n');

			mockPlugin.app.vault.read.mockResolvedValue(content);

			const session = createMockSession();
			const result = await sessionHistory.getHistoryForSession(session);

			expect(result).toHaveLength(1);
			expect(result[0].role).toBe('model');
			expect(result[0].isPlan).toBe(true);
			expect(result[0].message).toContain('Step 1: Do the thing.');
		});

		it('should round-trip plan entries via addEntryToSession then getHistoryForSession', async () => {
			let storedContent = '';
			const mockFile = makeTFile('gemini-scribe/Agent-Sessions/Test.md');
			(mockFile as any).extension = 'md';
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockPlugin.app.vault.read.mockImplementation(async () => storedContent);
			mockPlugin.app.vault.modify.mockImplementation(async (_file: any, content: string) => {
				storedContent = content;
			});
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue(null);

			const session = createMockSession();
			const planEntry: GeminiConversationEntry = {
				role: 'model',
				message: '1. Analyze the request.\n2. Write the code.',
				notePath: '',
				created_at: new Date(),
				isPlan: true,
			};

			await sessionHistory.addEntryToSession(session, planEntry);

			// Verify persisted content uses [!plan]+ callout
			expect(storedContent).toContain('> [!plan]+');
			expect(storedContent).toContain('## Plan');

			// Verify re-parsed entry preserves isPlan
			const parsed = await sessionHistory.getHistoryForSession(session);
			expect(parsed.length).toBeGreaterThanOrEqual(1);
			const plan = parsed.find((e) => e.isPlan);
			expect(plan).toBeDefined();
			expect(plan!.role).toBe('model');
			expect(plan!.isPlan).toBe(true);
		});
	});

	describe('addEntryToSession', () => {
		it('should return early when chatHistory is disabled', async () => {
			mockPlugin.settings.chatHistory = false;
			sessionHistory = new SessionHistory(mockPlugin);
			const session = createMockSession();
			const entry: GeminiConversationEntry = {
				role: 'user',
				message: 'Hello',
				notePath: '',
				created_at: new Date(),
			};

			await sessionHistory.addEntryToSession(session, entry);

			expect(mockPlugin.app.vault.getAbstractFileByPath).not.toHaveBeenCalled();
		});

		it('should create file when it does not exist', async () => {
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(null);

			const session = createMockSession();
			const entry: GeminiConversationEntry = {
				role: 'user',
				message: 'Hello',
				notePath: '',
				created_at: new Date(),
			};

			await sessionHistory.addEntryToSession(session, entry);

			expect(mockPlugin.app.vault.create).toHaveBeenCalledWith(
				session.historyPath,
				expect.stringContaining(session.title)
			);
		});

		it('should use existing file when it exists', async () => {
			const mockFile = makeTFile(createMockSession().historyPath);
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockPlugin.app.vault.read.mockResolvedValue('# Test Session\n\n');

			const session = createMockSession();
			const entry: GeminiConversationEntry = {
				role: 'user',
				message: 'Hello',
				notePath: '',
				created_at: new Date(),
			};

			await sessionHistory.addEntryToSession(session, entry);

			expect(mockPlugin.app.vault.create).not.toHaveBeenCalled();
			expect(mockPlugin.app.vault.modify).toHaveBeenCalled();
		});

		it('should capitalize role name for display', async () => {
			const mockFile = makeTFile('test.md');
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockPlugin.app.vault.read.mockResolvedValue('');

			const session = createMockSession();
			const entry: GeminiConversationEntry = {
				role: 'model',
				message: 'Response here',
				notePath: '',
				created_at: new Date(),
			};

			await sessionHistory.addEntryToSession(session, entry);

			// The rendered content should contain "## Model" (capitalized role as heading)
			const modifyCall = mockPlugin.app.vault.modify.mock.calls[0];
			const writtenContent = modifyCall[1] as string;
			expect(writtenContent).toContain('## Model');
		});

		it('should use configured userName for user entries', async () => {
			const mockFile = makeTFile('test.md');
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockPlugin.app.vault.read.mockResolvedValue('');

			const session = createMockSession();
			const entry: GeminiConversationEntry = {
				role: 'user',
				message: 'Hello',
				notePath: '',
				created_at: new Date(),
			};

			await sessionHistory.addEntryToSession(session, entry);

			// The rendered content should contain the configured userName as the heading
			const modifyCall = mockPlugin.app.vault.modify.mock.calls[0];
			const writtenContent = modifyCall[1] as string;
			expect(writtenContent).toContain('## Captain Fun');
		});

		it('should fall back to "User" when userName is not configured', async () => {
			mockPlugin.settings.userName = '';
			sessionHistory = new SessionHistory(mockPlugin);
			const mockFile = makeTFile('test.md');
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockPlugin.app.vault.read.mockResolvedValue('');

			const session = createMockSession();
			const entry: GeminiConversationEntry = {
				role: 'user',
				message: 'Hello',
				notePath: '',
				created_at: new Date(),
			};

			await sessionHistory.addEntryToSession(session, entry);

			// The rendered content should contain "## User" (default when no userName set)
			const modifyCall = mockPlugin.app.vault.modify.mock.calls[0];
			const writtenContent = modifyCall[1] as string;
			expect(writtenContent).toContain('## User');
		});

		it('should use explicitTimestamp when provided', async () => {
			const mockFile = makeTFile('test.md');
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockPlugin.app.vault.read.mockResolvedValue('');

			const session = createMockSession();
			const explicitTimestamp = new Date('2026-03-15T10:30:00Z');
			const entry: GeminiConversationEntry = {
				role: 'user',
				message: 'Hello',
				notePath: '',
				created_at: new Date(),
			};

			await sessionHistory.addEntryToSession(session, entry, explicitTimestamp);

			// The entry's created_at should be set to the explicit timestamp
			expect(entry.created_at).toBe(explicitTimestamp);
		});

		it('should update session lastActive after writing', async () => {
			const mockFile = makeTFile('test.md');
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockPlugin.app.vault.read.mockResolvedValue('');

			const session = createMockSession();
			const originalLastActive = session.lastActive;
			const entry: GeminiConversationEntry = {
				role: 'user',
				message: 'Hello',
				notePath: '',
				created_at: new Date(),
			};

			await sessionHistory.addEntryToSession(session, entry);

			expect(session.lastActive.getTime()).toBeGreaterThanOrEqual(originalLastActive.getTime());
		});

		it('should use "Plan" as displayName for plan entries', async () => {
			const mockFile = makeTFile('test.md');
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockPlugin.app.vault.read.mockResolvedValue('');

			const session = createMockSession();
			const entry: GeminiConversationEntry = {
				role: 'model',
				message: 'Step 1: Do something.\nStep 2: Done.',
				notePath: '',
				created_at: new Date(),
				isPlan: true,
			};

			await sessionHistory.addEntryToSession(session, entry);

			const modifyCall = mockPlugin.app.vault.modify.mock.calls[0];
			const writtenContent = modifyCall[1] as string;
			expect(writtenContent).toContain('## Plan');
			expect(writtenContent).toContain('> [!plan]+');
		});

		it('should throw and log error when reading existing content fails', async () => {
			const mockFile = makeTFile('test.md');
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockPlugin.app.vault.read.mockRejectedValue(new Error('read error'));

			const session = createMockSession();
			const entry: GeminiConversationEntry = {
				role: 'user',
				message: 'Hello',
				notePath: '',
				created_at: new Date(),
			};

			await expect(sessionHistory.addEntryToSession(session, entry)).rejects.toThrow('read error');
			expect(mockPlugin.logger.error).toHaveBeenCalledWith(
				expect.stringContaining('Error reading existing history'),
				expect.any(Error)
			);
		});

		it('should throw and log error when modify fails', async () => {
			const mockFile = makeTFile('test.md');
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockPlugin.app.vault.read.mockResolvedValue('existing content');
			mockPlugin.app.vault.modify.mockRejectedValue(new Error('write error'));

			const session = createMockSession();
			const entry: GeminiConversationEntry = {
				role: 'user',
				message: 'Hello',
				notePath: '',
				created_at: new Date(),
			};

			await expect(sessionHistory.addEntryToSession(session, entry)).rejects.toThrow('write error');
			expect(mockPlugin.logger.error).toHaveBeenCalledWith(
				expect.stringContaining('Error writing to agent session history'),
				expect.any(Error)
			);
		});
	});

	describe('applySessionFrontmatter (via updateSessionMetadata)', () => {
		it('should set required fields in frontmatter', async () => {
			const mockFile = makeTFile('test.md');
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);

			let capturedFrontmatter: any = {};
			mockPlugin.app.fileManager.processFrontMatter.mockImplementation(
				async (_file: any, callback: (fm: any) => void) => {
					const fm: any = {};
					callback(fm);
					capturedFrontmatter = fm;
				}
			);

			const session = createMockSession({
				id: 'abc-123',
				type: SessionType.AGENT_SESSION,
				title: 'My Session',
			});

			await sessionHistory.updateSessionMetadata(session);

			expect(capturedFrontmatter.session_id).toBe('abc-123');
			expect(capturedFrontmatter.type).toBe(SessionType.AGENT_SESSION);
			expect(capturedFrontmatter.title).toBe('My Session');
			expect(capturedFrontmatter.created).toBeDefined();
			expect(capturedFrontmatter.last_active).toBeDefined();
		});

		it('should set context_files when present', async () => {
			const mockFile = makeTFile('test.md');
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);

			let capturedFrontmatter: any = {};
			mockPlugin.app.fileManager.processFrontMatter.mockImplementation(
				async (_file: any, callback: (fm: any) => void) => {
					const fm: any = {};
					callback(fm);
					capturedFrontmatter = fm;
				}
			);

			const contextFile = makeTFile('notes/Context.md');
			(contextFile as any).basename = 'Context';
			const session = createMockSession({
				context: {
					contextFiles: [contextFile],
					requireConfirmation: [],
				} as any,
			});

			await sessionHistory.updateSessionMetadata(session);

			expect(capturedFrontmatter.context_files).toEqual(['[[Context]]']);
		});

		it('should delete context_files when empty', async () => {
			const mockFile = makeTFile('test.md');
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);

			let capturedFrontmatter: any = {};
			mockPlugin.app.fileManager.processFrontMatter.mockImplementation(
				async (_file: any, callback: (fm: any) => void) => {
					const fm: any = { context_files: ['stale'] };
					callback(fm);
					capturedFrontmatter = fm;
				}
			);

			const session = createMockSession({
				context: {
					contextFiles: [],
					requireConfirmation: [],
				} as any,
			});

			await sessionHistory.updateSessionMetadata(session);

			expect(capturedFrontmatter.context_files).toBeUndefined();
		});

		it('should set accessed_files from session accessedFiles Set', async () => {
			const mockFile = makeTFile('test.md');
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);

			let capturedFrontmatter: any = {};
			mockPlugin.app.fileManager.processFrontMatter.mockImplementation(
				async (_file: any, callback: (fm: any) => void) => {
					const fm: any = {};
					callback(fm);
					capturedFrontmatter = fm;
				}
			);

			const session = createMockSession();
			session.accessedFiles = new Set(['notes/Chapter 1.md', 'src/Utils.ts']);

			await sessionHistory.updateSessionMetadata(session);

			expect(capturedFrontmatter.accessed_files).toEqual(expect.arrayContaining(['[[Chapter 1]]', '[[Utils.ts]]']));
		});

		it('should delete accessed_files when session has no accessedFiles', async () => {
			const mockFile = makeTFile('test.md');
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);

			let capturedFrontmatter: any = {};
			mockPlugin.app.fileManager.processFrontMatter.mockImplementation(
				async (_file: any, callback: (fm: any) => void) => {
					const fm: any = { accessed_files: ['stale'] };
					callback(fm);
					capturedFrontmatter = fm;
				}
			);

			const session = createMockSession();
			// No accessedFiles set

			await sessionHistory.updateSessionMetadata(session);

			expect(capturedFrontmatter.accessed_files).toBeUndefined();
		});

		it('should set tool_policy when serializable', async () => {
			const mockFile = makeTFile('test.md');
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);

			let capturedFrontmatter: any = {};
			mockPlugin.app.fileManager.processFrontMatter.mockImplementation(
				async (_file: any, callback: (fm: any) => void) => {
					const fm: any = {};
					callback(fm);
					capturedFrontmatter = fm;
				}
			);

			const session = createMockSession({
				context: {
					contextFiles: [],
					requireConfirmation: [],
					toolPolicy: { preset: 'read_only' },
				} as any,
			});

			await sessionHistory.updateSessionMetadata(session);

			expect(capturedFrontmatter.tool_policy).toBeDefined();
		});

		it('should delete tool_policy when not serializable', async () => {
			const mockFile = makeTFile('test.md');
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);

			let capturedFrontmatter: any = {};
			mockPlugin.app.fileManager.processFrontMatter.mockImplementation(
				async (_file: any, callback: (fm: any) => void) => {
					const fm: any = { tool_policy: 'stale' };
					callback(fm);
					capturedFrontmatter = fm;
				}
			);

			const session = createMockSession({
				context: {
					contextFiles: [],
					requireConfirmation: [],
					toolPolicy: undefined,
				} as any,
			});

			await sessionHistory.updateSessionMetadata(session);

			expect(capturedFrontmatter.tool_policy).toBeUndefined();
		});

		it('should always delete legacy enabled_tools field', async () => {
			const mockFile = makeTFile('test.md');
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);

			let capturedFrontmatter: any = {};
			mockPlugin.app.fileManager.processFrontMatter.mockImplementation(
				async (_file: any, callback: (fm: any) => void) => {
					const fm: any = { enabled_tools: ['read_file', 'write_file'] };
					callback(fm);
					capturedFrontmatter = fm;
				}
			);

			const session = createMockSession();

			await sessionHistory.updateSessionMetadata(session);

			expect(capturedFrontmatter.enabled_tools).toBeUndefined();
		});

		it('should set model config fields when present', async () => {
			const mockFile = makeTFile('test.md');
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);

			let capturedFrontmatter: any = {};
			mockPlugin.app.fileManager.processFrontMatter.mockImplementation(
				async (_file: any, callback: (fm: any) => void) => {
					const fm: any = {};
					callback(fm);
					capturedFrontmatter = fm;
				}
			);

			const session = createMockSession({
				modelConfig: {
					model: 'gemini-2.5-pro',
					temperature: 0.7,
					topP: 0.9,
					promptTemplate: 'custom-prompt',
				},
			});

			await sessionHistory.updateSessionMetadata(session);

			expect(capturedFrontmatter.model).toBe('gemini-2.5-pro');
			expect(capturedFrontmatter.temperature).toBe(0.7);
			expect(capturedFrontmatter.top_p).toBe(0.9);
			expect(capturedFrontmatter.prompt_template).toBe('custom-prompt');
		});

		it('should delete model config fields when absent', async () => {
			const mockFile = makeTFile('test.md');
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);

			let capturedFrontmatter: any = {};
			mockPlugin.app.fileManager.processFrontMatter.mockImplementation(
				async (_file: any, callback: (fm: any) => void) => {
					const fm: any = {
						model: 'old-model',
						temperature: 0.5,
						top_p: 0.8,
						prompt_template: 'old',
					};
					callback(fm);
					capturedFrontmatter = fm;
				}
			);

			const session = createMockSession({ modelConfig: undefined });

			await sessionHistory.updateSessionMetadata(session);

			expect(capturedFrontmatter.model).toBeUndefined();
			expect(capturedFrontmatter.temperature).toBeUndefined();
			expect(capturedFrontmatter.top_p).toBeUndefined();
			expect(capturedFrontmatter.prompt_template).toBeUndefined();
		});

		it('should set project linkage as wikilink', async () => {
			const mockFile = makeTFile('test.md');
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);

			let capturedFrontmatter: any = {};
			mockPlugin.app.fileManager.processFrontMatter.mockImplementation(
				async (_file: any, callback: (fm: any) => void) => {
					const fm: any = {};
					callback(fm);
					capturedFrontmatter = fm;
				}
			);

			const session = createMockSession({ projectPath: 'Projects/My Project.md' });

			await sessionHistory.updateSessionMetadata(session);

			expect(capturedFrontmatter.project).toBe('[[Projects/My Project.md]]');
		});

		it('should create file when it does not exist', async () => {
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(null);

			const session = createMockSession();

			await sessionHistory.updateSessionMetadata(session);

			expect(mockPlugin.app.vault.create).toHaveBeenCalledWith(
				session.historyPath,
				expect.stringContaining(session.title)
			);
		});
	});

	describe('getAllAgentSessions', () => {
		it('should return empty array when folder does not exist', async () => {
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(null);

			const result = await sessionHistory.getAllAgentSessions();

			expect(result).toEqual([]);
		});

		it('should return empty array when path resolves to a non-folder', async () => {
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue({ path: 'some-path' });

			const result = await sessionHistory.getAllAgentSessions();

			expect(result).toEqual([]);
		});

		it('should filter to only markdown TFile instances', async () => {
			const now = Date.now();
			const mdFile = Object.assign(makeTFile('session.md'), {
				extension: 'md',
				stat: { ctime: now, mtime: now },
			});
			const txtFile = Object.assign(makeTFile('note.txt'), {
				extension: 'txt',
				stat: { ctime: now, mtime: now },
			});
			const folder = Object.assign(new TFolder(), {
				children: [mdFile, txtFile, { path: 'not-a-tfile' }],
			});
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(folder);

			const result = await sessionHistory.getAllAgentSessions();

			expect(result).toHaveLength(1);
			expect(result[0]).toBe(mdFile);
		});

		it('should sort by mtime descending (most recent first)', async () => {
			const now = Date.now();
			const olderFile = Object.assign(makeTFile('older.md'), {
				extension: 'md',
				stat: { ctime: now - 3000, mtime: now - 3000 },
			});
			const newerFile = Object.assign(makeTFile('newer.md'), {
				extension: 'md',
				stat: { ctime: now - 1000, mtime: now - 1000 },
			});
			const folder = Object.assign(new TFolder(), {
				children: [olderFile, newerFile],
			});
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(folder);

			const result = await sessionHistory.getAllAgentSessions();

			expect(result).toHaveLength(2);
			expect(result[0]).toBe(newerFile);
			expect(result[1]).toBe(olderFile);
		});

		it('should log error and return empty array on failure', async () => {
			mockPlugin.app.vault.getAbstractFileByPath.mockImplementation(() => {
				throw new Error('vault error');
			});

			const result = await sessionHistory.getAllAgentSessions();

			expect(result).toEqual([]);
			expect(mockPlugin.logger.error).toHaveBeenCalledWith(
				expect.stringContaining('Error listing agent sessions'),
				expect.any(Error)
			);
		});
	});

	describe('deleteSessionHistory', () => {
		it('should delete the file when it exists', async () => {
			const mockFile = makeTFile('test.md');
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);

			const session = createMockSession();
			await sessionHistory.deleteSessionHistory(session);

			expect(mockPlugin.app.fileManager.trashFile).toHaveBeenCalledWith(mockFile);
		});

		it('should be a no-op when file does not exist', async () => {
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(null);

			const session = createMockSession();
			await sessionHistory.deleteSessionHistory(session);

			expect(mockPlugin.app.fileManager.trashFile).not.toHaveBeenCalled();
		});

		it('should throw and log error on delete failure', async () => {
			const mockFile = makeTFile('test.md');
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockPlugin.app.fileManager.trashFile.mockRejectedValue(new Error('delete failed'));

			const session = createMockSession();

			await expect(sessionHistory.deleteSessionHistory(session)).rejects.toThrow('delete failed');
			expect(mockPlugin.logger.error).toHaveBeenCalledWith(
				expect.stringContaining('Error deleting session history'),
				expect.any(Error)
			);
		});
	});

	describe('plan entry round-trip', () => {
		it('serializes a plan entry with [!plan]+ callout and parses isPlan back', async () => {
			const mockFile = makeTFile('test.md');
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockPlugin.app.vault.read.mockResolvedValue('');

			const session = createMockSession();
			const planEntry: GeminiConversationEntry = {
				role: 'model',
				message: '1. First step\n2. Second step',
				notePath: '',
				created_at: new Date(),
				isPlan: true,
			};

			await sessionHistory.addEntryToSession(session, planEntry);
			const raw: string = mockPlugin.app.vault.modify.mock.calls[0][1];

			// Serialization: must use [!plan]+ callout, not [!assistant]+
			expect(raw).toContain('> [!plan]+');
			expect(raw).not.toContain('> [!assistant]+');

			// Parse the serialized content back
			mockPlugin.app.vault.read.mockResolvedValue(raw);
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue(null);
			const parsed = await sessionHistory.getHistoryForSession(session);

			expect(parsed).toHaveLength(1);
			expect(parsed[0].role).toBe('model');
			expect(parsed[0].message).toContain('First step');
			expect(parsed[0].isPlan).toBe(true);
		});

		it('parses a plan callout from a stored history fixture', async () => {
			const fixture = [
				'---',
				'session_id: s1',
				'---',
				'',
				'## Agent (Plan)',
				'',
				'> [!metadata]- Message Info',
				'> | Property | Value |',
				'> | -------- | ----- |',
				'> | Time | 2026-01-01T00:00:00.000Z |',
				'',
				'> [!plan]+',
				'> Step one',
				'> Step two',
				'',
				'---',
			].join('\n');

			const mockFile = makeTFile('test.md');
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockPlugin.app.vault.read.mockResolvedValue(fixture);
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatterPosition: { end: { offset: fixture.indexOf('\n---\n', 4) + 5 } },
			});

			const session = createMockSession();
			const result = await sessionHistory.getHistoryForSession(session);

			expect(result).toHaveLength(1);
			expect(result[0].role).toBe('model');
			expect(result[0].message).toContain('Step one');
			expect(result[0].isPlan).toBe(true);
			// Plan entries carry no leftover plan-typed metadata — isPlan is the signal.
			expect(result[0].metadata?.entryType).toBeUndefined();
		});
	});

	describe('model reasoning (thoughts) round-trip', () => {
		let mockFile: TFile;

		// Wire a real write→read round-trip: addEntryToSession appends via
		// vault.modify; getHistoryForSession reads the accumulated buffer back.
		function wireRoundTripFile(initial = ''): { read: () => string } {
			let fileContent = initial;
			mockFile = makeTFile('gemini-scribe/Agent-Sessions/Test.md');
			(mockFile as any).extension = 'md';
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue(null);
			mockPlugin.app.vault.read.mockImplementation(async () => fileContent);
			mockPlugin.app.vault.modify.mockImplementation(async (_f: TFile, content: string) => {
				fileContent = content;
			});
			return { read: () => fileContent };
		}

		it('round-trips a model entry that has both a message and thoughts', async () => {
			wireRoundTripFile();
			const session = createMockSession();

			await sessionHistory.addEntryToSession(session, {
				role: 'model',
				message: 'The answer is 42.',
				notePath: '',
				created_at: new Date('2026-01-01T00:00:00Z'),
				thoughts: 'The user asked about the meaning of life.\nConsidering the references...',
			});

			const result = await sessionHistory.getHistoryForSession(session);
			expect(result).toHaveLength(1);
			expect(result[0].role).toBe('model');
			expect(result[0].message).toBe('The answer is 42.');
			expect(result[0].thoughts).toBe('The user asked about the meaning of life.\nConsidering the references...');
		});

		it('round-trips a reasoning-only model turn (thoughts, empty message)', async () => {
			wireRoundTripFile();
			const session = createMockSession();

			await sessionHistory.addEntryToSession(session, {
				role: 'model',
				message: '',
				notePath: '',
				created_at: new Date('2026-01-01T00:00:00Z'),
				thoughts: 'I should read the file before editing it.',
			});

			const result = await sessionHistory.getHistoryForSession(session);
			expect(result).toHaveLength(1);
			expect(result[0].role).toBe('model');
			expect(result[0].message).toBe('');
			expect(result[0].thoughts).toBe('I should read the file before editing it.');
		});

		it('writes reasoning-only turns without a header or metadata block (streamlined)', async () => {
			const file = wireRoundTripFile();
			const session = createMockSession();

			await sessionHistory.addEntryToSession(session, {
				role: 'model',
				message: '',
				notePath: '',
				created_at: new Date('2026-01-01T00:00:00Z'),
				model: 'gemini-3.5-flash',
				thoughts: 'Pre-tool reasoning.',
			});

			const raw = file.read();
			expect(raw).toContain('> [!reasoning]- Reasoning');
			// No heavy `## Model` header / Message Info table for a bare reasoning step.
			expect(raw).not.toContain('## Model');
			expect(raw).not.toContain('Message Info');
		});

		it('keeps the header + metadata for model turns that have an answer', async () => {
			const file = wireRoundTripFile();
			const session = createMockSession();

			await sessionHistory.addEntryToSession(session, {
				role: 'model',
				message: 'Here is the answer.',
				notePath: '',
				created_at: new Date('2026-01-01T00:00:00Z'),
				model: 'gemini-3.5-flash',
				thoughts: 'Reasoning behind it.',
			});

			const raw = file.read();
			expect(raw).toContain('## Model');
			expect(raw).toContain('Message Info');
			expect(raw).toContain('> [!assistant]+');
			expect(raw).toContain('> [!reasoning]- Reasoning');
		});

		it('does not let the reasoning callout leak into the message body', async () => {
			wireRoundTripFile();
			const session = createMockSession();

			await sessionHistory.addEntryToSession(session, {
				role: 'model',
				message: 'Final answer.',
				notePath: '',
				created_at: new Date('2026-01-01T00:00:00Z'),
				thoughts: 'Reasoning text here.',
			});

			const result = await sessionHistory.getHistoryForSession(session);
			expect(result[0].message).toBe('Final answer.');
			expect(result[0].message).not.toContain('reasoning');
			expect(result[0].message).not.toContain('Reasoning');
		});

		it('preserves multi-paragraph thoughts with blank lines', async () => {
			wireRoundTripFile();
			const session = createMockSession();
			const thoughts = 'First paragraph of reasoning.\n\nSecond paragraph after a blank line.';

			await sessionHistory.addEntryToSession(session, {
				role: 'model',
				message: 'Done.',
				notePath: '',
				created_at: new Date('2026-01-01T00:00:00Z'),
				thoughts,
			});

			const result = await sessionHistory.getHistoryForSession(session);
			expect(result[0].thoughts).toBe(thoughts);
		});

		it('round-trips a full user → reasoning-only → answer sequence', async () => {
			wireRoundTripFile();
			const session = createMockSession();

			await sessionHistory.addEntryToSession(session, {
				role: 'user',
				message: 'Refactor my note.',
				notePath: '',
				created_at: new Date('2026-01-01T00:00:00Z'),
			});
			await sessionHistory.addEntryToSession(session, {
				role: 'model',
				message: '',
				notePath: '',
				created_at: new Date('2026-01-01T00:00:01Z'),
				thoughts: 'I need to read the note first.',
			});
			await sessionHistory.addEntryToSession(session, {
				role: 'model',
				message: 'Done — I tidied the headings.',
				notePath: '',
				created_at: new Date('2026-01-01T00:00:02Z'),
				thoughts: 'The headings were inconsistent, so I normalized them.',
			});

			const result = await sessionHistory.getHistoryForSession(session);
			expect(result).toHaveLength(3);
			expect(result[0]).toMatchObject({ role: 'user', message: 'Refactor my note.' });
			expect(result[0].thoughts).toBeUndefined();
			expect(result[1]).toMatchObject({ role: 'model', message: '' });
			expect(result[1].thoughts).toBe('I need to read the note first.');
			expect(result[2]).toMatchObject({ role: 'model', message: 'Done — I tidied the headings.' });
			expect(result[2].thoughts).toBe('The headings were inconsistent, so I normalized them.');
		});

		it('parses an interleaved activity run (reasoning + tool callouts, no --- between)', async () => {
			const mockFile = makeTFile('gemini-scribe/Agent-Sessions/Test.md');
			(mockFile as any).extension = 'md';
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue(null);

			// Mirrors the streamlined on-disk shape: the activity stream is reasoning
			// and tool callouts flowing together with no horizontal rules; only the
			// user message and the final answer are `---`-separated sections.
			const content = [
				'## Allen',
				'',
				'> [!metadata]- Message Info',
				'> | Property | Value |',
				'> | -------- | ----- |',
				'> | Time | 2026-01-01T00:00:00Z |',
				'',
				'> [!user]+',
				'> Find live jazz near my hotel.',
				'',
				'---',
				'',
				'> [!reasoning]- Reasoning',
				'> The vault has nothing; I should search.',
				'',
				'> [!tools]- Tool Execution',
				'> 🔧 `vault_semantic_search` query="jazz" → success (10ms)',
				'',
				'> [!reasoning]- Reasoning',
				'> Now confirm distances.',
				'',
				'> [!tools]- Tool Execution',
				'> 🔧 `google_search` query="jazz hotel" → success (20ms)',
				'',
				'## Model',
				'',
				'> [!metadata]- Message Info',
				'> | Property | Value |',
				'> | -------- | ----- |',
				'> | Time | 2026-01-01T00:01:00Z |',
				'> | Model | gemini-3.5-flash |',
				'',
				'> [!assistant]+',
				'> Here are two options.',
				'',
				'> [!reasoning]- Reasoning',
				'> Organize by proximity.',
				'',
				'---',
			].join('\n');
			mockPlugin.app.vault.read.mockResolvedValue(content);

			const result = await sessionHistory.getHistoryForSession(createMockSession());

			expect(result).toHaveLength(4);
			expect(result[0]).toMatchObject({ role: 'user', message: 'Find live jazz near my hotel.' });
			expect(result[1]).toMatchObject({ role: 'model', message: '' });
			expect(result[1].thoughts).toBe('The vault has nothing; I should search.');
			expect(result[2]).toMatchObject({ role: 'model', message: '' });
			expect(result[2].thoughts).toBe('Now confirm distances.');
			expect(result[3]).toMatchObject({ role: 'model', message: 'Here are two options.' });
			expect(result[3].thoughts).toBe('Organize by proximity.');
		});

		it('leaves thoughts undefined for legacy entries without a reasoning callout', async () => {
			mockFile = makeTFile('gemini-scribe/Agent-Sessions/Test.md');
			(mockFile as any).extension = 'md';
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue(null);

			// Pre-reasoning history format — message callout only, no reasoning.
			const legacy = [
				'## Model',
				'',
				'> [!assistant]+',
				'> Here is the legacy answer.',
				'',
				'> [!metadata]- Message Info',
				'> | Property | Value |',
				'> | -------- | ----- |',
				'> | Time | 2026-01-01T00:00:00Z |',
				'',
				'---',
			].join('\n');
			mockPlugin.app.vault.read.mockResolvedValue(legacy);

			const session = createMockSession();
			const result = await sessionHistory.getHistoryForSession(session);

			expect(result).toHaveLength(1);
			expect(result[0].message).toBe('Here is the legacy answer.');
			expect(result[0].thoughts).toBeUndefined();
		});
	});
});
