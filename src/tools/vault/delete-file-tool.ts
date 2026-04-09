import { Tool, ToolResult, ToolExecutionContext } from '../types';
import { ToolCategory } from '../../types/agent';
import { ToolClassification } from '../../types/tool-policy';
import { normalizePath } from 'obsidian';
import type ObsidianGemini from '../../main';
import { shouldExcludePathForPlugin as shouldExcludePath } from '../../utils/file-utils';
import { resolvePathToFileOrFolder } from './utils';

/**
 * Delete a file or folder
 */
export class DeleteFileTool implements Tool {
	name = 'delete_file';
	displayName = 'Delete File';
	category = ToolCategory.VAULT_OPERATIONS;
	classification = ToolClassification.DESTRUCTIVE;
	description =
		'Permanently delete a file or folder from the vault. WARNING: This action cannot be undone! When deleting a folder, all contents are removed recursively. Returns the path and type (file/folder) that was deleted. Path can be a full path, filename, or wikilink (e.g., "[[My Note]]") - wikilinks will be automatically resolved. Always confirm with the user before executing this destructive operation.';
	requiresConfirmation = true;

	parameters = {
		type: 'object' as const,
		properties: {
			path: {
				type: 'string' as const,
				description: 'Path of the file or folder to delete',
			},
		},
		required: ['path'],
	};

	confirmationMessage = (params: { path: string }) => {
		return `Delete file or folder: ${params.path}\n\nThis action cannot be undone.`;
	};

	getProgressDescription(params: { path: string }): string {
		if (params.path) {
			return `Deleting ${params.path}`;
		}
		return 'Deleting file';
	}

	async execute(params: { path: string }, context: ToolExecutionContext): Promise<ToolResult> {
		const plugin = context.plugin as InstanceType<typeof ObsidianGemini>;

		try {
			const normalizedPath = normalizePath(params.path);

			// Check if path is excluded
			if (shouldExcludePath(normalizedPath, plugin)) {
				return {
					success: false,
					error: `Cannot delete system folder: ${params.path}`,
				};
			}

			// Use shared file/folder resolution helper
			const { item, type } = resolvePathToFileOrFolder(params.path, plugin);

			if (!item) {
				return {
					success: false,
					error: `File or folder not found: ${params.path}`,
				};
			}

			await plugin.app.vault.delete(item);

			return {
				success: true,
				data: {
					path: item.path,
					type: type,
					action: 'deleted',
				},
			};
		} catch (error) {
			return {
				success: false,
				error: `Error deleting file or folder: ${error instanceof Error ? error.message : 'Unknown error'}`,
			};
		}
	}
}
