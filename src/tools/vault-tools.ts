import { Tool, ToolResult, ToolExecutionContext } from './types';
import { ToolCategory } from '../types/agent';
import { TFile, TFolder, normalizePath } from 'obsidian';
import type ObsidianGemini from '../main';

/**
 * Helper function to check if a path should be excluded from vault operations
 */
function shouldExcludePath(path: string, plugin: InstanceType<typeof ObsidianGemini>): boolean {
	// Exclude the plugin's state folder
	const stateFolder = plugin.settings.historyFolder;
	if (path === stateFolder || path.startsWith(stateFolder + '/')) {
		return true;
	}
	
	// Also exclude .obsidian folder
	if (path === '.obsidian' || path.startsWith('.obsidian/')) {
		return true;
	}
	
	return false;
}

/**
 * Read file content
 */
export class ReadFileTool implements Tool {
	name = 'read_file';
	category = ToolCategory.READ_ONLY;
	description = 'Read the contents of a file in the vault';
	
	parameters = {
		type: 'object' as const,
		properties: {
			path: {
				type: 'string' as const,
				description: 'Path to the file to read'
			}
		},
		required: ['path']
	};

	async execute(params: { path: string }, context: ToolExecutionContext): Promise<ToolResult> {
		const plugin = context.plugin as InstanceType<typeof ObsidianGemini>;
		
		try {
			const normalizedPath = normalizePath(params.path);
			
			// Check if path is excluded
			if (shouldExcludePath(normalizedPath, plugin)) {
				return {
					success: false,
					error: `Cannot read from system folder: ${params.path}`
				};
			}
			
			const file = plugin.app.vault.getAbstractFileByPath(normalizedPath);
			
			if (!file) {
				return {
					success: false,
					error: `File not found: ${params.path}`
				};
			}
			
			if (!(file instanceof TFile)) {
				return {
					success: false,
					error: `Path is not a file: ${params.path}`
				};
			}
			
			const content = await plugin.app.vault.read(file);
			
			return {
				success: true,
				data: {
					path: params.path,
					content: content,
					size: file.stat.size,
					modified: file.stat.mtime
				}
			};
			
		} catch (error) {
			return {
				success: false,
				error: `Error reading file: ${error instanceof Error ? error.message : 'Unknown error'}`
			};
		}
	}
}

/**
 * Write file content
 */
export class WriteFileTool implements Tool {
	name = 'write_file';
	category = ToolCategory.VAULT_OPERATIONS;
	description = 'Write content to a file in the vault (creates new file or overwrites existing)';
	requiresConfirmation = true;
	
	parameters = {
		type: 'object' as const,
		properties: {
			path: {
				type: 'string' as const,
				description: 'Path to the file to write'
			},
			content: {
				type: 'string' as const,
				description: 'Content to write to the file'
			}
		},
		required: ['path', 'content']
	};

	confirmationMessage = (params: { path: string; content: string }) => {
		return `Write content to file: ${params.path}\n\nContent preview:\n${params.content.substring(0, 200)}${params.content.length > 200 ? '...' : ''}`;
	};

	async execute(params: { path: string; content: string }, context: ToolExecutionContext): Promise<ToolResult> {
		const plugin = context.plugin as InstanceType<typeof ObsidianGemini>;
		
		try {
			const normalizedPath = normalizePath(params.path);
			
			// Check if path is excluded
			if (shouldExcludePath(normalizedPath, plugin)) {
				return {
					success: false,
					error: `Cannot write to system folder: ${params.path}`
				};
			}
			
			let file = plugin.app.vault.getAbstractFileByPath(normalizedPath);
			const isNewFile = !file;
			
			if (file instanceof TFile) {
				// File exists, modify it
				await plugin.app.vault.modify(file, params.content);
			} else {
				// File doesn't exist, create it
				await plugin.app.vault.create(normalizedPath, params.content);
				// Get the newly created file
				file = plugin.app.vault.getAbstractFileByPath(normalizedPath);
			}
			
			// Add the file to session context if it's a new file and we have a session
			if (file instanceof TFile && context.session && isNewFile) {
				const agentView = plugin.app.workspace.getLeavesOfType('gemini-agent-view')[0]?.view;
				if (agentView && 'getCurrentSessionForToolExecution' in agentView) {
					const session = (agentView as any).getCurrentSessionForToolExecution();
					if (session && !session.context.contextFiles.includes(file)) {
						session.context.contextFiles.push(file);
						// Update UI if agent view is active
						if ('updateContextFilesList' in agentView && 'updateSessionHeader' in agentView) {
							const contextPanel = (agentView as any).contextPanel;
							if (contextPanel) {
								(agentView as any).updateContextFilesList(contextPanel.querySelector('.gemini-agent-files-list'));
								(agentView as any).updateSessionHeader();
								(agentView as any).updateSessionMetadata();
							}
						}
					}
				}
			}
			
			return {
				success: true,
				data: {
					path: normalizedPath,
					action: file ? 'modified' : 'created',
					size: params.content.length
				}
			};
			
		} catch (error) {
			return {
				success: false,
				error: `Error writing file: ${error instanceof Error ? error.message : 'Unknown error'}`
			};
		}
	}
}

