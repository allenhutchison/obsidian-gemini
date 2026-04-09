import { TFile, TFolder, normalizePath } from 'obsidian';
import type ObsidianGemini from '../../main';
import { shouldExcludePathForPlugin as shouldExcludePath } from '../../utils/file-utils';

/**
 * Helper function to resolve a path to a file with multiple fallback strategies
 * Handles paths, extensions, wikilinks, and case-insensitive searches
 *
 * @param path - The path to resolve (can be full path, filename, or wikilink)
 * @param plugin - The plugin instance
 * @param includeSuggestions - Whether to include suggestions if file not found
 * @returns Object with resolved file and optional suggestions
 */
export function resolvePathToFile(
	path: string,
	plugin: InstanceType<typeof ObsidianGemini>,
	includeSuggestions: boolean = false
): { file: TFile | null; suggestions?: string[] } {
	const normalizedPath = normalizePath(path);

	// Strategy 1: Try direct path lookup
	let file = plugin.app.vault.getAbstractFileByPath(normalizedPath);
	if (file && shouldExcludePath(file.path, plugin)) {
		file = null;
	}

	// Strategy 2: If not found and doesn't end with .md, try adding it
	if (!file && !normalizedPath.endsWith('.md')) {
		const candidate = plugin.app.vault.getAbstractFileByPath(normalizedPath + '.md');
		if (candidate && !shouldExcludePath(candidate.path, plugin)) {
			file = candidate;
		}
	}

	// Strategy 3: If still not found and ends with .md, try without it
	if (!file && normalizedPath.endsWith('.md')) {
		const pathWithoutExt = normalizedPath.slice(0, -3);
		const candidate = plugin.app.vault.getAbstractFileByPath(pathWithoutExt);
		if (candidate && !shouldExcludePath(candidate.path, plugin)) {
			file = candidate;
		}
	}

	// Strategy 4: If still not found, try resolving as a wikilink
	// This handles cases like "Foo Foo" which might be in "Dogs/Foo Foo.md"
	if (!file) {
		// Strip [[ and ]] if present
		let linkPath = path.replace(/^\[\[/, '').replace(/\]\]$/, '');
		// Remove .md extension if present for link resolution
		linkPath = linkPath.replace(/\.md$/, '');

		// Use Obsidian's link resolution API
		// Pass empty string as source path since we don't have context
		const resolvedFile = plugin.app.metadataCache.getFirstLinkpathDest(linkPath, '');
		if (resolvedFile && !shouldExcludePath(resolvedFile.path, plugin)) {
			file = resolvedFile;
		}
	}

	// Strategy 5: If still not found, try case-insensitive search (only for TFiles)
	if (!file) {
		const allFiles = plugin.app.vault.getFiles();
		if (allFiles && allFiles.length > 0) {
			const lowerPath = normalizedPath.toLowerCase();
			file =
				allFiles.find(
					(f) =>
						!shouldExcludePath(f.path, plugin) &&
						(f.path.toLowerCase() === lowerPath ||
							f.path.toLowerCase() === lowerPath + '.md' ||
							(lowerPath.endsWith('.md') && f.path.toLowerCase() === lowerPath.slice(0, -3)))
				) || null;
		}
	}

	// Only return TFile instances (filter out TFolder)
	// This is for file operations that specifically need files, not folders
	const tfile = file instanceof TFile ? file : null;

	// Generate suggestions if requested and file not found
	let suggestions: string[] | undefined;
	if (!tfile && includeSuggestions) {
		const allFiles = plugin.app.vault.getFiles();
		suggestions =
			allFiles && allFiles.length > 0
				? allFiles
						.filter(
							(f) =>
								!shouldExcludePath(f.path, plugin) &&
								f.name.toLowerCase().includes(path.toLowerCase().replace('.md', ''))
						)
						.slice(0, 5)
						.map((f) => f.path)
				: [];
	}

	return { file: tfile, suggestions };
}

/**
 * Helper function to resolve a path to either a file or folder
 * Similar to resolvePathToFile but returns both TFile and TFolder instances
 *
 * @param path - The path to resolve
 * @param plugin - The plugin instance
 * @param includeSuggestions - Whether to include suggestions if item not found
 * @returns Object with resolved file/folder (or null if not found), its type, and optional suggestions
 */
export function resolvePathToFileOrFolder(
	path: string,
	plugin: InstanceType<typeof ObsidianGemini>,
	includeSuggestions: boolean = false
): { item: TFile | TFolder | null; type: 'file' | 'folder' | null; suggestions?: string[] } {
	const normalizedPath = normalizePath(path);

	// Strategy 1: Try direct path lookup
	let item = plugin.app.vault.getAbstractFileByPath(normalizedPath);
	if (item && shouldExcludePath(item.path, plugin)) {
		item = null;
	}

	// If it's a folder, return it directly
	if (item instanceof TFolder) {
		return { item, type: 'folder' };
	}

	// If it's a file, return it directly
	if (item instanceof TFile) {
		return { item, type: 'file' };
	}

	// Strategy 2: Try file resolution strategies (with suggestions if requested)
	const { file, suggestions } = resolvePathToFile(path, plugin, includeSuggestions);
	if (file) {
		return { item: file, type: 'file' };
	}

	return { item: null, type: null, suggestions };
}
