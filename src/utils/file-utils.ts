/**
 * Utility functions for file and folder filtering operations.
 *
 * These utilities provide consistent folder exclusion logic across both:
 * - UI file pickers/modals (FilePickerModal, FileMentionModal)
 * - Agent vault tools (read_file, write_file, list_files, etc.)
 */

import { TAbstractFile, TFolder, Vault, normalizePath, Notice } from 'obsidian';
import type ObsidianGemini from '../main';
import type { Logger } from './logger';

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
 * Uses vault.adapter.exists() as the primary existence check since it reads
 * the filesystem directly. This is critical during early plugin init and with
 * Obsidian Sync, where the metadata cache (vault.getAbstractFileByPath) may
 * not be populated yet.
 *
 * @param vault - The Obsidian Vault instance
 * @param folderPath - The folder path to ensure exists (will be normalized)
 * @param context - A short description of what this folder is for, used in error messages
 *                  (e.g., "plugin state", "skills", "agent sessions")
 * @param logger - Optional Logger instance for structured error reporting
 * @returns The TFolder instance for the folder (or a minimal stub if metadata cache is not ready)
 * @throws Error if the folder cannot be created and does not exist
 */
export async function ensureFolderExists(
	vault: Vault,
	folderPath: string,
	context?: string,
	logger?: Logger
): Promise<TFolder> {
	const normalized = normalizePath(folderPath);

	// Check metadata cache first (fast path when cache is ready)
	const existing = vault.getAbstractFileByPath(normalized);
	if (existing instanceof TFolder) {
		return existing;
	}

	// Check filesystem directly — handles early init before metadata cache is populated
	if (await vault.adapter.exists(normalized)) {
		// Folder exists on disk. Return from cache if available, otherwise
		// return a minimal TFolder-compatible object. Callers only use the
		// path/name fields; full TFolder features become available once
		// Obsidian's metadata cache catches up.
		return (vault.getAbstractFileByPath(normalized) as TFolder) ?? ({ path: normalized } as TFolder);
	}

	// Folder doesn't exist — create it
	try {
		await vault.createFolder(normalized);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);

		// Race condition: another process created it between our check and createFolder
		if (await vault.adapter.exists(normalized)) {
			return (vault.getAbstractFileByPath(normalized) as TFolder) ?? ({ path: normalized } as TFolder);
		}

		const label = context ? ` (${context})` : '';
		logger?.error(`Failed to create folder "${normalized}"${label}: ${message}`, error);
		new Notice(`Gemini Scribe: Failed to create folder "${normalized}"${label}: ${message}`);
		throw new Error(`Failed to create folder "${normalized}"${label}: ${message}`);
	}

	return (vault.getAbstractFileByPath(normalized) as TFolder) ?? ({ path: normalized } as TFolder);
}
