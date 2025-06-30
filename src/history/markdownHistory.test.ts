import { MarkdownHistory } from './markdownHistory';
import { TFile, Notice, normalizePath } from 'obsidian';
import ObsidianGemini from '../../main';

// Mock obsidian module
jest.mock('obsidian', () => ({
	TFile: jest.fn(),
	Notice: jest.fn(),
	normalizePath: jest.fn((path: string) => path),
}));

// Mock Handlebars
jest.mock('handlebars', () => ({
	registerHelper: jest.fn(),
	compile: jest.fn(() => jest.fn((context) => {
		// Simple mock that includes temperature and topP if they are defined
		let result = 'compiled template';
		if (context.temperature !== undefined) {
			result += ` temperature:${context.temperature}`;
		}
		if (context.topP !== undefined) {
			result += ` topP:${context.topP}`;
		}
		return result;
	})),
}));

// Mock the template import
jest.mock('./templates/historyEntry.hbs', () => 'mock template', { virtual: true });

describe('MarkdownHistory', () => {
	let markdownHistory: MarkdownHistory;
	let mockPlugin: any;

	beforeEach(() => {
		mockPlugin = {
			settings: {
				historyFolder: 'gemini-scribe',
				chatHistory: true,
			},
			app: {
				metadataCache: {
					getFileCache: jest.fn(),
					getFirstLinkpathDest: jest.fn(),
				},
				fileManager: {
					processFrontMatter: jest.fn(),
				},
				vault: {
					adapter: {
						exists: jest.fn(),
						list: jest.fn(),
						write: jest.fn(),
						read: jest.fn(),
						rmdir: jest.fn(() => Promise.resolve()),
					},
					createFolder: jest.fn(() => Promise.resolve()),
					getAbstractFileByPath: jest.fn(),
					rename: jest.fn(() => Promise.resolve()),
					delete: jest.fn(() => Promise.resolve()),
					create: jest.fn(() => Promise.resolve()),
					read: jest.fn(() => Promise.resolve()),
				},
			},
			gfile: {
				isFile: jest.fn(() => true),
				getFileFromPath: jest.fn(() => ({ stat: { mtime: new Date() } })),
				getLinkText: jest.fn((file) => `[[${file.path}]]`),
			},
		};

		markdownHistory = new MarkdownHistory(mockPlugin as ObsidianGemini);
	});

	describe('getHistoryFilePath', () => {
		it('should return path with History subfolder', () => {
			const result = (markdownHistory as any).getHistoryFilePath('notes/test.md');
			expect(result).toBe('gemini-scribe/History/notes_test.md');
		});

		it('should handle root files with prefix', () => {
			const result = (markdownHistory as any).getHistoryFilePath('test.md');
			expect(result).toBe('gemini-scribe/History/root_test.md');
		});
	});

	describe('migrateAllLegacyFiles', () => {
		it('should skip migration if chat history is disabled', async () => {
			mockPlugin.settings.chatHistory = false;

			await markdownHistory.migrateAllLegacyFiles();

			expect(mockPlugin.app.vault.adapter.exists).not.toHaveBeenCalled();
		});

		it('should skip migration if marker file exists', async () => {
			mockPlugin.app.vault.adapter.exists.mockResolvedValue(true);

			await markdownHistory.migrateAllLegacyFiles();

			expect(mockPlugin.app.vault.adapter.list).not.toHaveBeenCalled();
		});

		it('should migrate legacy files to History subfolder', async () => {
			// Setup: marker doesn't exist, but legacy files do
			mockPlugin.app.vault.adapter.exists
				.mockResolvedValueOnce(false) // marker doesn't exist
				.mockResolvedValue(false); // target files don't exist

			mockPlugin.app.vault.adapter.list.mockResolvedValue({
				files: [
					'gemini-scribe/legacy-file.md',
					'gemini-scribe/another-legacy.md',
					'gemini-scribe/History/already-migrated.md', // Should be ignored
				],
				folders: ['gemini-scribe/History'],
			});

			// Create proper TFile mocks
			const TFile = jest.requireMock('obsidian').TFile;
			const mockLegacyFile1 = Object.create(TFile.prototype);
			mockLegacyFile1.name = 'legacy-file.md';
			const mockLegacyFile2 = Object.create(TFile.prototype);
			mockLegacyFile2.name = 'another-legacy.md';
			
			mockPlugin.app.vault.getAbstractFileByPath
				.mockReturnValueOnce(mockLegacyFile1)
				.mockReturnValueOnce(mockLegacyFile2);

			await markdownHistory.migrateAllLegacyFiles();

			// Should create folders
			expect(mockPlugin.app.vault.createFolder).toHaveBeenCalledWith('gemini-scribe');
			expect(mockPlugin.app.vault.createFolder).toHaveBeenCalledWith('gemini-scribe/History');

			// Should rename legacy files
			expect(mockPlugin.app.vault.rename).toHaveBeenCalledWith(
				mockLegacyFile1,
				'gemini-scribe/History/legacy-file.md'
			);
			expect(mockPlugin.app.vault.rename).toHaveBeenCalledWith(
				mockLegacyFile2,
				'gemini-scribe/History/another-legacy.md'
			);

			// Should create marker file
			expect(mockPlugin.app.vault.adapter.write).toHaveBeenCalledWith(
				'gemini-scribe/.migration-completed',
				expect.stringContaining('Migration completed')
			);
		});

		it('should delete legacy file if target already exists', async () => {
			mockPlugin.app.vault.adapter.exists
				.mockResolvedValueOnce(false) // marker doesn't exist
				.mockResolvedValueOnce(true); // target exists

			mockPlugin.app.vault.adapter.list.mockResolvedValue({
				files: ['gemini-scribe/legacy-file.md'],
				folders: [],
			});

			const TFile = jest.requireMock('obsidian').TFile;
			const mockLegacyFile = Object.create(TFile.prototype);
			mockLegacyFile.name = 'legacy-file.md';
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockLegacyFile);

			await markdownHistory.migrateAllLegacyFiles();

			// Should delete the legacy file instead of renaming
			expect(mockPlugin.app.vault.delete).toHaveBeenCalledWith(mockLegacyFile);
			expect(mockPlugin.app.vault.rename).not.toHaveBeenCalled();
		});

		it('should handle migration errors gracefully', async () => {
			mockPlugin.app.vault.adapter.exists.mockResolvedValueOnce(false);
			mockPlugin.app.vault.adapter.list.mockResolvedValue({
				files: ['gemini-scribe/legacy-file.md'],
				folders: [],
			});

			const TFile = jest.requireMock('obsidian').TFile;
			const mockLegacyFile = Object.create(TFile.prototype);
			mockLegacyFile.name = 'legacy-file.md';
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockLegacyFile);
			mockPlugin.app.vault.adapter.exists.mockResolvedValueOnce(false);
			mockPlugin.app.vault.rename.mockRejectedValue(new Error('Rename failed'));

			const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

			await markdownHistory.migrateAllLegacyFiles();

			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining('Failed to migrate history file'),
				expect.any(Error)
			);

			// Should still create marker file
			expect(mockPlugin.app.vault.adapter.write).toHaveBeenCalledWith(
				'gemini-scribe/.migration-completed',
				expect.stringContaining('Migrated 0 files')
			);

			consoleSpy.mockRestore();
		});
	});

	describe('appendHistoryForFile', () => {
		it('should create History subfolder when appending', async () => {
			const mockFile = { path: 'test.md' } as TFile;
			const entry = {
				role: 'user' as const,
				message: 'test message',
			};

			mockPlugin.app.vault.adapter.exists.mockResolvedValue(false);

			await markdownHistory.appendHistoryForFile(mockFile, entry);

			// Should create both base folder and History subfolder
			expect(mockPlugin.app.vault.createFolder).toHaveBeenCalledWith('gemini-scribe');
			expect(mockPlugin.app.vault.createFolder).toHaveBeenCalledWith('gemini-scribe/History');
		});
	});

	describe('clearHistory', () => {
		it('should only clear History subfolder, not entire state folder', async () => {
			const historySubfolder = 'gemini-scribe/History';
			mockPlugin.app.vault.adapter.exists.mockResolvedValue(true);

			await markdownHistory.clearHistory();

			// Should remove only the History subfolder
			expect(mockPlugin.app.vault.adapter.rmdir).toHaveBeenCalledWith(historySubfolder, true);
			
			// Should recreate folders
			expect(mockPlugin.app.vault.createFolder).toHaveBeenCalledWith('gemini-scribe');
			expect(mockPlugin.app.vault.createFolder).toHaveBeenCalledWith(historySubfolder);
		});

		it('should skip clearing if chat history is disabled', async () => {
			mockPlugin.settings.chatHistory = false;

			await markdownHistory.clearHistory();

			expect(mockPlugin.app.vault.adapter.rmdir).not.toHaveBeenCalled();
		});
	});

	describe('temperature and topP metadata', () => {
		beforeEach(() => {
			// Reset plugin settings for each test
			mockPlugin.settings.temperature = 0.7;
			mockPlugin.settings.topP = 1;
			mockPlugin.manifest = { version: '1.0.0' };
		});

		it('should include temperature and topP in saved metadata', async () => {
			const testPath = 'test.md';
			const historyPath = 'gemini-scribe/History/root_test.md';
			const mockFile = { path: testPath, stat: { mtime: new Date() } };
			const entry = {
				role: 'model' as const,
				message: 'Test response',
				userMessage: 'Test prompt',
				model: 'gemini-pro',
				metadata: {
					temperature: 0.5,
					topP: 0.9,
				},
			};

			mockPlugin.app.vault.adapter.exists.mockResolvedValue(false);
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(null);
			mockPlugin.app.vault.create.mockResolvedValue({ path: historyPath });
			mockPlugin.gfile.getFileFromPath.mockReturnValue(mockFile);

			await markdownHistory.appendHistoryForFile(mockFile as any, entry);

			// Check that create was called with the correct path
			expect(mockPlugin.app.vault.create).toHaveBeenCalledWith(
				historyPath,
				expect.any(String)
			);
			
			// Get the content that was passed to create
			const createCall = mockPlugin.app.vault.create.mock.calls[0];
			const writtenContent = createCall[1];

			// The content should include compiled template
			expect(writtenContent).toContain('compiled template');
		});

		it('should save zero values for temperature and topP', async () => {
			const testPath = 'test.md';
			const historyPath = 'gemini-scribe/History/root_test.md';
			const mockFile = { path: testPath, stat: { mtime: new Date() } };
			const entry = {
				role: 'model' as const,
				message: 'Test response',
				userMessage: 'Test prompt',
				model: 'gemini-pro',
				metadata: {
					temperature: 0,
					topP: 0,
				},
			};

			mockPlugin.app.vault.adapter.exists.mockResolvedValue(false);
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(null);
			mockPlugin.app.vault.create.mockResolvedValue({ path: historyPath });
			mockPlugin.gfile.getFileFromPath.mockReturnValue(mockFile);

			await markdownHistory.appendHistoryForFile(mockFile as any, entry);

			// Check that create was called
			expect(mockPlugin.app.vault.create).toHaveBeenCalled();
			
			// Get the content that was passed to create
			const createCall = mockPlugin.app.vault.create.mock.calls[0];
			const writtenContent = createCall[1];

			// Should contain both temperature and topP with 0 values
			expect(writtenContent).toContain('temperature:0');
			expect(writtenContent).toContain('topP:0');
		});

		it('should handle entries without temperature and topP', async () => {
			const testPath = 'test.md';
			const historyPath = 'gemini-scribe/History/root_test.md';
			const mockFile = { path: testPath, stat: { mtime: new Date() } };
			const entry = {
				role: 'user' as const,
				message: 'Test message',
			};

			mockPlugin.app.vault.adapter.exists.mockResolvedValue(false);
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(null);
			mockPlugin.app.vault.create.mockResolvedValue({ path: historyPath });
			mockPlugin.gfile.getFileFromPath.mockReturnValue(mockFile);

			await markdownHistory.appendHistoryForFile(mockFile as any, entry);

			expect(mockPlugin.app.vault.create).toHaveBeenCalled();
		});

		it('should parse temperature and topP from history content', async () => {
			const historyContent = `# Chat History
*Started: 2023-01-01T00:00:00.000Z*
*Plugin Version: 1.0.0*

---

## Model

> [!metadata]- Message Info
> | Property | Value |
> | -------- | ----- |
> | Time | 2023-01-01T00:00:00.000Z |
> | File Version | 1 |
> | Model | gemini-pro |
> | Temperature | 0.5 |
> | Top P | 0.9 |

> [!assistant]+
> Test response

---`;

			const mockFile = { path: 'test.md', stat: { mtime: new Date() } };
			const TFile = jest.requireMock('obsidian').TFile;
			const mockHistoryFile = new TFile();
			mockHistoryFile.path = 'gemini-scribe/History/root_test.md';
			
			mockPlugin.app.vault.adapter.read.mockResolvedValue(historyContent);
			mockPlugin.app.vault.adapter.exists.mockResolvedValue(true);
			mockPlugin.app.vault.adapter.list.mockResolvedValue({
				files: [],
				folders: [],
			});
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockHistoryFile);
			mockPlugin.app.vault.read.mockResolvedValue(historyContent);
			mockPlugin.gfile.getFileFromPath.mockReturnValue(mockFile);
			
			const history = await markdownHistory.getHistoryForFile(mockFile as any);

			expect(history).toHaveLength(1);
			expect(history![0].metadata).toEqual(
				expect.objectContaining({
					temperature: 0.5,
					topP: 0.9,
				})
			);
		});

		it('should handle zero values for temperature and topP', async () => {
			const historyContent = `# Chat History
*Started: 2023-01-01T00:00:00.000Z*
*Plugin Version: 1.0.0*

---

## Model

> [!metadata]- Message Info
> | Property | Value |
> | -------- | ----- |
> | Time | 2023-01-01T00:00:00.000Z |
> | File Version | 1 |
> | Model | gemini-pro |
> | Temperature | 0 |
> | Top P | 0 |

> [!assistant]+
> Test response

---`;

			const mockFile = { path: 'test.md', stat: { mtime: new Date() } };
			const TFile = jest.requireMock('obsidian').TFile;
			const mockHistoryFile = new TFile();
			mockHistoryFile.path = 'gemini-scribe/History/root_test.md';
			
			mockPlugin.app.vault.adapter.read.mockResolvedValue(historyContent);
			mockPlugin.app.vault.adapter.exists.mockResolvedValue(true);
			mockPlugin.app.vault.adapter.list.mockResolvedValue({
				files: [],
				folders: [],
			});
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockHistoryFile);
			mockPlugin.app.vault.read.mockResolvedValue(historyContent);
			mockPlugin.gfile.getFileFromPath.mockReturnValue(mockFile);
			
			const history = await markdownHistory.getHistoryForFile(mockFile as any);

			expect(history).toHaveLength(1);
			expect(history![0].metadata).toEqual(
				expect.objectContaining({
					temperature: 0,
					topP: 0,
				})
			);
		});

		it('should handle history entries without temperature and topP', async () => {
			const historyContent = `# Chat History
*Started: 2023-01-01T00:00:00.000Z*
*Plugin Version: 1.0.0*

---

## User

> [!metadata]- Message Info
> | Property | Value |
> | -------- | ----- |
> | Time | 2023-01-01T00:00:00.000Z |
> | File Version | 1 |

> [!user]+
> Test message

---`;

			const mockFile = { path: 'test.md', stat: { mtime: new Date() } };
			const TFile = jest.requireMock('obsidian').TFile;
			const mockHistoryFile = new TFile();
			mockHistoryFile.path = 'gemini-scribe/History/root_test.md';
			
			mockPlugin.app.vault.adapter.read.mockResolvedValue(historyContent);
			mockPlugin.app.vault.adapter.exists.mockResolvedValue(true);
			mockPlugin.app.vault.adapter.list.mockResolvedValue({
				files: [],
				folders: [],
			});
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockHistoryFile);
			mockPlugin.app.vault.read.mockResolvedValue(historyContent);
			mockPlugin.gfile.getFileFromPath.mockReturnValue(mockFile);
			
			const history = await markdownHistory.getHistoryForFile(mockFile as any);

			expect(history).toHaveLength(1);
			expect(history![0].metadata).toBeUndefined();
		});
	});
});