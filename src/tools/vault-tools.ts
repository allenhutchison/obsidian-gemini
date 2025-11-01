import { Tool, ToolResult, ToolExecutionContext } from './types';
import { ToolCategory } from '../types/agent';
import { TFile, TFolder, normalizePath } from 'obsidian';
import type ObsidianGemini from '../main';
import { ScribeFile } from '../files';
import { ScribeDataView } from '../files/dataview-utils';
import { shouldExcludePathForPlugin as shouldExcludePath } from '../utils/file-utils';

/**
 * Helper function to resolve a path to a file with multiple fallback strategies
 * Handles paths, extensions, wikilinks, and case-insensitive searches
 *
 * @param path - The path to resolve (can be full path, filename, or wikilink)
 * @param plugin - The plugin instance
 * @param includeSuggestions - Whether to include suggestions if file not found
 * @returns Object with resolved file and optional suggestions
 */
function resolvePathToFile(
	path: string,
	plugin: InstanceType<typeof ObsidianGemini>,
	includeSuggestions: boolean = false
): { file: TFile | null; suggestions?: string[] } {
	const normalizedPath = normalizePath(path);

	// Strategy 1: Try direct path lookup
	let file = plugin.app.vault.getAbstractFileByPath(normalizedPath);

	// Strategy 2: If not found and doesn't end with .md, try adding it
	if (!file && !normalizedPath.endsWith('.md')) {
		file = plugin.app.vault.getAbstractFileByPath(normalizedPath + '.md');
	}

	// Strategy 3: If still not found and ends with .md, try without it
	if (!file && normalizedPath.endsWith('.md')) {
		const pathWithoutExt = normalizedPath.slice(0, -3);
		file = plugin.app.vault.getAbstractFileByPath(pathWithoutExt);
	}

	// Strategy 4: If still not found, try resolving as a wikilink
	// This handles cases like "Foo Foo" which might be in "Dogs/Foo Foo.md"
	if (!file) {
		// Strip [[ and ]] if present
		let linkPath = path.replace(/^\[\[/, '').replace(/\]\]$/, '');
		// Remove .md extension if present for link resolution
		linkPath = linkPath.replace(/\.md$/, '');

		// Use Obsidian's link resolution API
		// Pass empty string as source path since we don't have context
		const resolvedFile = plugin.app.metadataCache.getFirstLinkpathDest(linkPath, '');
		if (resolvedFile) {
			file = resolvedFile;
		}
	}

	// Strategy 5: If still not found, try case-insensitive search (only for TFiles)
	if (!file) {
		const allFiles = plugin.app.vault.getMarkdownFiles();
		if (allFiles && allFiles.length > 0) {
			const lowerPath = normalizedPath.toLowerCase();
			file = allFiles.find(f =>
				f.path.toLowerCase() === lowerPath ||
				f.path.toLowerCase() === lowerPath + '.md' ||
				(lowerPath.endsWith('.md') && f.path.toLowerCase() === lowerPath.slice(0, -3))
			) || null;
		}
	}

	// Only return TFile instances (filter out TFolder)
	// This is for file operations that specifically need files, not folders
	const tfile = (file instanceof TFile) ? file : null;

	// Generate suggestions if requested and file not found
	let suggestions: string[] | undefined;
	if (!tfile && includeSuggestions) {
		const allFiles = plugin.app.vault.getMarkdownFiles();
		suggestions = (allFiles && allFiles.length > 0)
			? allFiles
				.filter(f => f.name.toLowerCase().includes(path.toLowerCase().replace('.md', '')))
				.slice(0, 5)
				.map(f => f.path)
			: [];
	}

	return { file: tfile, suggestions };
}

/**
 * Read file content
 */
export class ReadFileTool implements Tool {
	name = 'read_file';
	displayName = 'Read File';
	category = ToolCategory.READ_ONLY;
	description = 'Read the full text contents of a markdown file from the vault. Returns the file content along with metadata including the canonical wikilink for the file, outgoing links (files this note links to), and backlinks (files that link to this note). The "wikilink" field contains the preferred way to reference this file (e.g., "[[Foo Foo]]" instead of "[[Dogs/Foo Foo]]"). All links are in [[WikiLink]] format and can be passed directly to any vault tool - they will automatically resolve to the correct file path, even if the file is in a subfolder. Use this to traverse note relationships, follow connections between notes, or explore related content. Path can be a full path (e.g., "folder/note.md"), a simple filename (e.g., "note"), or a wikilink text (e.g., "My Note" from [[My Note]]). The .md extension is optional.';

