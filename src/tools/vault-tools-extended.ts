import { Tool, ToolResult, ToolExecutionContext } from './types';
import { ToolCategory } from '../types/agent';
import { TFile, normalizePath } from 'obsidian';
import type ObsidianGemini from '../main';
import { shouldExcludePathForPlugin as shouldExcludePath } from '../utils/file-utils';

/**
 * Tool to safely update YAML frontmatter without touching content
 * Critical for integration with Obsidian Bases and other metadata-driven plugins
 */
export class UpdateFrontmatterTool implements Tool {
	name = 'update_frontmatter';
	displayName = 'Update Frontmatter';
	category = ToolCategory.VAULT_OPERATIONS;
	requiresConfirmation = true;
	description =
		'Update a specific YAML frontmatter property in a file. ' +
		'This tool is safe to use as it only modifies metadata and preserves the note content. ' +
		'Use it to update status, tags, dates, or any other property. ' +
		'Path can be a full path (e.g., "folder/note.md"), a simple filename, or a wikilink text. The .md extension is optional.';

	parameters = {
		type: 'object' as const,
		properties: {
			path: {
				type: 'string' as const,
				description:
					'Path to the file relative to vault root (e.g., "folder/note.md", "folder/note", or "note"). Extension is optional.',
			},
			key: {
				type: 'string' as const,
				description: 'The property key to update',
			},
			value: {
				type: 'string' as const,
				description: 'The new value for the property (string, number, boolean, or array)',
			},
		},
		required: ['path', 'key', 'value'],
	};

	confirmationMessage = (params: { path: string; key: string; value: any }) => {
		return `Update frontmatter in ${params.path}: set "${params.key}" to "${params.value}"`;
	};

	getProgressDescription(params: { path: string; key: string }): string {
		if (params.path) {
			return `Updating frontmatter in ${params.path}`;
		}
		return 'Updating frontmatter';
	}

	async execute(params: { path: string; key: string; value: any }, context: ToolExecutionContext): Promise<ToolResult> {
		const plugin = context.plugin as InstanceType<typeof ObsidianGemini>;
		const { path, key, value } = params;

		try {
			const normalizedPath = normalizePath(path);

			// Check if path is excluded
			if (shouldExcludePath(normalizedPath, plugin)) {
				return {
					success: false,
					error: `Cannot modify files in system folder: ${path}`,
				};
			}

			// Try direct path lookup, then with .md extension
			let file = plugin.app.vault.getAbstractFileByPath(normalizedPath);
			if (!file && !normalizedPath.endsWith('.md')) {
				file = plugin.app.vault.getAbstractFileByPath(normalizedPath + '.md');
			}

			// Try wikilink resolution
			if (!file) {
				const linkPath = path.replace(/^\[\[/, '').replace(/\]\]$/, '').replace(/\.md$/, '');
				const resolved = plugin.app.metadataCache.getFirstLinkpathDest(linkPath, '');
				if (resolved) {
					file = resolved;
				}
			}

			if (!file || !(file instanceof TFile) || file.extension !== 'md') {
				return {
					success: false,
					error: `File not found or is not a markdown file: ${path}`,
				};
			}

			// Use Obsidian's native API for safe frontmatter updates
			await plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
				frontmatter[key] = value;
			});

			plugin.logger.debug(`Updated frontmatter for ${file.path}: ${key} = ${value}`);

			return {
				success: true,
				data: {
					path: file.path,
					key,
					value,
					action: 'updated',
				},
			};
		} catch (error) {
			const msg = error instanceof Error ? error.message : 'Unknown error';
			plugin.logger.error(`Failed to update frontmatter for ${path}: ${msg}`);
			return {
				success: false,
				error: `Failed to update frontmatter: ${msg}`,
			};
		}
	}
}

/**
 * Tool to append content to the end of a file
 * Useful for logging, journaling, or adding items to lists without rewriting the whole file
 */
export class AppendContentTool implements Tool {
	name = 'append_content';
	displayName = 'Append Content';
	category = ToolCategory.VAULT_OPERATIONS;
	requiresConfirmation = true;
	description =
		'Append text to the end of a file. ' +
		'Useful for adding log entries, diary updates, or new sections without rewriting the entire file. ' +
		'If the file does not exist, an error is returned (use write_file to create new files). ' +
		'Path can be a full path (e.g., "folder/note.md"), a simple filename, or a wikilink text. The .md extension is optional.';

	parameters = {
		type: 'object' as const,
		properties: {
			path: {
				type: 'string' as const,
				description:
					'Path to the file relative to vault root (e.g., "folder/note.md", "folder/note", or "note"). Extension is optional.',
			},
			content: {
				type: 'string' as const,
				description: 'The text content to append (automatically adds newline if needed)',
			},
		},
		required: ['path', 'content'],
	};

	confirmationMessage = (params: { path: string; content: string }) => {
		return `Append content to file: ${params.path}\n\nContent preview:\n${params.content.substring(0, 200)}${params.content.length > 200 ? '...' : ''}`;
	};

	getProgressDescription(params: { path: string }): string {
		if (params.path) {
			return `Appending to ${params.path}`;
		}
		return 'Appending content';
	}

	async execute(params: { path: string; content: string }, context: ToolExecutionContext): Promise<ToolResult> {
		const plugin = context.plugin as InstanceType<typeof ObsidianGemini>;
		const { path, content } = params;

		try {
			const normalizedPath = normalizePath(path);

			// Check if path is excluded
			if (shouldExcludePath(normalizedPath, plugin)) {
				return {
					success: false,
					error: `Cannot modify files in system folder: ${path}`,
				};
			}

			// Try direct path lookup, then with .md extension
			let file = plugin.app.vault.getAbstractFileByPath(normalizedPath);
			if (!file && !normalizedPath.endsWith('.md')) {
				file = plugin.app.vault.getAbstractFileByPath(normalizedPath + '.md');
			}

			// Try wikilink resolution
			if (!file) {
				const linkPath = path.replace(/^\[\[/, '').replace(/\]\]$/, '').replace(/\.md$/, '');
				const resolved = plugin.app.metadataCache.getFirstLinkpathDest(linkPath, '');
				if (resolved) {
					file = resolved;
				}
			}

			if (!file || !(file instanceof TFile)) {
				return {
					success: false,
					error: `File not found: ${path}`,
				};
			}

			// Ensure content starts with newline if file is not empty
			let contentToAppend = content;
			const fileContent = await plugin.app.vault.read(file);
			if (fileContent.length > 0 && !fileContent.endsWith('\n') && !content.startsWith('\n')) {
				contentToAppend = '\n' + content;
			}

			await plugin.app.vault.append(file, contentToAppend);

			plugin.logger.debug(`Appended ${contentToAppend.length} chars to ${file.path}`);

			return {
				success: true,
				data: {
					path: file.path,
					action: 'appended',
					size: contentToAppend.length,
				},
			};
		} catch (error) {
			const msg = error instanceof Error ? error.message : 'Unknown error';
			plugin.logger.error(`Failed to append content to ${path}: ${msg}`);
			return {
				success: false,
				error: `Failed to append content: ${msg}`,
			};
		}
	}
}

/**
 * Get all extended vault tools
 */
export function getExtendedVaultTools(): Tool[] {
	return [new UpdateFrontmatterTool(), new AppendContentTool()];
}
