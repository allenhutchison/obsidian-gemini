import { Tool, ToolResult, ToolExecutionContext } from './types';
import { ToolCategory } from '../types/agent';
import { TFile } from 'obsidian';
import type ObsidianGemini from '../main';

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
		'Use it to update status, tags, dates, or any other property.';

	parameters = {
		type: 'object' as const,
		properties: {
			path: {
				type: 'string' as const,
				description: 'Absolute path to the file to update',
			},
			key: {
				type: 'string' as const,
				description: 'The property key to update',
			},
			value: {
				type: ['string', 'number', 'boolean', 'array'] as const,
				description: 'The new value for the property',
			},
		},
		required: ['path', 'key', 'value'],
	};

	async execute(params: { path: string; key: string; value: any }, context: ToolExecutionContext): Promise<ToolResult> {
		const plugin = context.plugin as InstanceType<typeof ObsidianGemini>;
		const { path, key, value } = params;

		// Check for system folder protection
		const historyFolder = plugin.settings.historyFolder;
		if (path.startsWith(historyFolder + '/') || path.startsWith('.obsidian/')) {
			return {
				success: false,
				error: `Cannot modify files in protected system folder: ${path}`,
			};
		}

		try {
			const file = plugin.app.vault.getAbstractFileByPath(path);

			if (!file || !(file instanceof TFile)) {
				return {
					success: false,
					error: `File not found or is not a markdown file: ${path}`,
				};
			}

			// Use Obsidian's native API for safe frontmatter updates
			await plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
				frontmatter[key] = value;
			});

			plugin.logger.log(`Updated frontmatter for ${path}: ${key} = ${value}`);

			return {
				success: true,
				output: `Successfully updated property "${key}" to "${value}" in ${path}`,
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
		'If the file does not exist, an error is returned (use write_file to create new files).';

	parameters = {
		type: 'object' as const,
		properties: {
			path: {
				type: 'string' as const,
				description: 'Absolute path to the file',
			},
			content: {
				type: 'string' as const,
				description: 'The text content to append (automatically adds newline if needed)',
			},
		},
		required: ['path', 'content'],
	};

	async execute(params: { path: string; content: string }, context: ToolExecutionContext): Promise<ToolResult> {
		const plugin = context.plugin as InstanceType<typeof ObsidianGemini>;
		const { path, content } = params;

		// Check for system folder protection
		const historyFolder = plugin.settings.historyFolder;
		if (path.startsWith(historyFolder + '/') || path.startsWith('.obsidian/')) {
			return {
				success: false,
				error: `Cannot modify files in protected system folder: ${path}`,
			};
		}

		try {
			const file = plugin.app.vault.getAbstractFileByPath(path);

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

			plugin.logger.log(`Appended ${contentToAppend.length} chars to ${path}`);

			return {
				success: true,
				output: `Successfully appended content to ${path}`,
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
