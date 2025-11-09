import { shouldExcludePath, shouldExcludePathForPlugin, createFileFilter } from '../../src/utils/file-utils';
import { TFile, TFolder } from 'obsidian';

describe('file-utils', () => {
	describe('shouldExcludePath', () => {
		it('should exclude .obsidian folder', () => {
			expect(shouldExcludePath('.obsidian')).toBe(true);
			expect(shouldExcludePath('.obsidian/')).toBe(true);
			expect(shouldExcludePath('.obsidian/config')).toBe(true);
			expect(shouldExcludePath('.obsidian/plugins/some-plugin')).toBe(true);
		});

		it('should exclude custom folder when specified', () => {
			expect(shouldExcludePath('gemini-scribe', 'gemini-scribe')).toBe(true);
			expect(shouldExcludePath('gemini-scribe/', 'gemini-scribe')).toBe(true);
			expect(shouldExcludePath('gemini-scribe/History', 'gemini-scribe')).toBe(true);
			expect(shouldExcludePath('gemini-scribe/Agent-Sessions/session.md', 'gemini-scribe')).toBe(true);
		});

		it('should not exclude custom folder when not specified', () => {
			expect(shouldExcludePath('gemini-scribe')).toBe(false);
			expect(shouldExcludePath('gemini-scribe/History')).toBe(false);
		});

		it('should not exclude regular files and folders', () => {
			expect(shouldExcludePath('notes/my-note.md')).toBe(false);
			expect(shouldExcludePath('Projects/Project A/README.md')).toBe(false);
			expect(shouldExcludePath('Daily Notes')).toBe(false);
			expect(shouldExcludePath('my-note.md', 'gemini-scribe')).toBe(false);
		});

		it('should handle different custom folder names', () => {
			expect(shouldExcludePath('custom-state', 'custom-state')).toBe(true);
			expect(shouldExcludePath('custom-state/subfolder', 'custom-state')).toBe(true);
			expect(shouldExcludePath('other-folder', 'custom-state')).toBe(false);
		});

		it('should not exclude files with similar names to excluded folders', () => {
			// File named .obsidian-something is not in .obsidian folder
			expect(shouldExcludePath('.obsidian-backup')).toBe(false);
			expect(shouldExcludePath('gemini-scribe-backup', 'gemini-scribe')).toBe(false);
		});
	});

	describe('shouldExcludePathForPlugin', () => {
		const mockPlugin = {
			settings: {
				historyFolder: 'gemini-scribe'
			}
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
					historyFolder: 'my-custom-folder'
				}
			} as any;

			expect(shouldExcludePathForPlugin('my-custom-folder', customPlugin)).toBe(true);
			expect(shouldExcludePathForPlugin('my-custom-folder/sub', customPlugin)).toBe(true);
			expect(shouldExcludePathForPlugin('gemini-scribe', customPlugin)).toBe(false);
		});
	});

	describe('createFileFilter', () => {
		it('should create a filter function that excludes .obsidian', () => {
			const filter = createFileFilter();

			const obsidianFile = { path: '.obsidian/config' } as TFile;
			const normalFile = { path: 'notes/my-note.md' } as TFile;

			expect(filter(obsidianFile)).toBe(false);
			expect(filter(normalFile)).toBe(true);
		});

		it('should create a filter function that excludes custom folder', () => {
			const filter = createFileFilter('gemini-scribe');

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

			const filtered = files.filter(createFileFilter('gemini-scribe'));

			expect(filtered).toHaveLength(2);
			expect(filtered[0].path).toBe('notes/note1.md');
			expect(filtered[1].path).toBe('Projects/project.md');
		});

		it('should work with TFolder as well as TFile', () => {
			const filter = createFileFilter('gemini-scribe');

			const stateFolder = { path: 'gemini-scribe' } as TFolder;
			const normalFolder = { path: 'Projects' } as TFolder;

			expect(filter(stateFolder)).toBe(false);
			expect(filter(normalFolder)).toBe(true);
		});
	});
});
