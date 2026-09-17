import { TFolder } from 'obsidian';
import type { ObsidianGemini } from '../types/plugin';
import { ensureFolderExists } from '../utils/file-utils';
import { getRawErrorMessage } from '../utils/error-utils';
import { EAGER_SUBFOLDERS, LEGACY_SKILLS_SUBFOLDER, STATE_SUBFOLDERS, stateFolderPath } from './state-folder';

/**
 * Centralizes creation of all plugin state folders.
 * Runs once from onLayoutReady() so the metadata cache is populated.
 * After this runs, all services can assume their folders exist.
 */
export class FolderInitializer {
	constructor(private plugin: ObsidianGemini) {}

	/**
	 * Create the plugin state root and every eagerly-created subfolder.
	 *
	 * The subfolder list is `EAGER_SUBFOLDERS` from `state-folder.ts`, not a local
	 * copy — `Hooks/` and `History/` are absent from it by design (see that module).
	 * Idempotent: `ensureFolderExists` no-ops when a folder already exists, so this
	 * is safe to re-run whenever `settings.historyFolder` changes.
	 */
	async initializeAll(): Promise<void> {
		const vault = this.plugin.app.vault;
		const logger = this.plugin.logger;
		const root = this.plugin.settings.historyFolder;

		// Create the plugin state root first
		await ensureFolderExists(vault, root, 'plugin state', logger);

		// One-time migration: rename skills → Skills on case-sensitive filesystems
		await this.migrateSkillsFolder();

		// Create all eagerly-created subfolders (the layout's own list — see state-folder.ts)
		for (const subfolder of EAGER_SUBFOLDERS) {
			await ensureFolderExists(vault, stateFolderPath(this.plugin.settings, subfolder), subfolder, logger);
		}
	}

	/**
	 * Migrate the old lowercase 'skills' directory to 'Skills'.
	 * On case-sensitive filesystems (Linux), both can exist independently.
	 */
	private async migrateSkillsFolder(): Promise<void> {
		const vault = this.plugin.app.vault;
		const oldPath = stateFolderPath(this.plugin.settings, LEGACY_SKILLS_SUBFOLDER);
		const newPath = stateFolderPath(this.plugin.settings, STATE_SUBFOLDERS.skills);

		const oldFolder = vault.getAbstractFileByPath(oldPath);
		const newFolder = vault.getAbstractFileByPath(newPath);

		// Only migrate if old exists and new doesn't
		if (oldFolder instanceof TFolder && !newFolder) {
			try {
				await this.plugin.app.fileManager.renameFile(oldFolder, newPath);
				this.plugin.logger.log(`Migrated skills folder: ${oldPath} → ${newPath}`);
			} catch (error) {
				this.plugin.logger.warn(`Failed to migrate skills folder: ${getRawErrorMessage(error)}`);
			}
		}
	}
}
