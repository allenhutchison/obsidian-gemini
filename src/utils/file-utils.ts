/**
 * Utility functions for file and folder filtering operations.
 *
 * These utilities provide consistent folder exclusion logic across both:
 * - UI file pickers/modals (FileMentionModal)
 * - Agent vault tools (read_file, write_file, list_files, etc.)
 */

import { TAbstractFile, TFolder, Vault, normalizePath, Notice } from 'obsidian';
import type { ObsidianGemini } from '../types/plugin';
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
 * The distinct ways a generated-output path can be rejected.
 *
 * Callers supply their own wording for each one, so the *policy* lives here
 * while the error text stays specific to what is being written (a research
 * report, a generated image, …).
 */
export type GeneratedOutputPathViolation = 'missing-filename' | 'vault-escape' | 'config-folder' | 'state-folder';

/**
 * Options for {@link validateGeneratedOutputPath}.
 */
export interface GeneratedOutputPathOptions {
	/** The vault's configuration directory (`vault.configDir`). Never writable. */
	configDir: string;
	/** The plugin state folder (`settings.historyFolder`); skipped when unset. */
	historyFolder?: string;
	/** The one subfolder of `historyFolder` that generated output may be written to. */
	allowedSubfolder: string;
	/**
	 * Optional filename rewrite, applied *after* the config-folder check and
	 * *before* the state-folder check. The ordering is load-bearing: a rewrite
	 * changes the path that actually gets written, so the state-folder check has
	 * to see the rewritten path (a bare `Background-Tasks` rewritten to
	 * `Background-Tasks.png` is outside the allowed subfolder and must be
	 * rejected). The rewritten path is what this function returns.
	 */
	rewriteFileName?: (normalizedPath: string) => string;
	/**
	 * Error message factories keyed by violation, each receiving the caller's
	 * raw (un-normalized) path. Required in full so that adding a violation
	 * fails to compile until every caller has wording for it — the reject set
	 * cannot silently drift between callers again (#1401).
	 */
	messages: Record<GeneratedOutputPathViolation, (rawPath: string) => string>;
}

/**
 * Validate and normalize a vault path that the plugin is about to write
 * generated output to (a deep-research report, a generated image, …).
 *
 * This is the single source of truth for the "may I write this generated
 * artifact here?" policy, which is deliberately *not* the same as the agent
 * vault tools' blanket exclusion (`shouldExcludePathForPlugin`): generated
 * output is allowed into one carve-out subfolder of the plugin state folder,
 * because that subfolder is its canonical home.
 *
 * The reject set, in order: empty/directory-only paths, vault-escaping paths,
 * the Obsidian configuration directory, and the plugin state folder except
 * `allowedSubfolder`. These paths come from agent-supplied tool parameters, so
 * every caller wants the same guards — previously each validator carried its
 * own fork and they had already drifted apart.
 *
 * @param rawPath - The caller-supplied, un-normalized path
 * @param options - Policy inputs and per-violation error wording
 * @returns The normalized path (after `rewriteFileName`, when supplied)
 * @throws Error built by the matching `options.messages` factory
 */
export function validateGeneratedOutputPath(rawPath: string, options: GeneratedOutputPathOptions): string {
	const { configDir, historyFolder, allowedSubfolder, rewriteFileName, messages } = options;
	const normalized = normalizePath(rawPath);

	// Reject directory-only paths (empty, or a bare/trailing slash).
	if (!normalized || normalized.endsWith('/')) {
		throw new Error(messages['missing-filename'](rawPath));
	}

	// Reject vault-escaping paths — normalizePath does not resolve `..`.
	if (normalized.startsWith('..') || normalized.split('/').includes('..')) {
		throw new Error(messages['vault-escape'](rawPath));
	}

	// The Obsidian configuration directory (default `.obsidian`, but the user
	// may have renamed it) must never be written to. Root-anchored.
	if (isPathInFolder(normalized, configDir)) {
		throw new Error(messages['config-folder'](rawPath));
	}

	const finalPath = rewriteFileName ? rewriteFileName(normalized) : normalized;

	// The plugin state folder is off limits except for the one subfolder that is
	// the canonical output location for background and scheduled-task output.
	if (historyFolder) {
		const normalizedHistoryFolder = normalizePath(historyFolder);
		const allowedFolder = normalizePath(`${normalizedHistoryFolder}/${allowedSubfolder}`);
		const insideStateFolder = isPathInFolder(finalPath, normalizedHistoryFolder);
		const insideAllowedSubfolder = finalPath.startsWith(allowedFolder + '/');
		if (insideStateFolder && !insideAllowedSubfolder) {
			throw new Error(messages['state-folder'](rawPath));
		}
	}

	return finalPath;
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
 * Resolve a folder that is known to exist on disk to its `TFolder`.
 *
 * Prefers the metadata-cache entry (narrowed with `instanceof TFolder`). During
 * early plugin init the cache may not be populated yet even though the folder
 * exists on disk, so we fall back to a minimal stub carrying just the path.
 * Callers only read `path`/`name` until the cache catches up; a fabricated
 * object has no runtime kind to narrow, so the single cast here is unavoidable.
 */
function resolveExistingFolder(vault: Vault, normalized: string): TFolder {
	const existing = vault.getAbstractFileByPath(normalized);
	if (existing instanceof TFolder) {
		return existing;
	}
	// eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast -- fabricated early-init stub; nothing to narrow
	return { path: normalized } as TFolder;
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
		// Folder exists on disk. Return from cache if available, otherwise a
		// minimal stub until Obsidian's metadata cache catches up.
		return resolveExistingFolder(vault, normalized);
	}

	// Folder doesn't exist — create it
	try {
		await vault.createFolder(normalized);
	} catch (error) {
		const message = getRawErrorMessage(error);

		// Race condition: another process created it between our check and createFolder
		if (await vault.adapter.exists(normalized)) {
			return resolveExistingFolder(vault, normalized);
		}

		const label = context ? ` (${context})` : '';
		logger?.error(`Failed to create folder "${normalized}"${label}: ${message}`, error);
		new Notice(t('notice.fileUtils.createFolderFailed', { path: normalized, label, message }));
		throw new Error(`Failed to create folder "${normalized}"${label}: ${message}`);
	}

	return resolveExistingFolder(vault, normalized);
}

/**
 * Derive the parent folder of a file path, or `null` at the vault root.
 *
 * The null-at-root contract is the edge case every former inline copy of this
 * operation re-decided (five sites, four spellings — see #1425); it lives here
 * now. No trailing slash is produced, and a folder name containing a dot
 * (`my.notes/README.md`) is not mistaken for an extension boundary.
 */
export function getParentPath(path: string): string | null {
	const lastSlash = path.lastIndexOf('/');
	return lastSlash > 0 ? path.substring(0, lastSlash) : null;
}

/**
 * Derive the final path segment — the file name with no folder prefix.
 * Returns the input unchanged when it contains no slash (already a root file).
 */
export function getFileName(path: string): string {
	const lastSlash = path.lastIndexOf('/');
	return lastSlash >= 0 ? path.substring(lastSlash + 1) : path;
}

/**
 * Ensure the parent folder of `filePath` exists, creating it (and any
 * intermediate folders) if needed. The shared operation every write path
 * performs before its first write to a vault path; a no-op for root-level
 * paths (`out.md`) where there is no parent to create.
 */
export async function ensureParentFolderExists(
	vault: Vault,
	filePath: string,
	context?: string,
	logger?: Logger
): Promise<void> {
	const parentPath = getParentPath(filePath);
	if (!parentPath) return;
	await ensureFolderExists(vault, parentPath, context, logger);
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
