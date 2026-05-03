import { TFolder, normalizePath } from 'obsidian';
import type ObsidianGemini from '../main';
import { ensureFolderExists } from '../utils/file-utils';

/**
 * Centralizes creation of all plugin state folders.
 * Runs once from onLayoutReady() so the metadata cache is populated.
 * After this runs, all services can assume their folders exist.
 */
export class FolderInitializer {
	// Subfolder names relative to the plugin state root
	private static readonly SUBFOLDERS = [
		'Agent-Sessions',
		'Background-Tasks',
		'Prompts',
		'Skills',
		'Scheduled-Tasks',
		'Scheduled-Tasks/Runs',
	];

	constructor(private plugin: ObsidianGemini) {}

	async initializeAll(): Promise<void> {
		const vault = this.plugin.app.vault;
		const logger = this.plugin.logger;
		const root = this.plugin.settings.historyFolder;

		// Create the plugin state root first
		await ensureFolderExists(vault, root, 'plugin state', logger);

		// One-time migration: rename skills → Skills on case-sensitive filesystems
		await this.migrateSkillsFolder(root);

		// Create all subfolders
		for (const subfolder of FolderInitializer.SUBFOLDERS) {
			await ensureFolderExists(vault, normalizePath(`${root}/${subfolder}`), subfolder, logger);
		}
	}

	/**
	 * Migrate the old lowercase 'skills' directory to 'Skills'.
	 * On case-sensitive filesystems (Linux), both can exist independently.
	 */
	private async migrateSkillsFolder(root: string): Promise<void> {
		const vault = this.plugin.app.vault;
		const oldPath = normalizePath(`${root}/skills`);
		const newPath = normalizePath(`${root}/Skills`);

		const oldFolder = vault.getAbstractFileByPath(oldPath);
		const newFolder = vault.getAbstractFileByPath(newPath);

		// Only migrate if old exists and new doesn't
		if (oldFolder instanceof TFolder && !newFolder) {
			try {
				await this.plugin.app.fileManager.renameFile(oldFolder, newPath);
				this.plugin.logger.log(`Migrated skills folder: ${oldPath} → ${newPath}`);
			} catch (error) {
				this.plugin.logger.warn(`Failed to migrate skills folder: ${error}`);
			}
		}
	}
}