/**
 * List files in a folder
 */
export class ListFilesTool implements Tool {
	name = 'list_files';
	category = ToolCategory.READ_ONLY;
	description = 'List files and folders in a directory';
	
	parameters = {
		type: 'object' as const,
		properties: {
			path: {
				type: 'string' as const,
				description: 'Path to the directory to list (empty string for root)'
			},
			recursive: {
				type: 'boolean' as const,
				description: 'Whether to list files recursively'
			}
		},
		required: ['path']
	};

	async execute(params: { path: string; recursive?: boolean }, context: ToolExecutionContext): Promise<ToolResult> {
		const plugin = context.plugin as InstanceType<typeof ObsidianGemini>;
		
		try {
			const folderPath = params.path || '';
			const folder = plugin.app.vault.getAbstractFileByPath(folderPath);
			
			if (folderPath && !folder) {
				return {
					success: false,
					error: `Folder not found: ${params.path}`
				};
			}
			
			if (folderPath && !(folder instanceof TFolder)) {
				return {
					success: false,
					error: `Path is not a folder: ${params.path}`
				};
			}
			
			const files = params.recursive 
				? plugin.app.vault.getMarkdownFiles()
				: (folder as TFolder)?.children || plugin.app.vault.getRoot().children;
			
			const fileList = files
				.filter(f => {
					// Apply folder filter for recursive listing
					if (params.recursive && folderPath && !f.path.startsWith(folderPath)) {
						return false;
					}
					// Exclude system folders
					return !shouldExcludePath(f.path, plugin);
				})
				.map(f => ({
					name: f.name,
					path: f.path,
					type: f instanceof TFile ? 'file' : 'folder',
					size: f instanceof TFile ? f.stat.size : undefined,
					modified: f instanceof TFile ? f.stat.mtime : undefined
				}));
			
			return {
				success: true,
				data: {
					path: folderPath,
					files: fileList,
					count: fileList.length
				}
			};
			
		} catch (error) {
			return {
				success: false,
				error: `Error listing files: ${error instanceof Error ? error.message : 'Unknown error'}`
			};
		}
	}
}

/**
 * Create a new folder
 */
export class CreateFolderTool implements Tool {
	name = 'create_folder';
	category = ToolCategory.VAULT_OPERATIONS;
	description = 'Create a new folder in the vault';
	requiresConfirmation = true;
	
	parameters = {
		type: 'object' as const,
		properties: {
			path: {
				type: 'string' as const,
				description: 'Path of the folder to create'
			}
		},
		required: ['path']
	};

	confirmationMessage = (params: { path: string }) => {
		return `Create folder: ${params.path}`;
	};

	async execute(params: { path: string }, context: ToolExecutionContext): Promise<ToolResult> {
		const plugin = context.plugin as InstanceType<typeof ObsidianGemini>;
		
		try {
			const normalizedPath = normalizePath(params.path);
			
			// Check if path is excluded
			if (shouldExcludePath(normalizedPath, plugin)) {
				return {
					success: false,
					error: `Cannot create folder in system directory: ${params.path}`
				};
			}
			
			const existing = plugin.app.vault.getAbstractFileByPath(normalizedPath);
			
			if (existing) {
				return {
					success: false,
					error: `Path already exists: ${params.path}`
				};
			}
			
			await plugin.app.vault.createFolder(normalizedPath);
			
			return {
				success: true,
				data: {
					path: normalizedPath,
					action: 'created'
				}
			};
			
		} catch (error) {
			return {
				success: false,
				error: `Error creating folder: ${error instanceof Error ? error.message : 'Unknown error'}`
			};
		}
	}
}

