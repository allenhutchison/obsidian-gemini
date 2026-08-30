import type { App } from 'obsidian';
import { isAlreadyExistsError, resolveUniquePath } from '../services/headless-run-output';
import { sanitizeFileName } from '../utils/file-utils';
import type { Logger } from '../utils/logger';

/**
 * Renaming a session's history file to match its title happens from two places
 * — the auto-label pass after the first exchange, and the manual double-click
 * title edit in the agent header. Both derive the same target path and both hit
 * the same failure mode when another session file already carries that name
 * (`fileManager.renameFile` throws "Destination file already exists!"), so the
 * collision handling lives here once instead of being written per caller.
 */

/**
 * How many times a rename re-resolves a unique path after a
 * destination-exists collision before giving up (leaving the file un-renamed).
 */
export const SESSION_RENAME_ATTEMPTS = 3;

/**
 * The history-file path a session titled `title` should live at, keeping the
 * file in whatever folder it currently occupies.
 */
export function sessionHistoryPathForTitle(currentPath: string, title: string): string {
	const folder = currentPath.substring(0, currentPath.lastIndexOf('/') + 1);
	return `${folder}${sanitizeFileName(title)}.md`;
}

/**
 * Rename a session's history file so its name matches `title`.
 *
 * Resolves a numeric-suffixed path when another session file already occupies
 * the target. `resolveUniquePath` + `renameFile` is non-atomic, so a concurrent
 * writer can still take the candidate between the check and the rename; retry
 * on that specific error (re-resolving each attempt) and give up gracefully
 * after {@link SESSION_RENAME_ATTEMPTS} collisions — callers still apply the
 * title, only the rename is skipped. Any other error propagates.
 *
 * @returns the path the history file now lives at — `currentPath` unchanged
 *          when the rename was skipped or exhausted its attempts.
 */
export async function renameSessionHistoryFile(
	app: App,
	currentPath: string,
	title: string,
	logger: Logger
): Promise<string> {
	const newPath = sessionHistoryPathForTitle(currentPath, title);
	if (newPath === currentPath) return currentPath;

	const oldFile = app.vault.getAbstractFileByPath(currentPath);
	if (!oldFile) return currentPath;

	for (let attempt = 0; attempt < SESSION_RENAME_ATTEMPTS; attempt++) {
		const targetPath = resolveUniquePath(app.vault, newPath);
		try {
			await app.fileManager.renameFile(oldFile, targetPath);
			return targetPath;
		} catch (renameError) {
			if (!isAlreadyExistsError(renameError)) throw renameError;
			if (attempt === SESSION_RENAME_ATTEMPTS - 1) {
				logger.warn('Session history rename skipped after repeated collisions:', targetPath);
			}
		}
	}

	return currentPath;
}
