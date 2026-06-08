/**
 * Recursive folder-traversal helpers over Obsidian's `TFolder.children` tree.
 *
 * These centralize the "iterate children; recurse into folders; collect what
 * matches" skeleton so callers don't reimplement it (and so the prune-vs-post-
 * filter behavior has a single home — see issue #913).
 *
 * `prune` is checked first on every child and skips the item entirely (a file
 * is not collected; a folder is not collected *and* not recursed into).
 * `filter` runs only on files that survived `prune` and decides inclusion in
 * the result.
 */

import { TAbstractFile, TFile, TFolder } from 'obsidian';

export interface CollectFilesOptions {
	/** Return true to include a file in the output. Defaults to including all files. */
	filter?: (file: TFile) => boolean;
	/** Return true to skip this file or subtree entirely. */
	prune?: (item: TAbstractFile) => boolean;
}

export interface CollectFoldersOptions {
	/** Return true to skip this folder (and its subtree). */
	prune?: (folder: TFolder) => boolean;
}

/**
 * Recursively collect all files beneath `root`.
 * The `root` folder itself is never tested against `prune` — only its descendants.
 */
export function collectFilesFromFolder(root: TFolder, opts: CollectFilesOptions = {}): TFile[] {
	const { filter, prune } = opts;
	const files: TFile[] = [];

	const walk = (folder: TFolder): void => {
		for (const child of folder.children) {
			if (prune?.(child)) continue;
			if (child instanceof TFile) {
				if (!filter || filter(child)) files.push(child);
			} else if (child instanceof TFolder) {
				walk(child);
			}
		}
	};

	walk(root);
	return files;
}

/**
 * Recursively collect all descendant folders beneath `root`.
 * The `root` folder itself is not included in the output.
 */
export function collectFoldersFromFolder(root: TFolder, opts: CollectFoldersOptions = {}): TFolder[] {
	const { prune } = opts;
	const folders: TFolder[] = [];

	const walk = (folder: TFolder): void => {
		for (const child of folder.children) {
			if (!(child instanceof TFolder)) continue;
			if (prune?.(child)) continue;
			folders.push(child);
			walk(child);
		}
	};

	walk(root);
	return folders;
}
