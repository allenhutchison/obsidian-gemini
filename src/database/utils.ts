import { TFolder } from 'obsidian';
import ObsidianGemini from '../../main';
import { createHash } from 'crypto';

export async function getVaultFolder(plugin: ObsidianGemini): Promise<TFolder> {
	const folderName = plugin.settings.historyFolder;
	let folder = plugin.app.vault.getAbstractFileByPath(folderName);

	if (folder instanceof TFolder) {
		return folder;
	}

	try {
		return await plugin.app.vault.createFolder(folderName);
	} catch (error) {
		console.error(`Failed to create folder ${folderName}:`, error);
		throw error;
	}
}

export function generateChecksum(data: string): string {
	return createHash('md5').update(data).digest('hex');
}
