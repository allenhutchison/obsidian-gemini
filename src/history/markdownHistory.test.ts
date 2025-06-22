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
	compile: jest.fn(() => jest.fn(() => 'compiled template')),
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
				},
			},
			gfile: {
				isFile: jest.fn(() => true),
				getFileFromPath: jest.fn(() => ({ stat: { mtime: new Date() } })),
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
});