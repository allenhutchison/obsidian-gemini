/**
 * Utility functions for file and folder filtering operations.
 *
 * These utilities provide consistent folder exclusion logic across both:
 * - UI file pickers/modals (FilePickerModal, FileMentionModal)
 * - Agent vault tools (read_file, write_file, list_files, etc.)
 */

import { TAbstractFile, TFolder, Vault, normalizePath, Notice } from 'obsidian';
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

/**
 * Safely ensure a folder exists in the vault, creating it if needed.
 *
 * This utility prevents the common "Folder already exists" error that occurs
 * when calling vault.createFolder() on an existing path. It checks for
 * existence first and provides user-friendly error messages via Notice
 * when folder creation fails unexpectedly.
 *
 * @param vault - The Obsidian Vault instance
 * @param folderPath - The folder path to ensure exists (will be normalized)
 * @param context - A short description of what this folder is for, used in error messages
 *                  (e.g., "plugin state", "skills", "agent sessions")
 * @returns The TFolder instance for the folder
 * @throws Error if the folder cannot be created and does not exist
 */
export async function ensureFolderExists(vault: Vault, folderPath: string, context?: string): Promise<TFolder> {
	const normalized = normalizePath(folderPath);

	const existing = vault.getAbstractFileByPath(normalized);
	if (existing instanceof TFolder) {
		return existing;
	}

	try {
		await vault.createFolder(normalized);
	} catch (error) {
		// Re-check after the error — another process may have created it concurrently
		const rechecked = vault.getAbstractFileByPath(normalized);
		if (rechecked instanceof TFolder) {
			return rechecked;
		}

		const label = context ? ` (${context})` : '';
		const message = error instanceof Error ? error.message : String(error);
		new Notice(`Gemini Scribe: Failed to create folder "${normalized}"${label}: ${message}`);
		throw new Error(`Failed to create folder "${normalized}"${label}: ${message}`);
	}

	const created = vault.getAbstractFileByPath(normalized);
	if (created instanceof TFolder) {
		return created;
	}

	const label = context ? ` (${context})` : '';
	new Notice(`Gemini Scribe: Folder "${normalized}"${label} was created but could not be verified.`);
	throw new Error(`Folder "${normalized}"${label} was created but could not be verified.`);
}
