import { TFile, Notice, normalizePath } from 'obsidian';
import ObsidianGemini from '../../main';
import { BasicGeminiConversationEntry, GeminiConversationEntry } from '../types/conversation';
import * as Handlebars from 'handlebars';
import * as path from 'path'; // Added for path manipulation
// @ts-ignore
import historyEntryTemplate from './templates/historyEntry.hbs';

export class MarkdownHistory {
	private plugin: ObsidianGemini;
	private entryTemplate: Handlebars.TemplateDelegate;

	constructor(plugin: ObsidianGemini) {
		this.plugin = plugin;
		// Register the eq helper
		Handlebars.registerHelper('eq', function (a, b) {
			return a === b;
		});
		this.entryTemplate = Handlebars.compile(historyEntryTemplate);
	}

	// Updated: Flattens directory structure into filename
	// If the note is in the root of the vault (no directory), prefix with 'root_' to avoid filename collision
	private getHistoryFilePath(notePath: string): string {
		const historyFolder = this.plugin.settings.historyFolder;
		// Remove .md extension
		const pathWithoutExt = notePath.replace(/\.md$/, '');
		// Determine if the note is in the root (no path separator)
		const isRoot = !pathWithoutExt.includes('/') && !pathWithoutExt.includes('\\');
		// Replace path separators with underscores to flatten the structure
		let safeFilename = pathWithoutExt.replace(/[\\/]/g, '_');
		if (isRoot) {
			safeFilename = `root_${safeFilename}`;
		}
		// Combine history folder with the flattened, safe filename and add .md
		// Use normalizePath to ensure consistent separators for the base history folder path
		return normalizePath(`${historyFolder}/${safeFilename}.md`);
	}

	// Updated: Ensure parent directory exists (only base history folder needed now)
	async appendHistoryForFile(file: TFile, newEntry: BasicGeminiConversationEntry) {
		if (!this.plugin.gfile.isFile(file)) return;
		if (!this.plugin.settings.chatHistory) return;

		const historyPath = this.getHistoryFilePath(file.path);
		// const historyDir = path.dirname(historyPath); // No longer needed as structure is flat

		const entry: GeminiConversationEntry = {
			notePath: file.path,
			created_at: new Date(),
			role: newEntry.role,
			message: newEntry.message,
			model: newEntry.model,
		};

		try {
			// Ensure the base history folder exists first
			await this.plugin.app.vault.createFolder(this.plugin.settings.historyFolder).catch(() => {});
			// Ensure the specific subdirectory for the history file exists - NO LONGER NEEDED
			// await this.plugin.app.vault.createFolder(historyDir).catch(() => {});

			const exists = await this.plugin.app.vault.adapter.exists(historyPath);
			if (exists) {
				let currentContent = await this.plugin.app.vault.adapter.read(historyPath);
				currentContent = currentContent.replace(/\n---\s*$/, '');
				await this.plugin.app.vault.adapter.write(
					historyPath,
					currentContent + '\n\n' + this.formatEntryAsMarkdown(entry)
				);
			} else {
				// For new files, create with frontmatter and handle initial user query if present
				let entryMarkdown = '';
				if (newEntry.role === 'model' && newEntry.userMessage) {
					const userEntry: GeminiConversationEntry = {
						notePath: file.path,
						created_at: new Date(entry.created_at.getTime() - 1000),
						role: 'user',
						message: newEntry.userMessage,
					};
					entryMarkdown = this.formatEntryAsMarkdown(userEntry, true) + '\n\n' + this.formatEntryAsMarkdown(entry);
				} else {
					entryMarkdown = this.formatEntryAsMarkdown(entry, true);
				}

				// Create the file (vault.create handles missing parent dirs, but we created them above just in case)
				const newFile = await this.plugin.app.vault.create(historyPath, entryMarkdown);

				// Then add the frontmatter with proper wikilink
				await this.plugin.app.fileManager.processFrontMatter(newFile, (frontmatter) => {
					frontmatter['source_file'] = this.plugin.gfile.getLinkText(file, file.path);
				});
			}
		} catch (error) {
			console.error('Failed to append history', error);
			new Notice('Failed to save chat history');
		}
	}

