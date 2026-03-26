import { normalizePath } from 'obsidian';
import ObsidianGemini from '../main';
import { ensureFolderExists } from '../utils/file-utils';

/**
 * Centralizes creation of all plugin state folders.
 * Runs once from onLayoutReady() so the metadata cache is populated.
 * After this runs, all services can assume their folders exist.
 */
export class FolderInitializer {
	// Subfolder names relative to the plugin state root
	private static readonly SUBFOLDERS = ['Agent-Sessions', 'Prompts', 'skills'];

	constructor(private plugin: ObsidianGemini) {}

	async initializeAll(): Promise<void> {
		const vault = this.plugin.app.vault;
		const logger = this.plugin.logger;
		const root = this.plugin.settings.historyFolder;

		// Create the plugin state root first
		await ensureFolderExists(vault, root, 'plugin state', logger);

		// Create all subfolders
		for (const subfolder of FolderInitializer.SUBFOLDERS) {
			await ensureFolderExists(vault, normalizePath(`${root}/${subfolder}`), subfolder, logger);
		}
	}
}
