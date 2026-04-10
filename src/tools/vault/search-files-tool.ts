import { Tool, ToolResult, ToolExecutionContext } from '../types';
import { ToolCategory } from '../../types/agent';
import { ToolClassification } from '../../types/tool-policy';
import type ObsidianGemini from '../../main';
import { shouldExcludePathForPlugin as shouldExcludePath } from '../../utils/file-utils';

/**
 * Search for files by name pattern
 */
export class SearchFilesTool implements Tool {
	name = 'find_files_by_name';
	displayName = 'Find Files by Name';
	category = ToolCategory.READ_ONLY;
	classification = ToolClassification.READ;
	description =
		'Search for files by matching file names or paths against a pattern. Supports wildcards: * (any characters) and ? (single character). Case-insensitive. Returns matching files with name, path, size, and modification time. Examples: "daily*" finds files starting with "daily", "*meeting*" finds files containing "meeting". Limited to 50 results. Searches names/paths only — use find_files_by_content to search inside files.';

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
		const plugin = context.plugin as ObsidianGemini;

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
