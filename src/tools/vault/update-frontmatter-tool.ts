import { Tool, ToolResult, ToolExecutionContext } from '../types';
import { ToolCategory } from '../../types/agent';
import { ToolClassification } from '../../types/tool-policy';
import { resolvePathToFile } from './utils';
import { t } from '../../i18n';
import { getRawErrorMessageOr } from '../../utils/error-utils';

/**
 * Tool to safely update YAML frontmatter without touching content
 * Critical for integration with Obsidian Bases and other metadata-driven plugins
 */
export class UpdateFrontmatterTool implements Tool {
	name = 'update_frontmatter';
	displayName = 'Update Frontmatter';
	category = ToolCategory.VAULT_OPERATIONS;
	classification = ToolClassification.WRITE;
	requiresConfirmation = true;
	description =
		'Update a specific YAML frontmatter property in a file. ' +
		'This tool is safe to use as it only modifies metadata and preserves the note content. ' +
		'Use it to update status, tags, dates, or any other property. ' +
		'Path can be a full path (e.g., "folder/note.md"), a simple filename, or a wikilink text. The .md extension is optional. ' +
		'ALWAYS prefer this tool over write_file for property changes.';

	parameters = {
		type: 'object' as const,
		properties: {
			path: {
				type: 'string' as const,
				description:
					'Path to the file relative to vault root (e.g., "folder/note.md", "folder/note", or "note"). Extension is optional.',
			},
			key: {
				type: 'string' as const,
				description: 'The property key to update',
			},
			value: {
				type: 'string' as const,
				description:
					'The value for the property. Obsidian property types and formats: ' +
					'Text: plain string. Internal links MUST be quoted: "[[Note Name]]". ' +
					'Number: literal integer or decimal (e.g., 42, 3.14). ' +
					'Checkbox: true or false. ' +
					'Date: YYYY-MM-DD (e.g., 2024-08-21). ' +
					'Date & time: YYYY-MM-DDTHH:mm:ss (e.g., 2024-08-21T10:30:00). ' +
					'List: array of values (e.g., ["item1", "item2"]). Internal links in lists must be quoted: ["[[Link1]]", "[[Link2]]"]. ' +
					'Tags: always use a list for the "tags" property (e.g., ["journal", "personal"]). ' +
					'Use canonical property names: "tags" (not "tag"), "aliases" (not "alias"), "cssclasses" (not "cssclass").',
			},
		},
		required: ['path', 'key', 'value'],
	};

	confirmationMessage = (params: { path: string; key: string; value: unknown }) => {
		return t('tool.confirm.updateFrontmatter', { path: params.path, key: params.key, value: String(params.value) });
	};

	getProgressDescription(params: { path: string; key: string }): string {
		if (params.path) {
			return `Updating frontmatter in ${params.path}`;
		}
		return 'Updating frontmatter';
	}

	async execute(
		params: { path: string; key: string; value: unknown },
		context: ToolExecutionContext
	): Promise<ToolResult> {
		const plugin = context.plugin;
		const { path, key, value } = params;

		try {
			const { file } = resolvePathToFile(path, plugin);
			if (!file || file.extension !== 'md') {
				return {
					success: false,
					error: `File not found or is not a markdown file: ${path}`,
				};
			}

			// Parse stringified JSON values so arrays, numbers, and booleans
			// become native YAML types instead of quoted strings
			let parsedValue = value;
			if (typeof value === 'string') {
				try {
					parsedValue = JSON.parse(value);
				} catch {
					// Not valid JSON — keep as plain string
				}
			}

			// Use Obsidian's native API for safe frontmatter updates
			await plugin.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
				frontmatter[key] = parsedValue;
			});

			plugin.logger.debug(`Updated frontmatter for ${file.path}: ${key} = ${JSON.stringify(parsedValue)}`);

			return {
				success: true,
				data: {
					path: file.path,
					key,
					value: parsedValue,
					action: 'updated',
				},
			};
		} catch (error) {
			const msg = getRawErrorMessageOr(error, 'Unknown error');
			plugin.logger.error(`Failed to update frontmatter for ${path}: ${msg}`);
			return {
				success: false,
				error: `Failed to update frontmatter: ${msg}`,
			};
		}
	}
}