	parameters = {
		type: 'object' as const,
		properties: {
			path: {
				type: 'string' as const,
				description: 'Path to the file relative to vault root (e.g., "folder/note.md" or "folder/note"). Extension is optional - will try both with and without .md'
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

			// Check if path is a folder before trying to resolve as file
			const abstractFile = plugin.app.vault.getAbstractFileByPath(normalizedPath);
			if (abstractFile && !(abstractFile instanceof TFile)) {
				return {
					success: false,
					error: `Path is not a file: ${params.path}`
				};
			}

			// Use shared file resolution helper with suggestions
			const { file, suggestions } = resolvePathToFile(params.path, plugin, true);

			if (!file) {
				// Provide helpful error message with suggestions
				const suggestion = suggestions && suggestions.length > 0
					? `\n\nDid you mean one of these?\n${suggestions.join('\n')}`
					: '';

				return {
					success: false,
					error: `File not found: ${params.path}${suggestion}`
				};
			}

			const content = await plugin.app.vault.read(file);

			// Get link information using singleton instances
			const scribeFile = plugin.gfile;
			const scribeDataView = new ScribeDataView(scribeFile, plugin);

			// Get outgoing links (files this file links to)
			// Filter out links to system folders (plugin state, .obsidian, etc.)
			const outgoingLinksSet = scribeFile.getUniqueLinks(file);
			const outgoingLinks = Array.from(outgoingLinksSet)
				.filter(linkedFile => !shouldExcludePath(linkedFile.path, plugin))
				.map(linkedFile => scribeFile.getLinkText(linkedFile, file.path));

			// Get backlinks (files that link to this file)
			// Filter out backlinks from system folders
			const backlinksSet = await scribeDataView.getBacklinks(file);
			const backlinks = Array.from(backlinksSet)
				.filter(backlinkFile => !shouldExcludePath(backlinkFile.path, plugin))
				.map(backlinkFile => scribeFile.getLinkText(backlinkFile, file.path));

			// Get canonical wikilink for this file
			// Use empty source path to get the shortest/canonical form
			const canonicalWikilink = scribeFile.getLinkText(file, '');

			return {
				success: true,
				data: {
					path: file.path,  // Return the actual path that was found
					wikilink: canonicalWikilink,  // Canonical wikilink (e.g., "[[Foo Foo]]" instead of "[[Dogs/Foo Foo]]")
					content: content,
					size: file.stat.size,
					modified: file.stat.mtime,
					outgoingLinks: outgoingLinks.sort(),  // Sort for consistent output
					backlinks: backlinks.sort()           // Sort for consistent output
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
	displayName = 'Write File';
	category = ToolCategory.VAULT_OPERATIONS;
	description = 'Write text content to a file in the vault. Creates a new file if it doesn\'t exist, or completely overwrites an existing file with new content. Returns the file path and whether it was created or modified. Newly created files are automatically added to the current session context. Use this to save AI-generated content, create new notes, or update existing files.';
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
	displayName = 'List Files';
	category = ToolCategory.READ_ONLY;
	description = 'List all files and folders in a directory. Returns an array of objects with name, path, type (file/folder), size, and modification time for each item. Can list recursively through all subdirectories or just immediate children. Use empty string for path to list the vault root. Useful for exploring folder structure or finding all files in a specific location.';
	
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
	displayName = 'Create Folder';
	category = ToolCategory.VAULT_OPERATIONS;
	description = 'Create a new folder in the vault at the specified path. Parent folders will be created automatically if they don\'t exist. Returns the normalized folder path on success. Use this to organize notes into new directory structures or prepare locations for new files.';
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
	displayName = 'Delete File';
	category = ToolCategory.VAULT_OPERATIONS;
	description = 'Permanently delete a file or folder from the vault. WARNING: This action cannot be undone! When deleting a folder, all contents are removed recursively. Returns the path and type (file/folder) that was deleted. Path can be a full path, filename, or wikilink (e.g., "[[My Note]]") - wikilinks will be automatically resolved. Always confirm with the user before executing this destructive operation.';
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

			// Use shared file resolution helper
			const { file } = resolvePathToFile(params.path, plugin);

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
	displayName = 'Move/Rename File';
	category = ToolCategory.VAULT_OPERATIONS;
	description = 'Move a file to a different location or rename it. Provide both source and target paths (including filenames). Source path can be a full path, filename, or wikilink (e.g., "[[My Note]]") - wikilinks will be automatically resolved. Target directory will be created if it doesn\'t exist. Returns both paths and action status. Examples: rename "Note.md" to "New Name.md" in same folder, or move "Folder A/Note.md" to "Folder B/Subfolder/Note.md". Preserves all file metadata and updates internal links automatically.';
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

			// Check if source path is a folder before trying to resolve as file
			const abstractFile = plugin.app.vault.getAbstractFileByPath(sourceNormalizedPath);
			if (abstractFile && !(abstractFile instanceof TFile)) {
				return {
					success: false,
					error: `Source path is not a file: ${params.sourcePath}`
				};
			}

			// Use shared file resolution helper
			const { file: sourceFile } = resolvePathToFile(params.sourcePath, plugin);

			if (!sourceFile) {
				return {
					success: false,
					error: `Source file not found: ${params.sourcePath}`
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
	displayName = 'Search Files';
	category = ToolCategory.READ_ONLY;
	description = 'Search for files in the vault by matching file names or paths against a pattern. Supports wildcards: * (matches any characters) and ? (matches single character). Searches are case-insensitive and match against both file names and full paths. Returns array of matching files with name, path, size, and modification time. Examples: "daily*" finds all files starting with "daily", "*meeting*" finds files containing "meeting" anywhere in name/path. Limited to 50 results by default. NOTE: This searches file NAMES/PATHS only, not file contents.';
	
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