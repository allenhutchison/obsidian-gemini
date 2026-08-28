import { Tool, ToolResult, ToolExecutionContext, ToolParams, DiffContext, ConfirmationResult } from '../types';
import { ToolCategory } from '../../types/agent';
import { ToolClassification } from '../../types/tool-policy';
import { resolvePathToFile, safeReadFileForDiff } from './utils';
import { t } from '../../i18n';
import { getRawErrorMessageOr } from '../../utils/error-utils';

/**
 * Tool to append content to the end of a file
 * Useful for logging, journaling, or adding items to lists without rewriting the whole file
 */
export class AppendContentTool implements Tool {
	name = 'append_content';
	displayName = 'Append Content';
	category = ToolCategory.VAULT_OPERATIONS;
	classification = ToolClassification.WRITE;
	requiresConfirmation = true;
	description =
		'Append text to the end of a file. ' +
		'Useful for adding log entries, diary updates, or new sections without rewriting the entire file. ' +
		'If the file does not exist, an error is returned (use write_file to create new files). ' +
		'Path can be a full path (e.g., "folder/note.md"), a simple filename, or a wikilink text. The .md extension is optional.';

	parameters = {
		type: 'object' as const,
		properties: {
			path: {
				type: 'string' as const,
				description:
					'Path to the file relative to vault root (e.g., "folder/note.md", "folder/note", or "note"). Extension is optional.',
			},
			content: {
				type: 'string' as const,
				description: 'The text content to append (automatically adds newline if needed)',
			},
		},
		required: ['path', 'content'],
	};

	confirmationMessage = (params: { path: string; content: string }) => {
		const preview = `${params.content.substring(0, 200)}${params.content.length > 200 ? '...' : ''}`;
		return t('tool.confirm.appendFile', { path: params.path, preview });
	};

	getProgressDescription(params: { path: string }): string {
		if (params.path) {
			return `Appending to ${params.path}`;
		}
		return 'Appending content';
	}

	/**
	 * Diff preview: original = current file content, proposed = original with the
	 * appended text (mirroring execute()'s newline-insertion so the preview matches
	 * what is written). Resolves the path with the same resolver as execute().
	 */
	async buildDiffContext(params: ToolParams, context: ToolExecutionContext): Promise<DiffContext | undefined> {
		const plugin = context.plugin;
		const path = typeof params.path === 'string' ? params.path : undefined;
		const content = typeof params.content === 'string' ? params.content : undefined;
		if (!path || content === undefined) return undefined;

		const { file } = resolvePathToFile(path, plugin);
		if (!file) return undefined; // Tool surfaces its own not-found error at execution time

		const originalContent = await safeReadFileForDiff(plugin, file);
		let contentToAppend = content;
		if (originalContent.length > 0 && !originalContent.endsWith('\n') && !contentToAppend.startsWith('\n')) {
			contentToAppend = '\n' + contentToAppend;
		}
		return {
			filePath: file.path,
			originalContent,
			proposedContent: originalContent + contentToAppend,
			isNewFile: false,
		};
	}

	/**
	 * The append diff shows the full file, so a user edit means "replace the whole
	 * file with this", not "append this suffix" — flip to overwrite mode. An
	 * unedited approval leaves params untouched so the original suffix appends.
	 */
	applyConfirmedEdit(params: ToolParams, result: ConfirmationResult): void {
		if (result.userEdited) {
			params.content = result.finalContent;
			params._userEdited = true;
			params._replaceFullContent = true;
		}
	}

	async execute(
		params: { path: string; content: string; _replaceFullContent?: boolean; _userEdited?: boolean },
		context: ToolExecutionContext
	): Promise<ToolResult> {
		const plugin = context.plugin;
		const { path, content } = params;

		try {
			const { file } = resolvePathToFile(path, plugin);
			if (!file) {
				return {
					success: false,
					error: `File not found: ${path}`,
				};
			}

			// When the user edits the append in the diff view, `content` contains the
			// full edited file rather than a suffix to append. The execution engine
			// sets _replaceFullContent in that case so we overwrite instead of append.
			if (params._replaceFullContent) {
				await plugin.app.vault.modify(file, content);
				plugin.logger.debug(`Replaced ${content.length} chars in ${file.path} (user-edited append)`);
				return {
					success: true,
					data: {
						path: file.path,
						action: 'replaced',
						size: content.length,
						userEdited: params._userEdited ?? false,
					},
				};
			}

			// Ensure content starts with newline if file is not empty
			let contentToAppend = content;
			const fileContent = await plugin.app.vault.read(file);
			if (fileContent.length > 0 && !fileContent.endsWith('\n') && !content.startsWith('\n')) {
				contentToAppend = '\n' + content;
			}

			await plugin.app.vault.append(file, contentToAppend);

			plugin.logger.debug(`Appended ${contentToAppend.length} chars to ${file.path}`);

			return {
				success: true,
				data: {
					path: file.path,
					action: 'appended',
					size: contentToAppend.length,
				},
			};
		} catch (error) {
			const msg = getRawErrorMessageOr(error, 'Unknown error');
			plugin.logger.error(`Failed to append content to ${path}: ${msg}`);
			return {
				success: false,
				error: `Failed to append content: ${msg}`,
			};
		}
	}
}
