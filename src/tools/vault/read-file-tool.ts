import { Tool, ToolResult, ToolExecutionContext } from '../types';
import { ToolCategory } from '../../types/agent';
import { ToolClassification } from '../../types/tool-policy';
import { TFile, TFolder, normalizePath } from 'obsidian';
import type ObsidianGemini from '../../main';
import { shouldExcludePathForPlugin as shouldExcludePath } from '../../utils/file-utils';
import {
	classifyFile,
	FileCategory,
	GEMINI_INLINE_DATA_LIMIT,
	arrayBufferToBase64,
	detectWebmMimeType,
} from '../../utils/file-classification';
import { resolvePathToFileOrFolder } from './utils';

/**
 * Read file content or list folder contents
 */
export class ReadFileTool implements Tool {
	name = 'read_file';
	displayName = 'Read File';
	category = ToolCategory.READ_ONLY;
	classification = ToolClassification.READ;
	description =
		"Read a file or list a folder's contents. Supports text files (markdown, code, .base, .canvas) and binary files (images, audio, video, PDF). Returns file content with metadata (wikilink, outgoing links, backlinks). For folders, returns a list of children. Path can be a full path, filename, or wikilink text. The .md extension is optional.";

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
		const plugin = context.plugin as ObsidianGemini;

		try {
			const normalizedPath = normalizePath(params.path);

			// Allow reading agent session history files (needed by recall_sessions tool)
			const agentSessionsFolder = normalizePath(`${plugin.settings.historyFolder}/Agent-Sessions`);
			const isAgentSessionPath =
				normalizedPath === agentSessionsFolder || normalizedPath.startsWith(agentSessionsFolder + '/');
			const isObsidianPath = normalizedPath === '.obsidian' || normalizedPath.startsWith('.obsidian/');

			// Check if path is excluded (allow agent session files, but never .obsidian)
			if ((isObsidianPath || !isAgentSessionPath) && shouldExcludePath(normalizedPath, plugin)) {
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
