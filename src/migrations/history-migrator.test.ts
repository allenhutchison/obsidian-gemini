/**
 * Tests for HistoryMigrator
 */

import { HistoryMigrator } from './history-migrator';
import { TFile, TFolder, normalizePath } from 'obsidian';

// Mock Obsidian
jest.mock('obsidian', () => ({
	TFile: jest.fn(),
	TFolder: jest.fn(),
	normalizePath: jest.fn((path: string) => path)
}));

describe('HistoryMigrator', () => {
	let migrator: HistoryMigrator;
	let mockPlugin: any;
	let mockVault: any;
	let mockApp: any;

	beforeEach(() => {
		// Setup mock vault
		mockVault = {
			getAbstractFileByPath: jest.fn(),
			getMarkdownFiles: jest.fn(() => []),
			createFolder: jest.fn(),
			create: jest.fn(),
			read: jest.fn(),
			modify: jest.fn()
		};

		mockApp = {
			vault: mockVault
		};

		mockPlugin = {
			app: mockApp,
			settings: {
				historyFolder: 'gemini-scribe'
			},
			manifest: {
				version: '4.0.0'
			}
		};

		migrator = new HistoryMigrator(mockPlugin);
	});

	describe('needsMigration', () => {
		it('should return false if History folder does not exist', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(null);

			const result = await migrator.needsMigration();

			expect(result).toBe(false);
		});

		it('should return false if History folder exists but is empty', async () => {
			const mockHistoryFolder = { type: 'folder' } as unknown as TFolder;
			mockVault.getAbstractFileByPath.mockReturnValue(mockHistoryFolder);
			mockVault.getMarkdownFiles.mockReturnValue([]);

			const result = await migrator.needsMigration();

			expect(result).toBe(false);
		});

		it('should return true if History folder has files and Agent-Sessions does not exist', async () => {
			const mockHistoryFolder = { type: 'folder' } as unknown as TFolder;
			const mockHistoryFile = {
				path: 'gemini-scribe/History/test.md',
				basename: 'test'
			} as TFile;

			mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
				if (path === 'gemini-scribe/History') return mockHistoryFolder;
				if (path === 'gemini-scribe/Agent-Sessions') return null;
				return null;
			});

			mockVault.getMarkdownFiles.mockReturnValue([mockHistoryFile]);

			const result = await migrator.needsMigration();

			expect(result).toBe(true);
		});

		it('should return true if History has files but Agent-Sessions is empty', async () => {
			const mockHistoryFolder = { type: 'folder' } as unknown as TFolder;
			const mockAgentFolder = { type: 'folder' } as unknown as TFolder;
			const mockHistoryFile = {
				path: 'gemini-scribe/History/test.md',
				basename: 'test'
			} as TFile;

			mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
				if (path === 'gemini-scribe/History') return mockHistoryFolder;
				if (path === 'gemini-scribe/Agent-Sessions') return mockAgentFolder;
				return null;
			});

			mockVault.getMarkdownFiles.mockReturnValue([mockHistoryFile]);

			const result = await migrator.needsMigration();

			expect(result).toBe(true);
		});

		it('should return false if both folders have files', async () => {
			const mockHistoryFolder = { type: 'folder' } as unknown as TFolder;
			const mockAgentFolder = { type: 'folder' } as unknown as TFolder;
			const mockHistoryFile = {
				path: 'gemini-scribe/History/test.md',
				basename: 'test'
			} as TFile;
			const mockAgentFile = {
				path: 'gemini-scribe/Agent-Sessions/session.md',
				basename: 'session'
			} as TFile;

			mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
				if (path === 'gemini-scribe/History') return mockHistoryFolder;
				if (path === 'gemini-scribe/Agent-Sessions') return mockAgentFolder;
				return null;
			});

			mockVault.getMarkdownFiles.mockReturnValue([mockHistoryFile, mockAgentFile]);

			const result = await migrator.needsMigration();

			expect(result).toBe(false);
		});
	});

	describe('migrateAllHistory', () => {
		it('should return empty report if no history files found', async () => {
			const mockHistoryFolder = { type: 'folder' } as unknown as TFolder;
			mockVault.getAbstractFileByPath.mockReturnValue(mockHistoryFolder);
			mockVault.getMarkdownFiles.mockReturnValue([]);

			const report = await migrator.migrateAllHistory();

			expect(report.totalFilesFound).toBe(0);
			expect(report.filesProcessed).toBe(0);
			expect(report.sessionsCreated).toBe(0);
			expect(report.filesFailed).toBe(0);
			expect(report.backupCreated).toBe(false);
		});

		it('should migrate history files and create backup', async () => {
			const mockHistoryFile = {
				path: 'gemini-scribe/History/conversation.md',
				basename: 'conversation',
				stat: {
					ctime: 1234567890000,
					mtime: 1234567890000
				}
			} as TFile;

			const historyContent = `### User
Hello, how are you?

### Assistant
I'm doing well, thank you!
`;

			mockVault.getMarkdownFiles.mockReturnValue([mockHistoryFile]);
			mockVault.read.mockResolvedValue(historyContent);
			mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
				if (path === 'gemini-scribe/History') return { type: 'folder' } as unknown as TFolder;
				return null;
			});

			const report = await migrator.migrateAllHistory();

			expect(report.totalFilesFound).toBe(1);
			expect(report.filesProcessed).toBe(1);
			expect(report.sessionsCreated).toBe(1);
			expect(report.filesFailed).toBe(0);
			expect(report.backupCreated).toBe(true);
			expect(report.errors).toHaveLength(0);

			// Verify backup was created
			expect(mockVault.create).toHaveBeenCalledWith(
				expect.stringContaining('History-Archive'),
				expect.any(String)
			);

			// Verify session file was created
			expect(mockVault.create).toHaveBeenCalledWith(
				expect.stringContaining('Agent-Sessions'),
				expect.stringContaining('session-id:')
			);
		});

		it('should handle migration errors gracefully', async () => {
			const mockHistoryFile = {
				path: 'gemini-scribe/History/broken.md',
				basename: 'broken',
				stat: {
					ctime: 1234567890000,
					mtime: 1234567890000
				}
			} as TFile;

			mockVault.getMarkdownFiles.mockReturnValue([mockHistoryFile]);
			mockVault.read.mockRejectedValue(new Error('Read error'));
			mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
				if (path === 'gemini-scribe/History') return { type: 'folder' } as unknown as TFolder;
				return null;
			});

			const report = await migrator.migrateAllHistory();

			expect(report.totalFilesFound).toBe(1);
			expect(report.filesProcessed).toBe(0);
			expect(report.filesFailed).toBe(1);
			expect(report.errors.length).toBeGreaterThan(0);
		});

		it('should generate unique filenames for duplicate titles', async () => {
			const mockHistoryFile1 = {
				path: 'gemini-scribe/History/test.md',
				basename: 'test',
				stat: {
					ctime: 1234567890000,
					mtime: 1234567890000
				}
			} as TFile;

			const mockHistoryFile2 = {
				path: 'gemini-scribe/History/test2.md',
				basename: 'test',
				stat: {
					ctime: 1234567890001,
					mtime: 1234567890001
				}
			} as TFile;

			const historyContent = `### User
Test message

### Assistant
Test response
`;

			mockVault.getMarkdownFiles.mockReturnValue([mockHistoryFile1, mockHistoryFile2]);
			mockVault.read.mockResolvedValue(historyContent);

			let createdFiles: string[] = [];
			mockVault.create.mockImplementation((path: string, content: string) => {
				createdFiles.push(path);
				return Promise.resolve();
			});

			mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
				if (path === 'gemini-scribe/History') return { type: 'folder' } as unknown as TFolder;
				// Simulate first file exists after creation
				if (createdFiles.includes(path)) {
					return { path } as TFile;
				}
				return null;
			});

			const report = await migrator.migrateAllHistory();

			expect(report.totalFilesFound).toBe(2);
			expect(report.sessionsCreated).toBe(2);

			// Verify different filenames were created
			const agentSessionCreates = (mockVault.create as jest.Mock).mock.calls.filter(
				call => call[0].includes('Agent-Sessions')
			);
			expect(agentSessionCreates.length).toBe(2);
		});
	});

	describe('session title generation', () => {
		it('should use descriptive file name as title', async () => {
			const mockHistoryFile = {
				path: 'gemini-scribe/History/My Important Chat.md',
				basename: 'My Important Chat',
				stat: {
					ctime: 1234567890000,
					mtime: 1234567890000
				}
			} as TFile;

			const historyContent = `### User
Hello

### Assistant
Hi there
`;

			mockVault.getMarkdownFiles.mockReturnValue([mockHistoryFile]);
			mockVault.read.mockResolvedValue(historyContent);
			mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
				if (path === 'gemini-scribe/History') return { type: 'folder' } as unknown as TFolder;
				return null;
			});

			await migrator.migrateAllHistory();

			expect(mockVault.create).toHaveBeenCalledWith(
				expect.stringContaining('My-Important-Chat'),
				expect.any(String)
			);
		});

		it('should generate title from first message if filename is generic', async () => {
			const mockHistoryFile = {
				path: 'gemini-scribe/History/2024-01-01-chat.md',
				basename: '2024-01-01-chat',
				stat: {
					ctime: 1234567890000,
					mtime: 1234567890000
				}
			} as TFile;

			const historyContent = `### User
This is a very descriptive first message that should be used as the title

### Assistant
Response
`;

			mockVault.getMarkdownFiles.mockReturnValue([mockHistoryFile]);
			mockVault.read.mockResolvedValue(historyContent);
			mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
				if (path === 'gemini-scribe/History') return { type: 'folder' } as unknown as TFolder;
				return null;
			});

			await migrator.migrateAllHistory();

			// Should use first 50 chars of first message
			expect(mockVault.create).toHaveBeenCalledWith(
				expect.stringContaining('This-is-a-very-descriptive-first-message-that'),
				expect.any(String)
			);
		});

		it('should handle empty history files', async () => {
			const mockHistoryFile = {
				path: 'gemini-scribe/History/empty.md',
				basename: 'empty',
				stat: {
					ctime: 1234567890000,
					mtime: 1234567890000
				}
			} as TFile;

			mockVault.getMarkdownFiles.mockReturnValue([mockHistoryFile]);
			mockVault.read.mockResolvedValue('');
			mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
				if (path === 'gemini-scribe/History') return { type: 'folder' } as unknown as TFolder;
				return null;
			});

			const report = await migrator.migrateAllHistory();

			// Empty files should be skipped (not create sessions)
			expect(report.filesProcessed).toBe(0);
		});
	});

	describe('frontmatter generation', () => {
		it('should include all required metadata in frontmatter', async () => {
			const mockHistoryFile = {
				path: 'gemini-scribe/History/test.md',
				basename: 'Test Session',
				stat: {
					ctime: 1234567890000,
					mtime: 1234567890000
				}
			} as TFile;

			const historyContent = `### User
Test

### Assistant
Response
`;

			mockVault.getMarkdownFiles.mockReturnValue([mockHistoryFile]);
			mockVault.read.mockResolvedValue(historyContent);
			mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
				if (path === 'gemini-scribe/History') return { type: 'folder' } as unknown as TFolder;
				return null;
			});

			await migrator.migrateAllHistory();

			const createCall = (mockVault.create as jest.Mock).mock.calls.find(
				call => call[0].includes('Agent-Sessions')
			);

			expect(createCall).toBeDefined();
			const content = createCall[1];

			expect(content).toContain('session-id:');
			expect(content).toContain('title:');
			expect(content).toContain('type: agent-session');
			expect(content).toContain('created:');
			expect(content).toContain('updated:');
			expect(content).toContain('auto-labeled: true');
		});
	});
});