	async getHistoryForFile(file: TFile): Promise<GeminiConversationEntry[]> {
		if (!this.plugin.gfile.isFile(file)) return [];
		if (!this.plugin.settings.chatHistory) return [];

		const newHistoryPath = this.getHistoryFilePath(file.path);
		let historyPath = newHistoryPath; // Assume new format first
		let content: string | null = null;
		let legacyFile: TFile | null = null;

		try {
			// 1. Check for new format
			const newFile = this.plugin.app.vault.getAbstractFileByPath(newHistoryPath);
			if (newFile instanceof TFile) {
				content = await this.plugin.app.vault.read(newFile);
			} else {
				// 2. Check for legacy format if new one doesn't exist
				legacyFile = await this.findLegacyHistoryFile(file);
				if (legacyFile) {
					console.log(`Found legacy history file for ${file.path}: ${legacyFile.path}`); // Keep this informative log
					historyPath = legacyFile.path;
					content = await this.plugin.app.vault.read(legacyFile);

					// 3. Perform synchronous migration
					try {
						// console.log(`[History] Starting migration for ${legacyFile.path}`); // DEBUG
						await this.migrateLegacyHistoryFile(legacyFile, file);
						// console.log(`[History] Finished migration for ${legacyFile.path}`); // DEBUG
					} catch (migrationError) {
						console.error(
							`[History] Failed to migrate legacy history file ${legacyFile?.path} during load:`,
							migrationError
						);
						// Decide if we should still return the content even if migration failed
						// For now, we will, as the content was read successfully before migration attempt.
						new Notice(`Error updating history file format for ${file.basename}. History may load from old format.`);
					}
				}
			}

			// If content was found (either new or legacy), parse it
			if (content !== null) {
				return this.parseHistoryFile(content, file.path); // Pass original note path
			} else {
				return []; // No history found in either format
			}
		} catch (error) {
			console.error(`Failed to read history for ${file.path} (checked path: ${historyPath}):`, error);
			return [];
		}
	}

	async clearHistoryForFile(file: TFile): Promise<number | undefined> {
		if (!this.plugin.gfile.isFile(file)) return undefined;

		const historyPath = this.getHistoryFilePath(file.path);
		try {
			const historyFile = this.plugin.app.vault.getAbstractFileByPath(historyPath);
			if (historyFile instanceof TFile) {
				await this.plugin.app.vault.delete(historyFile); // Use vault.delete for TFile
				return 1;
			}
			// If new format doesn't exist, check for and delete legacy format too
			const legacyFile = await this.findLegacyHistoryFile(file);
			if (legacyFile) {
				await this.plugin.app.vault.delete(legacyFile);
				console.log(`Cleared legacy history file: ${legacyFile.path}`);
				return 1; // Counted as cleared
			}

			return 0;
		} catch (error) {
			// Handle case where file might exist according to adapter but not vault cache yet
			if (error.message.includes('does not exist')) {
				// Check legacy again in case of race condition or error finding new format
				try {
					const legacyFile = await this.findLegacyHistoryFile(file);
					if (legacyFile) {
						await this.plugin.app.vault.delete(legacyFile);
						console.log(`Cleared legacy history file after initial miss: ${legacyFile.path}`);
						return 1;
					}
				} catch (legacyError) {
					console.error('Error checking/deleting legacy history during clear error handling:', legacyError);
				}
				return 0; // Neither format found
			}
			console.error('Failed to clear history for file:', historyPath, error);
			new Notice(`Failed to clear history for ${file.basename}`);
			return undefined;
		}
	}

