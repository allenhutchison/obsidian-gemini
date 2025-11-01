/**
 * Utility functions for file and folder filtering operations.
 *
 * These utilities provide consistent folder exclusion logic across both:
 * - UI file pickers/modals (FilePickerModal, FileMentionModal)
 * - Agent vault tools (read_file, write_file, list_files, etc.)
 */

import { TAbstractFile } from 'obsidian';
import type ObsidianGemini from '../main';

/**
 * Check if a file or folder path should be excluded from selection or operations.
 * This excludes:
 * - Files/folders within the specified exclude folder (e.g., plugin state folder)
 * - Files/folders within the .obsidian system folder
 *
 * @param path - The path to check
 * @param excludeFolder - Optional folder path to exclude (e.g., 'gemini-scribe')
 * @returns true if the path should be excluded, false otherwise
 */
export function shouldExcludePath(path: string, excludeFolder?: string): boolean {
	// Check if path is within .obsidian folder
	if (path === '.obsidian' || path.startsWith('.obsidian/')) {
		return true;
	}

	// Check if path is within the exclude folder
	if (excludeFolder && (path === excludeFolder || path.startsWith(excludeFolder + '/'))) {
		return true;
	}

	return false;
}

/**
 * Check if a path should be excluded using the plugin's configured state folder.
 * Convenience wrapper around shouldExcludePath() for use in tool contexts.
 *
 * @param path - The path to check
 * @param plugin - The plugin instance
 * @returns true if the path should be excluded, false otherwise
 */
export function shouldExcludePathForPlugin(path: string, plugin: InstanceType<typeof ObsidianGemini>): boolean {
	return shouldExcludePath(path, plugin.settings.historyFolder);
}

/**
 * Filter function for file/folder lists that excludes system and plugin folders.
 * Can be used directly with Array.filter()
 *
 * @param excludeFolder - Optional folder path to exclude (e.g., 'gemini-scribe')
 * @returns Filter function that returns true for items that should be included
 */
export function createFileFilter(excludeFolder?: string): (item: TAbstractFile) => boolean {
	return (item: TAbstractFile) => !shouldExcludePath(item.path, excludeFolder);
}
