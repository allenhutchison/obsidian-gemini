import { Tool, ToolResult, ToolExecutionContext } from './types';
import { ToolCategory } from '../types/agent';
import { ToolClassification } from '../types/tool-policy';
import { TFile, TFolder, normalizePath, MarkdownView } from 'obsidian';
import type ObsidianGemini from '../main';
import { shouldExcludePathForPlugin as shouldExcludePath, ensureFolderExists } from '../utils/file-utils';
import {
	classifyFile,
	FileCategory,
	GEMINI_INLINE_DATA_LIMIT,
	arrayBufferToBase64,
	detectWebmMimeType,
} from '../utils/file-classification';

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
		const allFiles = plugin.app.vault.getFiles();
		if (allFiles && allFiles.length > 0) {
			const lowerPath = normalizedPath.toLowerCase();
			file =
				allFiles.find(
					(f) =>
						!shouldExcludePath(f.path, plugin) &&
						(f.path.toLowerCase() === lowerPath ||
							f.path.toLowerCase() === lowerPath + '.md' ||
							(lowerPath.endsWith('.md') && f.path.toLowerCase() === lowerPath.slice(0, -3)))
				) || null;
		}
	}

	// Only return TFile instances (filter out TFolder)
	// This is for file operations that specifically need files, not folders
	const tfile = file instanceof TFile ? file : null;

	// Generate suggestions if requested and file not found
	let suggestions: string[] | undefined;
	if (!tfile && includeSuggestions) {
		const allFiles = plugin.app.vault.getFiles();
		suggestions =
			allFiles && allFiles.length > 0
				? allFiles
						.filter(
							(f) =>
								!shouldExcludePath(f.path, plugin) &&
								f.name.toLowerCase().includes(path.toLowerCase().replace('.md', ''))
						)
						.slice(0, 5)
						.map((f) => f.path)
				: [];
	}

	return { file: tfile, suggestions };
}

/**
 * Helper function to resolve a path to either a file or folder
 * Similar to resolvePathToFile but returns both TFile and TFolder instances
 *
 * @param path - The path to resolve
 * @param plugin - The plugin instance
 * @param includeSuggestions - Whether to include suggestions if item not found
 * @returns Object with resolved file/folder (or null if not found), its type, and optional suggestions
 */
function resolvePathToFileOrFolder(
	path: string,
	plugin: InstanceType<typeof ObsidianGemini>,
	includeSuggestions: boolean = false
): { item: TFile | TFolder | null; type: 'file' | 'folder' | null; suggestions?: string[] } {
	const normalizedPath = normalizePath(path);

	// Strategy 1: Try direct path lookup
	let item = plugin.app.vault.getAbstractFileByPath(normalizedPath);

	// If it's a folder, return it directly
	if (item instanceof TFolder) {
		return { item, type: 'folder' };
	}

	// If it's a file, return it directly
	if (item instanceof TFile) {
		return { item, type: 'file' };
	}

	// Strategy 2: Try file resolution strategies (with suggestions if requested)
	const { file, suggestions } = resolvePathToFile(path, plugin, includeSuggestions);
	if (file) {
		return { item: file, type: 'file' };
	}

	return { item: null, type: null, suggestions };
}

/**
 * Read file content or list folder contents
 */
export class ReadFileTool implements Tool {
	name = 'read_file';
	displayName = 'Read File';
	category = ToolCategory.READ_ONLY;
	classification = ToolClassification.READ;
	description =
		'Read the contents of a file from the vault, or list the contents of a folder. Supports text files (markdown, code, .base, .canvas) and binary files that Gemini can process (images, audio, video, PDF). For text files, returns the file content along with metadata including the canonical wikilink, outgoing links, and backlinks. For binary files, the file data is sent directly to the model for analysis (e.g., image description, audio transcription, PDF reading). For folders, returns a list of all files and subfolders. The "wikilink" field contains the preferred way to reference this file (e.g., "[[Foo Foo]]" instead of "[[Dogs/Foo Foo]]"). All links are in [[WikiLink]] format and can be passed directly to any vault tool. Path can be a full path (e.g., "folder/note.md"), a simple filename (e.g., "note"), or a wikilink text (e.g., "My Note" from [[My Note]]). The .md extension is optional.';