	// Helper to find legacy history file based on frontmatter link
	private async findLegacyHistoryFile(sourceFile: TFile): Promise<TFile | null> {
		const historyFolder = this.plugin.settings.historyFolder;
		try {
			const listResult = await this.plugin.app.vault.adapter.list(historyFolder);
			// Filter for markdown files, exclude potential new format name to avoid self-matching
			const potentialLegacyFiles = listResult.files.filter(
				(p) => p.endsWith('.md') && normalizePath(p) !== this.getHistoryFilePath(sourceFile.path)
			);

			for (const filePath of potentialLegacyFiles) {
				const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
				if (file instanceof TFile) {
					const cache = this.plugin.app.metadataCache.getFileCache(file);
					const frontmatter = cache?.frontmatter;
					if (frontmatter && frontmatter.source_file) {
						const sourceLink = frontmatter.source_file;

						// --- Alternative Matching Logic ---
						// Extract link text, handling potential aliases and removing extension
						const linkTextMatch = sourceLink.match(/\[\[([^|#\]]+)/);
						const linkText = linkTextMatch ? linkTextMatch[1].trim().replace(/\.md$/, '') : null;
						const sourceFileBaseName = sourceFile.basename.replace(/\.md$/, '');

						if (linkText && linkText === sourceFileBaseName) {
							return file; // Found the legacy file by basename comparison
						}
						// --- End Alternative Matching Logic ---

						/* --- Original Link Resolution Logic (commented out) ---
						const linkedFile = this.plugin.app.metadataCache.getFirstLinkpathDest(
							sourceLink,
							'' // Try resolving without context path
						);
						// Check if the linked file path matches the source file we're looking for
						if (linkedFile instanceof TFile) {
							console.log(`[History Legacy] Resolved link ${sourceLink} to: ${linkedFile.path}`); // DEBUG
							if (linkedFile.path === sourceFile.path) {
								console.log(`[History Legacy] Match found! Returning ${file.path}`); // DEBUG
								return file; // Found the legacy file
							}
						} else {
							console.log(`[History Legacy] Could not resolve link ${sourceLink} from ${filePath}`); // DEBUG
						}
						--- */
					}
				}
			}
		} catch (error) {
			// Ignore errors like history folder not existing
			if (!error.message.includes('no such file or directory')) {
				console.error(`Error searching for legacy history files in ${historyFolder}:`, error);
			}
		}
		return null; // Not found
	}

	// Helper to rename a legacy file to the new format
	private async migrateLegacyHistoryFile(legacyFile: TFile, sourceFile: TFile): Promise<void> {
		const newHistoryPath = this.getHistoryFilePath(sourceFile.path);
		console.log(`Attempting migration for legacy file ${legacyFile.path} to ${newHistoryPath}`);

		try {
			// 1. Check if the target path ALREADY exists BEFORE renaming
			const targetExists = await this.plugin.app.vault.adapter.exists(newHistoryPath);

			if (targetExists) {
				console.warn(
					`Migration target ${newHistoryPath} already exists. Deleting original legacy file ${legacyFile.path}.`
				);
				await this.plugin.app.vault.delete(legacyFile).catch((delErr) => {
					console.error(`Failed to delete original legacy file ${legacyFile.path} when target existed:`, delErr);
				});
				return; // Exit migration, target already exists
			}

			// 2. Rename the legacy file to the new path
			await this.plugin.app.vault.rename(legacyFile, newHistoryPath);
			console.log(`Successfully renamed ${legacyFile.path} to ${newHistoryPath}`);

			// 3. Get the TFile object for the *new* path (it MUST exist now)
			const newHistoryFile = this.plugin.app.vault.getAbstractFileByPath(newHistoryPath);
			if (!(newHistoryFile instanceof TFile)) {
				// This case is unlikely if rename succeeded, but handle defensively
				console.error(
					`Failed to get TFile for newly renamed history file: ${newHistoryPath}. Cannot update frontmatter.`
				);
				return;
			}

			// 4. Update frontmatter link on the *new* file
			await this.plugin.app.fileManager.processFrontMatter(newHistoryFile, (frontmatter) => {
				frontmatter['source_file'] = this.plugin.gfile.getLinkText(sourceFile, sourceFile.path);
			});
			console.log(`Successfully updated frontmatter for ${newHistoryPath}`);
		} catch (error) {
			// Handle potential errors during rename or frontmatter update
			if (error.message.includes('already exists')) {
				// Should have been caught by the initial check, but handle defensively
				console.warn(
					`Rename failed, target ${newHistoryPath} already exists (race condition?). Attempting to delete original legacy file ${legacyFile.path}.`
				);
				await this.plugin.app.vault.delete(legacyFile).catch((delErr) => {
					console.error(`Failed to delete original legacy file ${legacyFile.path} after rename error:`, delErr);
				});
			} else if (error.message.includes('does not exist')) {
				// This might happen if the legacy file was deleted between find and migrate
				console.warn(`Cannot migrate legacy history file, source no longer exists: ${legacyFile.path}`);
			} else {
				console.error(`Error during migration of ${legacyFile.path} to ${newHistoryPath}:`, error);
				throw error; // Re-throw to be caught by getHistoryForFile
			}
		}
	}

	// Updated: Recursively remove and recreate history folder
	async clearHistory(): Promise<void> {
		if (!this.plugin.settings.chatHistory) return;

		const historyFolder = this.plugin.settings.historyFolder;
		try {
			const folderExists = await this.plugin.app.vault.adapter.exists(historyFolder);
			if (folderExists) {
				// Recursively remove the directory and its contents
				await this.plugin.app.vault.adapter.rmdir(historyFolder, true);
			}
			// Recreate the base history folder
			await this.plugin.app.vault.createFolder(historyFolder);
			new Notice('Chat history cleared.');
		} catch (error) {
			console.error('Failed to clear all history', error);
			new Notice('Failed to clear chat history');
		}
	}

	private formatEntryAsMarkdown(entry: GeminiConversationEntry, isFirstEntry: boolean = false): string {
		const timestamp = entry.created_at.toISOString();
		const role = entry.role.charAt(0).toUpperCase() + entry.role.slice(1);

		// Split message into lines for the template
		const messageLines = entry.message.split('\n');

		// Get file version from the specific note's metadata cache
		const sourceFile = this.plugin.app.vault.getAbstractFileByPath(entry.notePath);
		let fileVersion = 'unknown';
		if (sourceFile instanceof TFile) {
			fileVersion = sourceFile.stat.mtime.toString(16).slice(0, 8);
		} else {
			console.warn(`Could not find TFile for path ${entry.notePath} when formatting history entry.`);
		}

		return this.entryTemplate({
			isFirstEntry,
			role,
			timestamp,
			model: entry.model,
			messageLines,
			pluginVersion: this.plugin.manifest.version,
			fileVersion,
			temperature: entry.metadata?.temperature,
			context: entry.metadata?.context,
		});
	}

	// Updated: Pass original note path for consistency
	private async parseHistoryFile(content: string, originalNotePath: string): Promise<GeminiConversationEntry[]> {
		const entries: GeminiConversationEntry[] = [];

		// Get the file object to read frontmatter using the original note path
		const historyPath = this.getHistoryFilePath(originalNotePath);
		const historyFile = this.plugin.app.vault.getAbstractFileByPath(historyPath);
		let sourceFilePath = originalNotePath; // Default to original path

		if (historyFile instanceof TFile) {
			const frontmatter = this.plugin.app.metadataCache.getFileCache(historyFile)?.frontmatter;
			if (frontmatter && frontmatter.source_file) {
				const linkedFile = this.plugin.app.metadataCache.getFirstLinkpathDest(
					frontmatter.source_file,
					historyFile.path // Context for resolving link is the history file itself
				);
				if (linkedFile instanceof TFile) {
					// Use the current path from the linked file if found
					sourceFilePath = linkedFile.path;
				}
			}
		} else {
			console.warn(`Could not find history file TFile object for path: ${historyPath}`);
		}

		// Remove frontmatter if present
		const contentWithoutFrontmatter = content.replace(/^---\n[\s\S]*?\n---\n/, '').trim();

		// Split into sections by double newline followed by ##
		const sections = contentWithoutFrontmatter.split(/\n\n(?=## )/);

		for (const section of sections) {
			if (!section.trim()) continue;

			const headerMatch = section.match(/^## (User|Model)/m);
			if (headerMatch) {
				const role = headerMatch[1].toLowerCase();

				// Extract metadata from the table in the metadata callout
				const timeMatch = section.match(/\|\s*Time\s*\|\s*(.*?)\s*\|/m);
				const modelMatch = section.match(/\|\s*Model\s*\|\s*(.*?)\s*\|/m);
				const timestamp = timeMatch ? new Date(timeMatch[1].trim()) : new Date();

				// Extract message content - look for user/assistant callout and get its content
				const messageMatch = section.match(/>\s*\[!(user|assistant)\]\+\n([\s\S]*?)(?=\n\s*---|\n\s*$)/m);
				if (messageMatch) {
					const messageLines = messageMatch[2]
						.split('\n')
						.map((line) => (line.startsWith('> ') ? line.slice(2) : line))
						.join('\n')
						.trim();

					if (messageLines) {
						entries.push({
							// Use the resolved source file path
							notePath: sourceFilePath,
							created_at: timestamp,
							role: role as 'user' | 'model',
							message: messageLines,
							model: modelMatch ? modelMatch[1].trim() : undefined,
						});
					}
				}
			}
		}

		return entries;
	}

	// Updated: Use direct paths, ensure target dir exists, use vault.rename
	async renameHistoryFile(file: TFile, oldPath: string) {
		const oldHistoryPath = this.getHistoryFilePath(oldPath);
		const newHistoryPath = this.getHistoryFilePath(file.path);
		// const newHistoryDir = path.dirname(newHistoryPath); // No longer needed

		try {
			const historyTFile = this.plugin.app.vault.getAbstractFileByPath(oldHistoryPath);

			if (historyTFile instanceof TFile) {
				// Ensure the new parent directory exists - NO LONGER NEEDED
				// await this.plugin.app.vault.createFolder(newHistoryDir).catch(() => {});

				// First update the frontmatter with the new file path link
				await this.plugin.app.fileManager.processFrontMatter(historyTFile, (frontmatter) => {
					frontmatter['source_file'] = this.plugin.gfile.getLinkText(file, file.path);
				});

				// Then rename the history file using vault.rename
				await this.plugin.app.vault.rename(historyTFile, newHistoryPath);
			} else {
				console.log('Could not find history file TFile to rename:', oldHistoryPath);
				// Optionally, check if the file exists via adapter if vault cache might be stale
				const exists = await this.plugin.app.vault.adapter.exists(oldHistoryPath);
				if (!exists) {
					console.log(`Adapter confirms ${oldHistoryPath} does not exist.`);
				}
			}
		} catch (error) {
			// Handle potential race conditions or errors during rename/frontmatter update
			if (error.message.includes('already exists')) {
				console.warn(`Cannot rename history file, target already exists: ${newHistoryPath}`);
				new Notice(`History file for ${file.basename} might be duplicated.`);
			} else if (error.message.includes('does not exist')) {
				console.warn(`Cannot rename history file, source does not exist: ${oldHistoryPath}`);
			} else {
				console.error('Failed to rename history file:', { from: oldHistoryPath, to: newHistoryPath }, error);
				new Notice(`Failed to update history for renamed file ${file.basename}`);
			}
		}
	}

	// Updated: Use direct path check and remove
	async deleteHistoryFile(filePath: string) {
		const historyPath = this.getHistoryFilePath(filePath);
		try {
			const historyFile = this.plugin.app.vault.getAbstractFileByPath(historyPath);
			if (historyFile instanceof TFile) {
				await this.plugin.app.vault.delete(historyFile); // Use vault.delete
			} else {
				// If not found in vault cache, try adapter remove as a fallback
				const exists = await this.plugin.app.vault.adapter.exists(historyPath);
				if (exists) {
					await this.plugin.app.vault.adapter.remove(historyPath);
					console.log(`Removed history file via adapter: ${historyPath}`);
				}
			}
		} catch (error) {
			if (!error.message.includes('does not exist')) {
				console.error('Failed to delete history file:', historyPath, error);
				// Avoid bothering user if file simply wasn't there
			}
		}
	}
}
