import { Tool, ToolResult, ToolExecutionContext } from '../types';
import { ToolCategory } from '../../types/agent';
import { ToolClassification } from '../../types/tool-policy';
import { TFile, TFolder, normalizePath } from 'obsidian';
import type ObsidianGemini from '../../main';
import { shouldExcludePathForPlugin as shouldExcludePath } from '../../utils/file-utils';

/**
 * List files in a folder
 */
export class ListFilesTool implements Tool {
	name = 'list_files';
	displayName = 'List Files';
	category = ToolCategory.READ_ONLY;
	classification = ToolClassification.READ;
	description =
		'List all files and folders in a directory. Returns an array of objects with name, path, type (file/folder), size, and modification time for each item. Can list recursively through all subdirectories or just immediate children. Use empty string for path to list the vault root. Useful for exploring folder structure or finding all files in a specific location.';

	parameters = {
		type: 'object' as const,
		properties: {
			path: {
				type: 'string' as const,
				description: 'Path to the directory to list (empty string for root)',
			},
			recursive: {
				type: 'boolean' as const,
				description: 'Whether to list files recursively',
			},
		},
		required: ['path'],
	};

	getProgressDescription(params: { path: string }): string {
		if (params.path) {
			const folder = params.path === '/' ? 'vault' : params.path;
			return `Listing files in ${folder}`;
		}
		return 'Listing files';
	}

	async execute(params: { path: string; recursive?: boolean }, context: ToolExecutionContext): Promise<ToolResult> {
		const plugin = context.plugin as ObsidianGemini;

		try {
			// Default to project root when no path specified and project is active.
			// Normalize to strip trailing slashes and collapse duplicates; empty string stays
			// empty to preserve "list vault root" semantics. Obsidian's normalizePath("") === "/",
			// and "/" is also treated as the root shorthand.
			const rawPath = params.path || context.projectRootPath || '';
			const normalized = rawPath ? normalizePath(rawPath) : '';
			const folderPath = normalized === '/' ? '' : normalized;
			const folder = folderPath ? plugin.app.vault.getAbstractFileByPath(folderPath) : null;

			// Show the resolved path in errors — `params.path` may be empty when
			// falling back to `context.projectRootPath`, which would render blank.
			const displayPath = folderPath || params.path || '(vault root)';

			if (folderPath && !folder) {
				return {
					success: false,
					error: `Folder not found: ${displayPath}`,
				};
			}

			if (folderPath && !(folder instanceof TFolder)) {
				return {
					success: false,
					error: `Path is not a folder: ${displayPath}`,
				};
			}

			const files = params.recursive
				? plugin.app.vault.getFiles()
				: (folder as TFolder)?.children || plugin.app.vault.getRoot().children;

			const fileList = files
				.filter((f) => {
					// Apply folder filter for recursive listing (boundary-aware)
					if (params.recursive && folderPath && !f.path.startsWith(folderPath + '/')) {
						return false;
					}
					// Exclude system folders
					return !shouldExcludePath(f.path, plugin);
				})
				.map((f) => ({
					name: f.name,
					path: f.path,
					type: f instanceof TFile ? 'file' : 'folder',
					size: f instanceof TFile ? f.stat.size : undefined,
					modified: f instanceof TFile ? f.stat.mtime : undefined,
				}));

			return {
				success: true,
				data: {
					path: folderPath,
					files: fileList,
					count: fileList.length,
				},
			};
		} catch (error) {
			return {
				success: false,
				error: `Error listing files: ${error instanceof Error ? error.message : 'Unknown error'}`,
			};
		}
	}
}
