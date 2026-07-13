import { Tool, ToolResult, ToolExecutionContext } from '../types';
import { ToolCategory } from '../../types/agent';
import { ToolClassification } from '../../types/tool-policy';
import { normalizePath } from 'obsidian';
import { guardExcludedPath, resolvePathToFileOrFolder } from './utils';
import { t } from '../../i18n';
import { getRawErrorMessageOr } from '../../utils/error-utils';

/**
 * Delete a file or folder
 */
export class DeleteFileTool implements Tool {
	name = 'delete_file';
	displayName = 'Delete File';
	category = ToolCategory.VAULT_OPERATIONS;
	classification = ToolClassification.DESTRUCTIVE;
	description =
		'Delete a file or folder from the vault. The file is removed according to the user\'s Obsidian "Deleted files" setting — moved to the system trash, moved to the vault\'s .trash folder, or (if the user configured it) permanently deleted — so recoverability is not guaranteed. When deleting a folder, all contents are removed recursively. Returns the path and type (file/folder) that was deleted. Path can be a full path, filename, or wikilink (e.g., "[[My Note]]") - wikilinks will be automatically resolved. Always confirm with the user before executing this destructive operation.';
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
		return t('tool.confirm.deleteFile', { path: params.path });
	};

	getProgressDescription(params: { path: string }): string {
		if (params.path) {
			return `Deleting ${params.path}`;
		}
		return 'Deleting file';
	}

	async execute(params: { path: string }, context: ToolExecutionContext): Promise<ToolResult> {
		const plugin = context.plugin;

		try {
			const normalizedPath = normalizePath(params.path);

			// Check if path is excluded
			const excluded = guardExcludedPath(normalizedPath, plugin, `Cannot delete system folder: ${params.path}`);
			if (excluded) return excluded;

			// Use shared file/folder resolution helper
			const { item, type } = resolvePathToFileOrFolder(params.path, plugin);

			if (!item) {
				return {
					success: false,
					error: `File or folder not found: ${params.path}`,
				};
			}

			await plugin.app.fileManager.trashFile(item);

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
				error: `Error deleting file or folder: ${getRawErrorMessageOr(error, 'Unknown error')}`,
			};
		}
	}
}