/**
 * Delete a file or folder
 */
export class DeleteFileTool implements Tool {
	name = 'delete_file';
	category = ToolCategory.VAULT_OPERATIONS;
	description = 'Delete a file or folder from the vault';
	requiresConfirmation = true;
	
	parameters = {
		type: 'object' as const,
		properties: {
			path: {
				type: 'string' as const,
				description: 'Path of the file or folder to delete'
			}
		},
		required: ['path']
	};

	confirmationMessage = (params: { path: string }) => {
		return `Delete file or folder: ${params.path}\n\nThis action cannot be undone.`;
	};

	async execute(params: { path: string }, context: ToolExecutionContext): Promise<ToolResult> {
		const plugin = context.plugin as InstanceType<typeof ObsidianGemini>;
		
		try {
			const normalizedPath = normalizePath(params.path);
			
			// Check if path is excluded
			if (shouldExcludePath(normalizedPath, plugin)) {
				return {
					success: false,
					error: `Cannot delete system folder: ${params.path}`
				};
			}
			
			const file = plugin.app.vault.getAbstractFileByPath(normalizedPath);
			
			if (!file) {
				return {
					success: false,
					error: `File or folder not found: ${params.path}`
				};
			}
			
			const type = file instanceof TFile ? 'file' : 'folder';
			await plugin.app.vault.delete(file);
			
			return {
				success: true,
				data: {
					path: params.path,
					type: type,
					action: 'deleted'
				}
			};
			
		} catch (error) {
			return {
				success: false,
				error: `Error deleting file: ${error instanceof Error ? error.message : 'Unknown error'}`
			};
		}
	}
}

/**
 * Move or rename a file
 */
export class MoveFileTool implements Tool {
	name = 'move_file';
	category = ToolCategory.VAULT_OPERATIONS;
	description = 'Move or rename a file in the vault';
	requiresConfirmation = true;
	
	parameters = {
		type: 'object' as const,
		properties: {
			sourcePath: {
				type: 'string' as const,
				description: 'Current path of the file to move'
			},
			targetPath: {
				type: 'string' as const,
				description: 'New path for the file (including filename)'
			}
		},
		required: ['sourcePath', 'targetPath']
	};

	confirmationMessage = (params: { sourcePath: string; targetPath: string }) => {
		return `Move file from: ${params.sourcePath}\nTo: ${params.targetPath}`;
	};

	async execute(params: { sourcePath: string; targetPath: string }, context: ToolExecutionContext): Promise<ToolResult> {
		const plugin = context.plugin as InstanceType<typeof ObsidianGemini>;
		
		try {
			const sourceNormalizedPath = normalizePath(params.sourcePath);
			const targetNormalizedPath = normalizePath(params.targetPath);
			
			// Check if either path is excluded
			if (shouldExcludePath(sourceNormalizedPath, plugin)) {
				return {
					success: false,
					error: `Cannot move from system folder: ${params.sourcePath}`
				};
			}
			
			if (shouldExcludePath(targetNormalizedPath, plugin)) {
				return {
					success: false,
					error: `Cannot move to system folder: ${params.targetPath}`
				};
			}
			
			const sourceFile = plugin.app.vault.getAbstractFileByPath(sourceNormalizedPath);
			
			if (!sourceFile) {
				return {
					success: false,
					error: `Source file not found: ${params.sourcePath}`
				};
			}
			
			if (!(sourceFile instanceof TFile)) {
				return {
					success: false,
					error: `Source path is not a file: ${params.sourcePath}`
				};
			}
			
			// Target path is already normalized above
			
			// Check if target already exists
			const targetExists = await plugin.app.vault.adapter.exists(targetNormalizedPath);
			if (targetExists) {
				return {
					success: false,
					error: `Target path already exists: ${params.targetPath}`
				};
			}
			
			// Ensure target directory exists
			const targetDir = targetNormalizedPath.substring(0, targetNormalizedPath.lastIndexOf('/'));
			if (targetDir && !(await plugin.app.vault.adapter.exists(targetDir))) {
				await plugin.app.vault.createFolder(targetDir).catch(() => {
					// Folder might already exist or parent folders need to be created
				});
			}
			
			// Perform the rename/move
			await plugin.app.vault.rename(sourceFile, targetNormalizedPath);
			
			return {
				success: true,
				data: {
					sourcePath: params.sourcePath,
					targetPath: targetNormalizedPath,
					action: 'moved'
				}
			};
			
		} catch (error) {
			return {
				success: false,
				error: `Error moving file: ${error instanceof Error ? error.message : 'Unknown error'}`
			};
		}
	}
}

