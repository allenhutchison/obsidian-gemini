import type { Mock } from 'vitest';
import {
	shouldExcludePath,
	shouldExcludePathForPlugin,
	createFileFilter,
	ensureFolderExists,
	ensureParentFolderExists,
	getFileName,
	getParentPath,
	isPathInFolder,
	validateGeneratedOutputPath,
} from '../../src/utils/file-utils';
import type { GeneratedOutputPathOptions } from '../../src/utils/file-utils';
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

	describe('getParentPath', () => {
		it('returns the folder prefix for nested paths', () => {
			expect(getParentPath('a/b/c.md')).toBe('a/b');
			expect(getParentPath('folder/note.md')).toBe('folder');
		});

		it('returns null at the vault root', () => {
			expect(getParentPath('out.md')).toBeNull();
			expect(getParentPath('README')).toBeNull();
		});

		it('produces no trailing slash for a top-level folder', () => {
			expect(getParentPath('folder/sub/file.md')).toBe('folder/sub');
			expect(getParentPath('x/file.md')).toBe('x');
		});

		it('is not confused by a dot inside a folder name', () => {
			expect(getParentPath('my.notes/README.md')).toBe('my.notes');
			expect(getParentPath('v1.2/notes/a.md')).toBe('v1.2/notes');
		});
	});

	describe('getFileName', () => {
		it('returns the final path segment', () => {
			expect(getFileName('folder/sub/note.md')).toBe('note.md');
			expect(getFileName('a/b.png')).toBe('b.png');
		});

		it('returns the input unchanged for root-level paths', () => {
			expect(getFileName('out.md')).toBe('out.md');
			expect(getFileName('README')).toBe('README');
		});

		it('keeps dotfiles intact', () => {
			expect(getFileName('folder/.obsidian.app.css')).toBe('.obsidian.app.css');
		});
	});

	describe('ensureParentFolderExists', () => {
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
		});

		it('is a no-op for a root-level path — no existence checks, no create', async () => {
			await ensureParentFolderExists(mockVault as unknown as Vault, 'out.md');

			expect(mockVault.getAbstractFileByPath).not.toHaveBeenCalled();
			expect(mockVault.adapter.exists).not.toHaveBeenCalled();
			expect(mockVault.createFolder).not.toHaveBeenCalled();
		});

		it('delegates to ensureFolderExists with the derived parent', async () => {
			const folder = Object.assign(new TFolder(), { path: 'folder' });
			mockVault.getAbstractFileByPath.mockReturnValue(folder);

			await ensureParentFolderExists(mockVault as unknown as Vault, 'folder/out.md', 'parent directory');

			expect(mockVault.getAbstractFileByPath).toHaveBeenCalledWith('folder');
			expect(mockVault.createFolder).not.toHaveBeenCalled();
		});

		it('creates a missing nested parent and propagates context and errors', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(null);
			mockVault.createFolder.mockRejectedValue(new Error('Disk full'));

			await expect(
				ensureParentFolderExists(mockVault as unknown as Vault, 'a/b/out.md', 'image output folder')
			).rejects.toThrow('Failed to create folder "a/b" (image output folder): Disk full');
		});
	});

	// #1401: the write-path policy shared by deep-research and image-generation.
	// Each reject arm is asserted here once, so the two callers only have to
	// cover their own wording and their own extras (e.g. the .png rewrite).
	describe('validateGeneratedOutputPath', () => {
		const messages = {
			'missing-filename': (p: string) => `missing-filename:${p}`,
			'vault-escape': (p: string) => `vault-escape:${p}`,
			'config-folder': (p: string) => `config-folder:${p}`,
			'state-folder': (p: string) => `state-folder:${p}`,
		};
		const options: GeneratedOutputPathOptions = {
			configDir: '.obsidian',
			historyFolder: 'gemini-scribe',
			allowedSubfolder: 'Background-Tasks',
			messages,
		};
		const validate = (path: string, overrides: Partial<GeneratedOutputPathOptions> = {}): string =>
			validateGeneratedOutputPath(path, { ...options, ...overrides });

		it('returns the normalized path for an ordinary vault path', () => {
			expect(validate('Notes//foo.md')).toBe('Notes/foo.md');
		});

		it('allows the allowed subfolder under the state folder', () => {
			expect(validate('gemini-scribe/Background-Tasks/out.md')).toBe('gemini-scribe/Background-Tasks/out.md');
		});

		it('rejects empty and blank paths', () => {
			expect(() => validate('')).toThrow('missing-filename:');
			expect(() => validate('   ')).toThrow('missing-filename:');
		});

		it('rejects vault-escaping paths', () => {
			expect(() => validate('../outside.md')).toThrow('vault-escape:../outside.md');
			expect(() => validate('Notes/../../outside.md')).toThrow('vault-escape:');
		});

		it('rejects the config folder itself and paths beneath it', () => {
			expect(() => validate('.obsidian')).toThrow('config-folder:.obsidian');
			expect(() => validate('.obsidian/snippets/x.md')).toThrow('config-folder:');
		});

		it('rejects the bare state folder and its other subfolders', () => {
			expect(() => validate('gemini-scribe')).toThrow('state-folder:gemini-scribe');
			expect(() => validate('gemini-scribe/Skills/x.md')).toThrow('state-folder:');
		});

		it('does not treat a sibling-prefixed folder as the allowed subfolder', () => {
			expect(() => validate('gemini-scribe/Background-Tasks-Other/x.md')).toThrow('state-folder:');
		});

		it('does not over-match a folder that merely shares the state folder prefix', () => {
			expect(validate('gemini-scribe-backup/x.md')).toBe('gemini-scribe-backup/x.md');
		});

		it('skips the state-folder check when no history folder is configured', () => {
			expect(validate('gemini-scribe/Skills/x.md', { historyFolder: undefined })).toBe('gemini-scribe/Skills/x.md');
		});

		it('applies rewriteFileName after the config check and before the state-folder check', () => {
			const rewriteFileName = (p: string) => `${p}.png`;

			// The rewritten path is what gets returned...
			expect(validate('Notes/img', { rewriteFileName })).toBe('Notes/img.png');

			// ...and what the state-folder check sees: a bare allowed-subfolder
			// path becomes a file directly under the state folder, so it is
			// rejected rather than slipping through as the subfolder itself.
			expect(() => validate('gemini-scribe/Background-Tasks', { rewriteFileName })).toThrow('state-folder:');

			// The config-folder check still runs against the pre-rewrite path.
			expect(() => validate('.obsidian/x', { rewriteFileName })).toThrow('config-folder:');
		});
	});
});