	parameters = {
		type: 'object' as const,
		properties: {
			path: {
				type: 'string' as const,
				description:
					'Path to the file or folder relative to vault root (e.g., "folder/note.md", "folder/note", or "folder"). Extension is optional for files - will try both with and without .md',
			},
		},
		required: ['path'],
	};

	getProgressDescription(params: { path: string }): string {
		if (params.path) {
			return `Reading ${params.path}`;
		}
		return 'Reading file';
	}

	async execute(params: { path: string }, context: ToolExecutionContext): Promise<ToolResult> {
		const plugin = context.plugin as InstanceType<typeof ObsidianGemini>;

		try {
			const normalizedPath = normalizePath(params.path);

			// Check if path is excluded
			if (shouldExcludePath(normalizedPath, plugin)) {
				return {
					success: false,
					error: `Cannot read from system folder: ${params.path}`,
				};
			}

			// Try to resolve as either file or folder (with suggestions for errors)
			const { item, type: _type, suggestions } = resolvePathToFileOrFolder(params.path, plugin, true);

			if (!item) {
				// File not existing is information, not an error — the agent asked
				// "what's in this file?" and the answer is "it doesn't exist."
				const suggestionList = suggestions && suggestions.length > 0 ? suggestions : [];

				return {
					success: true,
					data: {
						path: params.path,
						exists: false,
						message: `File or folder does not exist: ${params.path}`,
						suggestions: suggestionList,
					},
				};
			}

			// Handle folder - list its contents
			if (item instanceof TFolder) {
				const files = item.children
					.filter((f) => !shouldExcludePath(f.path, plugin))
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
						path: item.path,
						type: 'folder',
						name: item.name,
						contents: files,
						count: files.length,
					},
				};
			}

			// Handle file - read its contents
			const file = item as TFile;

			// Classify the file to determine how to read it
			const classification = classifyFile(file.extension);

			if (classification.category === FileCategory.GEMINI_BINARY) {
				const buffer = await plugin.app.vault.readBinary(file);
				if (buffer.byteLength > GEMINI_INLINE_DATA_LIMIT) {
					return { success: false, error: `File too large for inline processing (max 20 MB): ${file.name}` };
				}
				const base64 = arrayBufferToBase64(buffer);
				let mimeType = classification.mimeType;
				if (file.extension.toLowerCase() === 'webm') {
					mimeType = detectWebmMimeType(buffer);
				}
				return {
					success: true,
					data: { path: file.path, type: 'binary_file', mimeType, size: buffer.byteLength },
					inlineData: [{ base64, mimeType }],
				};
			}

			if (classification.category === FileCategory.UNSUPPORTED) {
				return { success: false, error: `Unsupported file type: .${file.extension}` };
			}

			// Text file — read normally
			const content = await plugin.app.vault.read(file);

			// Get link information using singleton instance
			const scribeFile = plugin.gfile;

			// Get outgoing links (files this file links to)
			// Filter out links to system folders (plugin state, .obsidian, etc.)
			const outgoingLinksSet = scribeFile.getUniqueLinks(file);
			const outgoingLinks = Array.from(outgoingLinksSet)
				.filter((linkedFile) => !shouldExcludePath(linkedFile.path, plugin))
				.map((linkedFile) => scribeFile.getLinkText(linkedFile, file.path));

			// Get backlinks (files that link to this file)
			// Filter out backlinks from system folders
			const backlinksSet = scribeFile.getBacklinks(file);
			const backlinks = Array.from(backlinksSet)
				.filter((backlinkFile) => !shouldExcludePath(backlinkFile.path, plugin))
				.map((backlinkFile) => scribeFile.getLinkText(backlinkFile, file.path));

