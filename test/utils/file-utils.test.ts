import type { Mock } from 'vitest';
import {
	shouldExcludePath,
	shouldExcludePathForPlugin,
	createFileFilter,
	ensureFolderExists,
	isPathInFolder,
} from '../../src/utils/file-utils';
import { TFile, TFolder, Vault, Notice, normalizePath } from 'obsidian';

describe('file-utils', () => {
	describe('isPathInFolder', () => {
		it('matches the folder itself and anything beneath it', () => {
			expect(isPathInFolder('.obsidian', '.obsidian')).toBe(true);
			expect(isPathInFolder('.obsidian/plugins/x', '.obsidian')).toBe(true);
			expect(isPathInFolder('gemini-scribe/History', 'gemini-scribe')).toBe(true);
		});

		it('is root-anchored and does not over-match siblings', () => {
			expect(isPathInFolder('.obsidian-backup', '.obsidian')).toBe(false);
			expect(isPathInFolder('gemini-scribe-backup', 'gemini-scribe')).toBe(false);
			expect(isPathInFolder('notes/my-note.md', '.obsidian')).toBe(false);
		});
	});

	describe('shouldExcludePath', () => {
		it('should exclude the config directory', () => {
			expect(shouldExcludePath('.obsidian', undefined, '.obsidian')).toBe(true);
			expect(shouldExcludePath('.obsidian/', undefined, '.obsidian')).toBe(true);
			expect(shouldExcludePath('.obsidian/config', undefined, '.obsidian')).toBe(true);
			expect(shouldExcludePath('.obsidian/plugins/some-plugin', undefined, '.obsidian')).toBe(true);
		});

		it('should exclude custom folder when specified', () => {
			expect(shouldExcludePath('gemini-scribe', 'gemini-scribe', '.obsidian')).toBe(true);
			expect(shouldExcludePath('gemini-scribe/', 'gemini-scribe', '.obsidian')).toBe(true);
			expect(shouldExcludePath('gemini-scribe/History', 'gemini-scribe', '.obsidian')).toBe(true);
			expect(shouldExcludePath('gemini-scribe/Agent-Sessions/session.md', 'gemini-scribe', '.obsidian')).toBe(true);
		});

		it('should not exclude custom folder when not specified', () => {
			expect(shouldExcludePath('gemini-scribe', undefined, '.obsidian')).toBe(false);
			expect(shouldExcludePath('gemini-scribe/History', undefined, '.obsidian')).toBe(false);
		});

		it('should not exclude regular files and folders', () => {
			expect(shouldExcludePath('notes/my-note.md', undefined, '.obsidian')).toBe(false);
			expect(shouldExcludePath('Projects/Project A/README.md', undefined, '.obsidian')).toBe(false);
			expect(shouldExcludePath('Daily Notes', undefined, '.obsidian')).toBe(false);
			expect(shouldExcludePath('my-note.md', 'gemini-scribe', '.obsidian')).toBe(false);
		});

		it('should handle different custom folder names', () => {
			expect(shouldExcludePath('custom-state', 'custom-state', '.obsidian')).toBe(true);
			expect(shouldExcludePath('custom-state/subfolder', 'custom-state', '.obsidian')).toBe(true);
			expect(shouldExcludePath('other-folder', 'custom-state', '.obsidian')).toBe(false);
		});

		it('should not exclude files with similar names to excluded folders', () => {
			// File named .obsidian-something is not in .obsidian folder
			expect(shouldExcludePath('.obsidian-backup', undefined, '.obsidian')).toBe(false);
			expect(shouldExcludePath('gemini-scribe-backup', 'gemini-scribe', '.obsidian')).toBe(false);
		});

		it('should exclude a renamed config directory when configDir is supplied', () => {
			expect(shouldExcludePath('_obsidian', undefined, '_obsidian')).toBe(true);
			expect(shouldExcludePath('_obsidian/plugins/some-plugin', undefined, '_obsidian')).toBe(true);
		});

		it('should not over-match a literal .obsidian folder when configDir is renamed', () => {
			// The user renamed their config dir to _obsidian, so a vault folder that
			// happens to be named .obsidian is real content and must not be excluded.
			expect(shouldExcludePath('.obsidian/plugins/some-plugin', undefined, '_obsidian')).toBe(false);
			expect(shouldExcludePath('.obsidian', undefined, '_obsidian')).toBe(false);
		});

		it('should still exclude .obsidian when configDir is explicitly .obsidian', () => {
			expect(shouldExcludePath('.obsidian', undefined, '.obsidian')).toBe(true);
			expect(shouldExcludePath('.obsidian/config', undefined, '.obsidian')).toBe(true);
			expect(shouldExcludePath('notes/note.md', undefined, '.obsidian')).toBe(false);
		});

		it('should honor both excludeFolder and a custom configDir together', () => {
			expect(shouldExcludePath('gemini-scribe/History', 'gemini-scribe', '_obsidian')).toBe(true);
			expect(shouldExcludePath('_obsidian/app.json', 'gemini-scribe', '_obsidian')).toBe(true);
			expect(shouldExcludePath('notes/note.md', 'gemini-scribe', '_obsidian')).toBe(false);
		});
	});

	describe('shouldExcludePathForPlugin', () => {
		const mockPlugin = {
			settings: {
				historyFolder: 'gemini-scribe',
			},
			app: {
				vault: {
					configDir: '.obsidian',
				},
			},
		} as any;

		it('should use plugin settings for exclusion', () => {
			expect(shouldExcludePathForPlugin('gemini-scribe', mockPlugin)).toBe(true);
			expect(shouldExcludePathForPlugin('gemini-scribe/History', mockPlugin)).toBe(true);
			expect(shouldExcludePathForPlugin('.obsidian', mockPlugin)).toBe(true);
			expect(shouldExcludePathForPlugin('normal-note.md', mockPlugin)).toBe(false);
		});

		it('should work with different configured folder names', () => {
			const customPlugin = {
				settings: {
					historyFolder: 'my-custom-folder',
				},
				app: {
					vault: {
						configDir: '.obsidian',
					},
				},
			} as any;

			expect(shouldExcludePathForPlugin('my-custom-folder', customPlugin)).toBe(true);
			expect(shouldExcludePathForPlugin('my-custom-folder/sub', customPlugin)).toBe(true);
			expect(shouldExcludePathForPlugin('gemini-scribe', customPlugin)).toBe(false);
		});

		it('should use the vault configDir so a renamed config directory is excluded', () => {
			const renamedConfigPlugin = {
				settings: {
					historyFolder: 'gemini-scribe',
				},
				app: {
					vault: {
						configDir: '_obsidian',
					},
				},
			} as any;

			// The renamed config dir is excluded...
			expect(shouldExcludePathForPlugin('_obsidian', renamedConfigPlugin)).toBe(true);
			expect(shouldExcludePathForPlugin('_obsidian/plugins/x', renamedConfigPlugin)).toBe(true);
			// ...and a real vault folder literally named .obsidian is NOT over-matched.
			expect(shouldExcludePathForPlugin('.obsidian/plugins/x', renamedConfigPlugin)).toBe(false);
		});
	});

	describe('createFileFilter', () => {
		it('should create a filter function that excludes the config directory', () => {
			const filter = createFileFilter(undefined, '.obsidian');

			const obsidianFile = { path: '.obsidian/config' } as TFile;
			const normalFile = { path: 'notes/my-note.md' } as TFile;

			expect(filter(obsidianFile)).toBe(false);
			expect(filter(normalFile)).toBe(true);
		});

		it('should create a filter function that excludes a renamed config directory', () => {
			const filter = createFileFilter(undefined, '_obsidian');

			expect(filter({ path: '_obsidian/workspace' } as TFile)).toBe(false);
			// A real vault folder literally named .obsidian is not over-matched.
			expect(filter({ path: '.obsidian/workspace' } as TFile)).toBe(true);
		});

		it('should create a filter function that excludes custom folder', () => {
			const filter = createFileFilter('gemini-scribe', '.obsidian');

			const stateFile = { path: 'gemini-scribe/History/chat.md' } as TFile;
			const obsidianFile = { path: '.obsidian/workspace' } as TFile;
			const normalFile = { path: 'notes/my-note.md' } as TFile;

			expect(filter(stateFile)).toBe(false);
			expect(filter(obsidianFile)).toBe(false);
			expect(filter(normalFile)).toBe(true);
		});

		it('should work with Array.filter()', () => {
			const files = [
				{ path: 'notes/note1.md' } as TFile,
				{ path: '.obsidian/config' } as TFile,
				{ path: 'gemini-scribe/History/chat.md' } as TFile,
				{ path: 'Projects/project.md' } as TFile,
				{ path: 'gemini-scribe/Prompts/custom.md' } as TFile,
			];

			const filtered = files.filter(createFileFilter('gemini-scribe', '.obsidian'));

			expect(filtered).toHaveLength(2);
			expect(filtered[0].path).toBe('notes/note1.md');
			expect(filtered[1].path).toBe('Projects/project.md');
		});

		it('should work with TFolder as well as TFile', () => {
			const filter = createFileFilter('gemini-scribe', '.obsidian');

			const stateFolder = { path: 'gemini-scribe' } as TFolder;
			const normalFolder = { path: 'Projects' } as TFolder;

			expect(filter(stateFolder)).toBe(false);
			expect(filter(normalFolder)).toBe(true);
		});
	});

	describe('ensureFolderExists', () => {
		let mockVault: {
			getAbstractFileByPath: Mock;
			createFolder: Mock;
			adapter: { exists: Mock };
		};

		beforeEach(() => {
			mockVault = {
				getAbstractFileByPath: vi.fn(),
				createFolder: vi.fn(),
				adapter: { exists: vi.fn().mockResolvedValue(false) },
			};
			(Notice as unknown as Mock).mockClear();
		});

		it('should return existing folder without creating', async () => {
			const existingFolder = Object.assign(new TFolder(), { path: 'my-folder' });
			mockVault.getAbstractFileByPath.mockReturnValue(existingFolder);

			const result = await ensureFolderExists(mockVault as unknown as Vault, 'my-folder');

			expect(result).toBe(existingFolder);
			expect(mockVault.createFolder).not.toHaveBeenCalled();
		});

		it('should create folder when it does not exist', async () => {
			const createdFolder = Object.assign(new TFolder(), { path: 'new-folder' });
			mockVault.getAbstractFileByPath.mockReturnValueOnce(null).mockReturnValueOnce(createdFolder);
			mockVault.createFolder.mockResolvedValue(undefined);

			const result = await ensureFolderExists(mockVault as unknown as Vault, 'new-folder');

			expect(mockVault.createFolder).toHaveBeenCalledWith('new-folder');
			expect(result).toBe(createdFolder);
		});

		it('should handle race condition where folder is created concurrently', async () => {
			const concurrentFolder = Object.assign(new TFolder(), { path: 'race-folder' });
			// First check: not found; adapter check: not found; createFolder throws; adapter re-check: found
			mockVault.getAbstractFileByPath.mockReturnValueOnce(null).mockReturnValueOnce(concurrentFolder);
			mockVault.adapter.exists.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
			mockVault.createFolder.mockRejectedValue(new Error('Folder already exists'));

			const result = await ensureFolderExists(mockVault as unknown as Vault, 'race-folder');

			expect(result).toBe(concurrentFolder);
			expect(Notice).not.toHaveBeenCalled();
		});

		it('should handle folder existing on disk but not in metadata cache (early init)', async () => {
			// Metadata cache returns null, but filesystem adapter confirms existence
			mockVault.getAbstractFileByPath.mockReturnValue(null);
			mockVault.adapter.exists.mockResolvedValue(true);

			const result = await ensureFolderExists(mockVault as unknown as Vault, 'synced-folder');

			expect(result.path).toBe('synced-folder');
			expect(mockVault.createFolder).not.toHaveBeenCalled();
		});

		it('should show Notice and throw when creation genuinely fails', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(null);
			mockVault.createFolder.mockRejectedValue(new Error('Permission denied'));

			await expect(ensureFolderExists(mockVault as unknown as Vault, 'bad-folder', 'skills')).rejects.toThrow(
				'Failed to create folder "bad-folder" (skills): Permission denied'
			);

			expect(Notice).toHaveBeenCalledWith(
				'Gemini Scribe: Failed to create folder "bad-folder" (skills): Permission denied'
			);
		});

		it('should include context label in error messages when provided', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(null);
			mockVault.createFolder.mockRejectedValue(new Error('Disk full'));

			await expect(ensureFolderExists(mockVault as unknown as Vault, 'some-folder', 'agent sessions')).rejects.toThrow(
				'(agent sessions)'
			);
		});

		it('should work without context label', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(null);
			mockVault.createFolder.mockRejectedValue(new Error('Disk full'));

			await expect(ensureFolderExists(mockVault as unknown as Vault, 'some-folder')).rejects.toThrow(
				'Failed to create folder "some-folder": Disk full'
			);
		});

		it('should normalize the folder path', async () => {
			const folder = Object.assign(new TFolder(), { path: 'normalized/path' });
			mockVault.getAbstractFileByPath.mockReturnValue(folder);

			await ensureFolderExists(mockVault as unknown as Vault, 'normalized/path');

			// normalizePath mock just returns the input, but verifies it was called
			expect(normalizePath).toHaveBeenCalledWith('normalized/path');
		});
	});
});
