import { Tool, ToolResult, ToolExecutionContext } from '../types';
import { ToolCategory } from '../../types/agent';
import { ToolClassification } from '../../types/tool-policy';
import { TFile, normalizePath } from 'obsidian';
import type ObsidianGemini from '../../main';
import { shouldExcludePathForPlugin as shouldExcludePath, ensureFolderExists } from '../../utils/file-utils';

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
		const plugin = context.plugin as ObsidianGemini;

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
						// Sync the shelf (which is the source of truth for context files)
						if ('addContextFileToShelf' in agentView) {
							(agentView as any).addContextFileToShelf(file);
						}
						// Update UI if agent view is active
						if ('updateSessionHeader' in agentView) {
							(agentView as any).updateSessionHeader();
							(agentView as any).updateSessionMetadata();
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
