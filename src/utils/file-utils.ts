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
import { getRawErrorMessage } from './error-utils';
import { t } from '../i18n';

/**
 * Check whether a path is the given folder or lives inside it.
 *
 * Root-anchored containment: matches `folder` itself and `folder/...` but never
 * a sibling such as `folder-backup`. This is the single source of truth for the
 * "is this path inside that directory?" check used for both the plugin state
 * folder and the Obsidian configuration directory, so the semantics (and the
 * over-match fix) live in one place.
 *
 * @param path - The path to check
 * @param folder - The folder to test containment against
 */
export function isPathInFolder(path: string, folder: string): boolean {
	return path === folder || path.startsWith(folder + '/');
}

/**
 * Check if a file or folder path should be excluded from selection or operations.
 * This excludes:
 * - Files/folders within the specified exclude folder (e.g., plugin state folder)
 * - Files/folders within the Obsidian configuration directory (`vault.configDir`)
 *
 * @param path - The path to check
 * @param excludeFolder - Optional folder path to exclude (e.g., 'gemini-scribe')
 * @param configDir - The vault's configuration directory (from `vault.configDir`).
 *                    Required so renamed config directories are excluded correctly
 *                    and a user folder literally named `.obsidian` is not over-matched.
 * @returns true if the path should be excluded, false otherwise
 */
export function shouldExcludePath(path: string, excludeFolder: string | undefined, configDir: string): boolean {
	// Check if path is within the Obsidian configuration directory.
	if (isPathInFolder(path, configDir)) {
		return true;
	}

	// Check if path is within the exclude folder
	if (excludeFolder && isPathInFolder(path, excludeFolder)) {
		return true;
	}

	return false;
}

/**
 * Check if a path should be excluded using the plugin's configured state folder
 * and the vault's configuration directory.
 * Convenience wrapper around shouldExcludePath() for use in tool contexts.
 *
 * @param path - The path to check
 * @param plugin - The plugin instance
 * @returns true if the path should be excluded, false otherwise
 */
export function shouldExcludePathForPlugin(path: string, plugin: ObsidianGemini): boolean {
	return shouldExcludePath(path, plugin.settings.historyFolder, plugin.app.vault.configDir);
}

/**
 * Filter function for file/folder lists that excludes system and plugin folders.
 * Can be used directly with Array.filter()
 *
 * @param excludeFolder - Optional folder path to exclude (e.g., 'gemini-scribe')
 * @param configDir - The vault's configuration directory (from `vault.configDir`)
 * @returns Filter function that returns true for items that should be included
 */
export function createFileFilter(
	excludeFolder: string | undefined,
	configDir: string
): (item: TAbstractFile) => boolean {
	return (item: TAbstractFile) => !shouldExcludePath(item.path, excludeFolder, configDir);
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
		const message = getRawErrorMessage(error);

		// Race condition: another process created it between our check and createFolder
		if (await vault.adapter.exists(normalized)) {
			return (vault.getAbstractFileByPath(normalized) as TFolder) ?? ({ path: normalized } as TFolder);
		}

		const label = context ? ` (${context})` : '';
		logger?.error(`Failed to create folder "${normalized}"${label}: ${message}`, error);
		new Notice(t('notice.fileUtils.createFolderFailed', { path: normalized, label, message }));
		throw new Error(`Failed to create folder "${normalized}"${label}: ${message}`);
	}

	return (vault.getAbstractFileByPath(normalized) as TFolder) ?? ({ path: normalized } as TFolder);
}

/**
 * Sanitize a string for use as a file name by removing or replacing
 * characters forbidden on most operating systems.
 */
export function sanitizeFileName(fileName: string): string {
	return fileName
		.replace(/[\\/:*?"<>|]/g, '-') // Replace forbidden chars with dash
		.replace(/\s+/g, ' ') // Normalize whitespace
		.trim() // Remove leading/trailing whitespace
		.slice(0, 100); // Limit length to prevent issues
}
