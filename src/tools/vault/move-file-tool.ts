import { Tool, ToolResult, ToolExecutionContext } from '../types';
import { ToolCategory } from '../../types/agent';
import { ToolClassification } from '../../types/tool-policy';
import { normalizePath } from 'obsidian';
import type ObsidianGemini from '../../main';
import { shouldExcludePathForPlugin as shouldExcludePath, ensureFolderExists } from '../../utils/file-utils';
import { resolvePathToFileOrFolder } from './utils';

/**
 * Move or rename a file or folder
 */
export class MoveFileTool implements Tool {
	name = 'move_file';
	displayName = 'Move/Rename File';
	category = ToolCategory.VAULT_OPERATIONS;
	classification = ToolClassification.DESTRUCTIVE;
	description =
		'Move a file or folder to a different location or rename it. Provide both source and target paths (including filenames for files). Source path can be a full path, filename, or wikilink (e.g., "[[My Note]]") - wikilinks will be automatically resolved. Target directory will be created if it doesn\'t exist. When moving folders, all contents are moved recursively. Returns both paths and action status. Examples: rename "Note.md" to "New Name.md" in same folder, move "Folder A/Note.md" to "Folder B/Subfolder/Note.md", or move "Folder A" to "Folder B/Folder A". Preserves all file metadata and updates internal links automatically.';
	requiresConfirmation = true;

	parameters = {
		type: 'object' as const,
		properties: {
			sourcePath: {
				type: 'string' as const,
				description: 'Current path of the file or folder to move',
			},
			targetPath: {
				type: 'string' as const,
				description: 'New path for the file or folder (including filename for files)',
			},
		},
		required: ['sourcePath', 'targetPath'],
	};

	confirmationMessage = (params: { sourcePath: string; targetPath: string }) => {
		return `Move file or folder from: ${params.sourcePath}\nTo: ${params.targetPath}`;
	};

	getProgressDescription(params: { sourcePath: string; targetPath: string }): string {
		if (params.sourcePath && params.targetPath) {
			// Extract just the filename for brevity
			const source = params.sourcePath.split('/').pop() || params.sourcePath;
			const target = params.targetPath.split('/').pop() || params.targetPath;
			return `Moving ${source} to ${target}`;
		}
		return 'Moving file';
	}

	async execute(
		params: { sourcePath: string; targetPath: string },
		context: ToolExecutionContext
	): Promise<ToolResult> {
		const plugin = context.plugin as InstanceType<typeof ObsidianGemini>;

		try {
			const sourceNormalizedPath = normalizePath(params.sourcePath);
			const targetNormalizedPath = normalizePath(params.targetPath);

			// Check if either path is excluded
			if (shouldExcludePath(sourceNormalizedPath, plugin)) {
				return {
					success: false,
					error: `Cannot move from system folder: ${params.sourcePath}`,
				};
			}

			if (shouldExcludePath(targetNormalizedPath, plugin)) {
				return {
					success: false,
					error: `Cannot move to system folder: ${params.targetPath}`,
				};
			}

			// Use shared file/folder resolution helper
			const { item: sourceItem, type } = resolvePathToFileOrFolder(params.sourcePath, plugin);

			if (!sourceItem) {
				return {
					success: false,
					error: `Source file or folder not found: ${params.sourcePath}`,
				};
			}

			// Check if target already exists
			const targetExists = await plugin.app.vault.adapter.exists(targetNormalizedPath);
			if (targetExists) {
				return {
					success: false,
					error: `Target path already exists: ${params.targetPath}`,
				};
			}

			// Ensure target directory exists (for files and folders)
			const targetDir = targetNormalizedPath.substring(0, targetNormalizedPath.lastIndexOf('/'));
			if (targetDir) {
				await ensureFolderExists(plugin.app.vault, targetDir, 'target directory', plugin.logger);
			}

			// Perform the rename/move
			await plugin.app.vault.rename(sourceItem, targetNormalizedPath);

			return {
				success: true,
				data: {
					sourcePath: sourceItem.path,
					targetPath: targetNormalizedPath,
					type: type,
					action: 'moved',
				},
			};
		} catch (error) {
			return {
				success: false,
				error: `Error moving file or folder: ${error instanceof Error ? error.message : 'Unknown error'}`,
			};
		}
	}
}
