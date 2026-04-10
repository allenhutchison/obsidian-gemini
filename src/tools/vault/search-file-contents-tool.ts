import { Tool, ToolResult, ToolExecutionContext } from '../types';
import { ToolCategory } from '../../types/agent';
import { ToolClassification } from '../../types/tool-policy';
import type ObsidianGemini from '../../main';
import { shouldExcludePathForPlugin as shouldExcludePath } from '../../utils/file-utils';

/**
 * Search for text content within files
 */
export class SearchFileContentsTool implements Tool {
	name = 'find_files_by_content';
	displayName = 'Find Files by Content';
	category = ToolCategory.READ_ONLY;
	classification = ToolClassification.READ;
	description =
		'Search inside markdown file contents for text or regex patterns. Returns matching lines with surrounding context. Supports case-sensitive/insensitive search and regex. Use this to find notes containing specific text, code snippets, TODO items, tags, or phrases. Results include file path, line numbers, and matching content with context lines.';

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

	getProgressDescription(params: { query: string }): string {
		const query = params.query.length > 50 ? params.query.substring(0, 47) + '...' : params.query;
		return `Searching file contents for "${query}"`;
	}

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
		const plugin = context.plugin as ObsidianGemini;

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