/**
 * Search for files by name pattern
 */
export class SearchFilesTool implements Tool {
	name = 'search_files';
	category = ToolCategory.READ_ONLY;
	description = 'Search for files in the vault by name pattern';
	
	parameters = {
		type: 'object' as const,
		properties: {
			pattern: {
				type: 'string' as const,
				description: 'Search pattern (supports wildcards: * matches any characters, ? matches single character)'
			},
			limit: {
				type: 'number' as const,
				description: 'Maximum number of results to return'
			}
		},
		required: ['pattern']
	};

	async execute(params: { pattern: string; limit?: number }, context: ToolExecutionContext): Promise<ToolResult> {
		const plugin = context.plugin as InstanceType<typeof ObsidianGemini>;
		
		try {
			const allFiles = plugin.app.vault.getMarkdownFiles();
			const limit = params.limit || 50;
			
			// Check if pattern contains wildcards
			const hasWildcards = params.pattern.includes('*') || params.pattern.includes('?');
			
			let regex: RegExp;
			if (hasWildcards) {
				// Convert wildcard pattern to regex
				// Escape special regex characters except * and ?
				let regexPattern = params.pattern
					.replace(/[.+^${}()|[\]\\]/g, '\\$&')  // Escape special regex chars
					.replace(/\*/g, '.*')  // * matches any characters
					.replace(/\?/g, '.');  // ? matches single character
				
				// Add anchors if pattern doesn't start/end with wildcards
				// This makes patterns like 'Test*' match only files starting with Test
				if (!params.pattern.startsWith('*') && !params.pattern.startsWith('?')) {
					regexPattern = '^' + regexPattern;
				}
				if (!params.pattern.endsWith('*') && !params.pattern.endsWith('?')) {
					regexPattern = regexPattern + '$';
				}
				
				// Create case-insensitive regex
				regex = new RegExp(regexPattern, 'i');
			} else {
				// For non-wildcard patterns, do simple substring matching
				// Escape the pattern for use in regex
				const escapedPattern = params.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
				regex = new RegExp(escapedPattern, 'i');
			}
			
			const matchingFiles = allFiles
				.filter(file => {
					// Exclude system folders
					if (shouldExcludePath(file.path, plugin)) {
						return false;
					}
					// Test against both file name and full path
					return regex.test(file.name) || regex.test(file.path);
				})
				.slice(0, limit)
				.map(file => ({
					name: file.name,
					path: file.path,
					size: file.stat.size,
					modified: file.stat.mtime
				}));
			
			return {
				success: true,
				data: {
					pattern: params.pattern,
					matches: matchingFiles,
					count: matchingFiles.length,
					truncated: allFiles.filter(f => regex.test(f.name) || regex.test(f.path)).length > limit
				}
			};
			
		} catch (error) {
			return {
				success: false,
				error: `Error searching files: ${error instanceof Error ? error.message : 'Unknown error'}`
			};
		}
	}
}

/**
 * Get all available vault tools
 */
export function getVaultTools(): Tool[] {
	return [
		new ReadFileTool(),
		new WriteFileTool(),
		new ListFilesTool(),
		new CreateFolderTool(),
		new DeleteFileTool(),
		new MoveFileTool(),
		new SearchFilesTool()
	];
}