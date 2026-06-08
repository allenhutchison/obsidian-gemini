import { TAbstractFile, TFile, TFolder } from 'obsidian';
import { collectFilesFromFolder, collectFoldersFromFolder } from '../../src/utils/folder-walk';

function makeFile(path: string): TFile {
	const dot = path.lastIndexOf('.');
	const extension = dot >= 0 ? path.slice(dot + 1) : '';
	return Object.assign(new TFile(), { path, extension });
}

function makeFolder(path: string, children: TAbstractFile[] = []): TFolder {
	return Object.assign(new TFolder(), { path, children });
}

describe('folder-walk', () => {
	describe('collectFilesFromFolder', () => {
		it('returns an empty array for an empty folder', () => {
			expect(collectFilesFromFolder(makeFolder('root'))).toEqual([]);
		});

		it('collects a single file at the root', () => {
			const file = makeFile('root/note.md');
			const root = makeFolder('root', [file]);

			expect(collectFilesFromFolder(root)).toEqual([file]);
		});

		it('collects files across three levels of nesting', () => {
			const deepFile = makeFile('root/a/b/c/deep.md');
			const midFile = makeFile('root/a/mid.md');
			const topFile = makeFile('root/top.md');

			const c = makeFolder('root/a/b/c', [deepFile]);
			const b = makeFolder('root/a/b', [c]);
			const a = makeFolder('root/a', [b, midFile]);
			const root = makeFolder('root', [a, topFile]);

			expect(collectFilesFromFolder(root)).toEqual([deepFile, midFile, topFile]);
		});

		it('prune skips a whole subtree', () => {
			const insideExcluded = makeFile('root/excluded/secret.md');
			const excluded = makeFolder('root/excluded', [insideExcluded]);
			const keptFile = makeFile('root/kept.md');
			const root = makeFolder('root', [excluded, keptFile]);

			const result = collectFilesFromFolder(root, {
				prune: (item) => item.path === 'root/excluded',
			});

			expect(result).toEqual([keptFile]);
		});

		it('prune skips an individual file without affecting siblings', () => {
			const skip = makeFile('root/skip.md');
			const keep = makeFile('root/keep.md');
			const root = makeFolder('root', [skip, keep]);

			const result = collectFilesFromFolder(root, {
				prune: (item) => item.path === 'root/skip.md',
			});

			expect(result).toEqual([keep]);
		});

		it('filter only includes matching files', () => {
			const md = makeFile('root/note.md');
			const txt = makeFile('root/notes.txt');
			const root = makeFolder('root', [md, txt]);

			const result = collectFilesFromFolder(root, {
				filter: (f) => f.extension === 'md',
			});

			expect(result).toEqual([md]);
		});

		it('filter and prune compose: prune wins on folders, filter narrows surviving files', () => {
			const excludedMd = makeFile('root/excluded/note.md');
			const keptMd = makeFile('root/kept/note.md');
			const keptTxt = makeFile('root/kept/notes.txt');
			const excluded = makeFolder('root/excluded', [excludedMd]);
			const kept = makeFolder('root/kept', [keptMd, keptTxt]);
			const root = makeFolder('root', [excluded, kept]);

			const result = collectFilesFromFolder(root, {
				prune: (item) => item.path.startsWith('root/excluded'),
				filter: (f) => f.extension === 'md',
			});

			expect(result).toEqual([keptMd]);
		});

		it('does not test the root folder against prune', () => {
			const file = makeFile('root/note.md');
			const root = makeFolder('root', [file]);
			const prune = vi.fn().mockReturnValue(true);

			collectFilesFromFolder(root, { prune });

			// prune is called once (for the child file), never for the root itself.
			expect(prune).toHaveBeenCalledTimes(1);
			expect(prune).toHaveBeenCalledWith(file);
		});
	});

	describe('collectFoldersFromFolder', () => {
		it('returns an empty array when there are no subfolders', () => {
			const file = makeFile('root/note.md');
			const root = makeFolder('root', [file]);

			expect(collectFoldersFromFolder(root)).toEqual([]);
		});

		it('collects nested folders in depth-first order, excluding the root', () => {
			const c = makeFolder('root/a/b/c');
			const b = makeFolder('root/a/b', [c]);
			const a = makeFolder('root/a', [b]);
			const sibling = makeFolder('root/sibling');
			const root = makeFolder('root', [a, sibling]);

			expect(collectFoldersFromFolder(root)).toEqual([a, b, c, sibling]);
		});

		it('prune skips a folder and its subtree', () => {
			const inside = makeFolder('root/excluded/inner');
			const excluded = makeFolder('root/excluded', [inside]);
			const kept = makeFolder('root/kept');
			const root = makeFolder('root', [excluded, kept]);

			const result = collectFoldersFromFolder(root, {
				prune: (folder) => folder.path === 'root/excluded',
			});

			expect(result).toEqual([kept]);
		});

		it('ignores non-folder children', () => {
			const file = makeFile('root/note.md');
			const folder = makeFolder('root/sub');
			const root = makeFolder('root', [file, folder]);

			expect(collectFoldersFromFolder(root)).toEqual([folder]);
		});
	});
});
