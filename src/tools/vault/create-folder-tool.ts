import { Tool, ToolResult, ToolExecutionContext } from '../types';
import { ToolCategory } from '../../types/agent';
import { ToolClassification } from '../../types/tool-policy';
import { TFolder, normalizePath } from 'obsidian';
import type ObsidianGemini from '../../main';
import { shouldExcludePathForPlugin as shouldExcludePath, ensureFolderExists } from '../../utils/file-utils';

/**
 * Create a new folder
 */
export class CreateFolderTool implements Tool {
	name = 'create_folder';
	displayName = 'Create Folder';
	category = ToolCategory.VAULT_OPERATIONS;
	classification = ToolClassification.WRITE;
	description =
		"Create a new folder in the vault at the specified path. Parent folders will be created automatically if they don't exist. Returns the normalized folder path on success. Use this to organize notes into new directory structures or prepare locations for new files.";
	requiresConfirmation = true;

	parameters = {
		type: 'object' as const,
		properties: {
			path: {
				type: 'string' as const,
				description: 'Path of the folder to create',
			},
		},
		required: ['path'],
	};

	confirmationMessage = (params: { path: string }) => {
		return `Create folder: ${params.path}`;
	};

	getProgressDescription(params: { path: string }): string {
		if (params.path) {
			return `Creating folder ${params.path}`;
		}
		return 'Creating folder';
	}

	async execute(params: { path: string }, context: ToolExecutionContext): Promise<ToolResult> {
		const plugin = context.plugin as ObsidianGemini;

		try {
			const normalizedPath = normalizePath(params.path);

			// Check if path is excluded
			if (shouldExcludePath(normalizedPath, plugin)) {
				return {
					success: false,
					error: `Cannot create folder in system directory: ${params.path}`,
				};
			}

			const existing = plugin.app.vault.getAbstractFileByPath(normalizedPath);

			if (existing instanceof TFolder) {
				return {
					success: true,
					data: {
						path: normalizedPath,
						action: 'already_exists',
					},
				};
			}

			if (existing) {
				return {
					success: false,
					error: `A file already exists at path: ${params.path}`,
				};
			}

			await ensureFolderExists(plugin.app.vault, normalizedPath, 'vault folder', plugin.logger);

			return {
				success: true,
				data: {
					path: normalizedPath,
					action: 'created',
				},
			};
		} catch (error) {
			return {
				success: false,
				error: `Error creating folder: ${error instanceof Error ? error.message : 'Unknown error'}`,
			};
		}
	}
}