			// Get canonical wikilink for this file
			// Use empty source path to get the shortest/canonical form
			const canonicalWikilink = scribeFile.getLinkText(file, '');

			return {
				success: true,
				data: {
					path: file.path, // Return the actual path that was found
					type: 'file',
					wikilink: canonicalWikilink, // Canonical wikilink (e.g., "[[Foo Foo]]" instead of "[[Dogs/Foo Foo]]")
					content: content,
					size: file.stat.size,
					modified: file.stat.mtime,
					outgoingLinks: outgoingLinks.sort(), // Sort for consistent output
					backlinks: backlinks.sort(), // Sort for consistent output
				},
			};
		} catch (error) {
			return {
				success: false,
				error: `Error reading file or folder: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
	classification = ToolClassification.WRITE;
	description =
		"Write text content to a file in the vault. Creates a new file if it doesn't exist, or completely overwrites an existing file with new content. Returns the file path and whether it was created or modified. Newly created files are automatically added to the current session context. Use this to save AI-generated content, create new notes, or update existing files.";
	requiresConfirmation = true;

	parameters = {
		type: 'object' as const,
		properties: {
			path: {
				type: 'string' as const,
				description: 'Path to the file to write',
			},
			content: {
				type: 'string' as const,
				description: 'Content to write to the file',
			},
			summary: {
				type: 'string' as const,
				description: 'A brief human-readable summary of the changes being made',
			},
		},
		required: ['path', 'content'],
	};

	confirmationMessage = (params: { path: string; content: string; summary?: string }) => {
		if (params.summary) {
			return `Write to file: ${params.path}\n\n${params.summary}`;
		}
		return `Write content to file: ${params.path}\n\nContent preview:\n${params.content.substring(0, 200)}${params.content.length > 200 ? '...' : ''}`;
	};

	getProgressDescription(params: { path: string }): string {
		if (params.path) {
			return `Writing to ${params.path}`;
		}
		return 'Writing file';
	}

	async execute(
		params: { path: string; content: string; _userEdited?: boolean },
		context: ToolExecutionContext
	): Promise<ToolResult> {
		const plugin = context.plugin as InstanceType<typeof ObsidianGemini>;

		try {
			const normalizedPath = normalizePath(params.path);

			// Check if path is excluded
			if (shouldExcludePath(normalizedPath, plugin)) {
				return {
					success: false,
					error: `Cannot write to system folder: ${params.path}`,
				};
			}

			let file = plugin.app.vault.getAbstractFileByPath(normalizedPath);
			const isNewFile = !file;

			if (file instanceof TFile) {
				// File exists, modify it
				await plugin.app.vault.modify(file, params.content);
			} else {
				// File doesn't exist, create it
				// First ensure parent directory exists
				const lastSlashIndex = normalizedPath.lastIndexOf('/');
				if (lastSlashIndex > 0) {
					const parentDir = normalizedPath.substring(0, lastSlashIndex);
					const parentExists = await plugin.app.vault.adapter.exists(parentDir);
					if (!parentExists) {
						// Create parent directory (this will create all intermediate directories)
						plugin.logger.debug(`Creating parent directory: ${parentDir}`);
						await ensureFolderExists(plugin.app.vault, parentDir, 'parent directory', plugin.logger);
					}
				}

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
					action: isNewFile ? 'created' : 'modified',
					size: params.content.length,
					userEdited: params._userEdited ?? false,
					...(params._userEdited && {
						userChangeSummary: 'User modified the proposed content before writing',
					}),
				},
			};
		} catch (error) {
			return {
				success: false,
				error: `Error writing file: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
		const plugin = context.plugin as InstanceType<typeof ObsidianGemini>;

		try {
			// Default to project root when no path specified and project is active
			const folderPath = params.path || context.projectRootPath || '';
			const folder = plugin.app.vault.getAbstractFileByPath(folderPath);

			if (folderPath && !folder) {
				return {
					success: false,
					error: `Folder not found: ${params.path}`,
				};
			}

			if (folderPath && !(folder instanceof TFolder)) {
				return {
					success: false,
					error: `Path is not a folder: ${params.path}`,
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
		const plugin = context.plugin as InstanceType<typeof ObsidianGemini>;

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

/**
 * Search for files by name pattern
 */
export class SearchFilesTool implements Tool {
	name = 'search_files';
	displayName = 'Search Files';
	category = ToolCategory.READ_ONLY;
	classification = ToolClassification.READ;
	description =
		'Search for files in the vault by matching file names or paths against a pattern. Supports wildcards: * (matches any characters) and ? (matches single character). Searches are case-insensitive and match against both file names and full paths. Returns array of matching files with name, path, size, and modification time. Examples: "daily*" finds all files starting with "daily", "*meeting*" finds files containing "meeting" anywhere in name/path. Limited to 50 results by default. NOTE: This searches file NAMES/PATHS only, not file contents.';

	parameters = {
		type: 'object' as const,
		properties: {
			pattern: {
				type: 'string' as const,
				description: 'Search pattern (supports wildcards: * matches any characters, ? matches single character)',
			},
			limit: {
				type: 'number' as const,
				description: 'Maximum number of results to return',
			},
		},
		required: ['pattern'],
	};

	getProgressDescription(params: { pattern: string }): string {
		if (params.pattern) {
			return `Searching for "${params.pattern}"`;
		}
		return 'Searching files';
	}

	async execute(params: { pattern: string; limit?: number }, context: ToolExecutionContext): Promise<ToolResult> {
		const plugin = context.plugin as InstanceType<typeof ObsidianGemini>;

		try {
			const allFiles = plugin.app.vault.getFiles();
			const limit = params.limit || 50;

			// Check if pattern contains wildcards
			const hasWildcards = params.pattern.includes('*') || params.pattern.includes('?');

			let regex: RegExp;
			if (hasWildcards) {
				// Convert wildcard pattern to regex
				// Escape special regex characters except * and ?
				let regexPattern = params.pattern
					.replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special regex chars
					.replace(/\*/g, '.*') // * matches any characters
					.replace(/\?/g, '.'); // ? matches single character

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

			const projectRoot = context.projectRootPath;
			const scopedMatches = allFiles.filter((file) => {
				if (shouldExcludePath(file.path, plugin)) return false;
				if (projectRoot && !file.path.startsWith(projectRoot + '/')) return false;
				return regex.test(file.name) || regex.test(file.path);
			});

			const matchingFiles = scopedMatches.slice(0, limit).map((file) => ({
				name: file.name,
				path: file.path,
				size: file.stat.size,
				modified: file.stat.mtime,
			}));

			return {
				success: true,
				data: {
					pattern: params.pattern,
					matches: matchingFiles,
					count: matchingFiles.length,
					truncated: scopedMatches.length > limit,
				},
			};
		} catch (error) {
			return {
				success: false,
				error: `Error searching files: ${error instanceof Error ? error.message : 'Unknown error'}`,
			};
		}
	}
}

/**
 * Search for text content within files
 */
export class SearchFileContentsTool implements Tool {
	name = 'search_file_contents';
	displayName = 'Search File Contents';
	category = ToolCategory.READ_ONLY;
	classification = ToolClassification.READ;
	description =
		'Search for text content within markdown files in the vault. Unlike search_files which only searches filenames, this tool searches inside file contents using grep-style text matching. Supports case-sensitive/insensitive search and regex patterns. Returns matching lines with context (lines before/after the match). Use this to find notes containing specific text, code snippets, or patterns. Examples: find all notes mentioning "meeting notes", search for TODO items, find files containing specific tags or phrases. Results include file path, line numbers, matching content, and surrounding context lines.';

	parameters = {
		type: 'object' as const,
		properties: {
			query: {
				type: 'string' as const,
				description: 'Text or regex pattern to search for within file contents',
			},
			caseSensitive: {
				type: 'boolean' as const,
				description: 'Whether search should be case-sensitive (default: false)',
			},
			useRegex: {
				type: 'boolean' as const,
				description:
					'Whether to treat query as a regular expression (default: false). When false, searches for literal text.',
			},
			limit: {
				type: 'number' as const,
				description: 'Maximum number of files with matches to return (default: 50)',
			},
			contextLines: {
				type: 'number' as const,
				description: 'Number of lines before and after each match to include for context (default: 2, max: 5)',
			},
		},
		required: ['query'],
	};

	async execute(
		params: {
			query: string;
			caseSensitive?: boolean;
			useRegex?: boolean;
			limit?: number;
			contextLines?: number;
		},
		context: ToolExecutionContext
	): Promise<ToolResult> {
		const plugin = context.plugin as InstanceType<typeof ObsidianGemini>;

		try {
			const caseSensitive = params.caseSensitive ?? false;
			const useRegex = params.useRegex ?? false;
			const limit = params.limit ?? 50;
			const contextLines = Math.min(params.contextLines ?? 2, 5); // Cap at 5 lines

			// Validate query
			if (!params.query || params.query.trim().length === 0) {
				return {
					success: false,
					error: 'Query cannot be empty',
				};
			}

			// Create search pattern
			let searchRegex: RegExp;
			try {
				if (useRegex) {
					// User provided regex pattern
					searchRegex = new RegExp(params.query, caseSensitive ? 'g' : 'gi');
				} else {
					// Escape special regex characters for literal search
					const escapedQuery = params.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
					searchRegex = new RegExp(escapedQuery, caseSensitive ? 'g' : 'gi');
				}
			} catch (error) {
				return {
					success: false,
					error: `Invalid regex pattern: ${error instanceof Error ? error.message : 'Unknown error'}`,
				};
			}

			const allFiles = plugin.app.vault.getMarkdownFiles();
			const results: Array<{
				file: string;
				path: string;
				matches: Array<{
					lineNumber: number;
					lineContent: string;
					contextBefore: string[];
					contextAfter: string[];
				}>;
			}> = [];

			let totalMatches = 0;

			const projectRoot = context.projectRootPath;

			// Search through each file
			for (const file of allFiles) {
				// Skip system folders
				if (shouldExcludePath(file.path, plugin)) {
					continue;
				}
				// Scope to project root when active
				if (projectRoot && !file.path.startsWith(projectRoot + '/')) {
					continue;
				}

				// Check if we've hit the limit
				if (results.length >= limit) {
					break;
				}

				try {
					const content = await plugin.app.vault.cachedRead(file);
					const lines = content.split('\n');
					const fileMatches: Array<{
						lineNumber: number;
						lineContent: string;
						contextBefore: string[];
						contextAfter: string[];
					}> = [];

					// Search each line
					for (let i = 0; i < lines.length; i++) {
						const line = lines[i];

						// Reset regex lastIndex for global regex
						searchRegex.lastIndex = 0;

						if (searchRegex.test(line)) {
							// Get context lines using Array.slice()
							const startBefore = Math.max(0, i - contextLines);
							const contextBefore = lines.slice(startBefore, i);
							const contextAfter = lines.slice(i + 1, i + 1 + contextLines);

							fileMatches.push({
								lineNumber: i + 1, // 1-indexed for user display
								lineContent: line,
								contextBefore,
								contextAfter,
							});

							totalMatches++;

							// Limit matches per file to avoid overwhelming results
							if (fileMatches.length >= 10) {
								break;
							}
						}
					}

					// Add file to results if it has matches
					if (fileMatches.length > 0) {
						results.push({
							file: file.name,
							path: file.path,
							matches: fileMatches,
						});
					}
				} catch (error) {
					// Skip files that can't be read
					plugin.logger.debug(`Error reading file ${file.path}:`, error);
					continue;
				}
			}

			return {
				success: true,
				data: {
					query: params.query,
					caseSensitive,
					useRegex,
					filesSearched: allFiles.length,
					filesWithMatches: results.length,
					totalMatches,
					results,
					truncated: results.length >= limit,
				},
			};
		} catch (error) {
			return {
				success: false,
				error: `Error searching file contents: ${error instanceof Error ? error.message : 'Unknown error'}`,
			};
		}
	}
}

/** Maximum characters of selected text to include in workspace state */
const MAX_SELECTION_LENGTH = 1000;

/**
 * Get the current workspace state: all open files, visibility, selections, and project info.
 * Replaces get_active_file with a richer view of the user's workspace.
 */
export class GetWorkspaceStateTool implements Tool {
	name = 'get_workspace_state';
	displayName = 'Get Workspace State';
	category = ToolCategory.READ_ONLY;
	classification = ToolClassification.READ;
	description =
		'Get metadata about all files currently open in the user\'s workspace. Returns each file\'s path, wikilink, whether it is visible in a pane, whether it is the active (focused) file, and any text the user has selected. Also includes the current project if the session is linked to one. Use this when the user refers to "this file", "the current file", "what I\'m looking at", or when you need to understand what the user is working on. Use read_file to get the actual content of specific files.';

	parameters = {
		type: 'object' as const,
		properties: {},
		required: [],
	};

	getProgressDescription(_params: any): string {
		return 'Getting workspace state';
	}

	async execute(_params: any, context: ToolExecutionContext): Promise<ToolResult> {
		const plugin = context.plugin as InstanceType<typeof ObsidianGemini>;

		try {
			const activeFile = plugin.app.workspace.getActiveFile();

			// Collect all open markdown leaves, de-duplicating by path
			const fileMap = new Map<
				string,
				{ path: string; wikilink: string; visible: boolean; active: boolean; selection: string | null }
			>();

			plugin.app.workspace.iterateAllLeaves((leaf) => {
				const view = leaf.view;
				if (!(view instanceof MarkdownView) || !view.file) return;

				const file = view.file;
				const path = file.path;

				// Skip system/excluded files
				if (shouldExcludePath(path, plugin)) return;

				const isVisible = (leaf as any).containerEl?.isShown?.() ?? false;
				const isActive = activeFile !== null && file.path === activeFile.path;

				let selection: string | null = null;
				try {
					const sel = view.editor.getSelection();
					if (sel) {
						selection = sel.length > MAX_SELECTION_LENGTH ? sel.slice(0, MAX_SELECTION_LENGTH) + '...' : sel;
					}
				} catch {
					// Editor may not be available
				}

				const existing = fileMap.get(path);
				if (existing) {
					// Merge: visible/active if ANY leaf qualifies, keep first non-empty selection
					existing.visible = existing.visible || isVisible;
					existing.active = existing.active || isActive;
					if (!existing.selection && selection) {
						existing.selection = selection;
					}
				} else {
					const linkText = plugin.app.metadataCache.fileToLinktext(file, '');
					fileMap.set(path, {
						path,
						wikilink: `[[${linkText}]]`,
						visible: isVisible,
						active: isActive,
						selection,
					});
				}
			});

			const openFiles = Array.from(fileMap.values());

			// Include project info if session is linked to one
			let project: { name: string; rootPath: string } | null = null;
			if (context.session?.projectPath && plugin.projectManager) {
				const proj = await plugin.projectManager.getProject(context.session.projectPath);
				if (proj) {
					project = { name: proj.config.name, rootPath: proj.rootPath };
				}
			}

			return {
				success: true,
				data: { openFiles, project },
			};
		} catch (error) {
			return {
				success: false,
				error: `Error getting workspace state: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
		new SearchFilesTool(),
		new SearchFileContentsTool(),
		new GetWorkspaceStateTool(),
	];
}
