import type ObsidianGemini from '../main';
import { Tool, ToolResult, ToolExecutionContext } from './types';
import { ToolCategory } from '../types/agent';
import { ToolClassification } from '../types/tool-policy';

/**
 * Tool that lets the agent recall past sessions by file overlap, project, or title search.
 * Returns session summaries with progressive disclosure — the agent can then
 * use read_file on the session history path to get full conversation details.
 */
class RecallSessionsTool implements Tool {
	name = 'recall_sessions';
	displayName = 'Recall Past Sessions';
	category = ToolCategory.READ_ONLY;
	classification = ToolClassification.READ;
	description =
		'Search past agent sessions to find conversations related to specific files, projects, or topics. ' +
		'Returns session summaries including title, date, files accessed, and project linkage. ' +
		'Use this when the user asks about prior work, decisions, or discussions related to a file or topic. ' +
		'To see the full conversation from a past session, use read_file on the returned historyPath.';

	parameters = {
		type: 'object' as const,
		properties: {
			query: {
				type: 'string' as const,
				description: 'Search term to match against session titles (case-insensitive substring match)',
			},
			filePath: {
				type: 'string' as const,
				description: 'Find sessions that accessed this file path (e.g., "notes/meeting.md")',
			},
			project: {
				type: 'string' as const,
				description: 'Find sessions linked to this project (matches project name or file path)',
			},
			limit: {
				type: 'number' as const,
				description: 'Maximum number of results to return (default: 10)',
			},
		},
		required: [],
	};

	getProgressDescription(params: { query?: string; filePath?: string; project?: string }): string {
		if (params.query) return `Searching sessions for "${params.query}"`;
		if (params.filePath) return `Finding sessions that touched ${params.filePath}`;
		if (params.project) return `Finding sessions for project ${params.project}`;
		return 'Searching past sessions';
	}

	async execute(
		params: { query?: string; filePath?: string; project?: string; limit?: number },
		context: ToolExecutionContext
	): Promise<ToolResult> {
		const plugin = context.plugin as InstanceType<typeof ObsidianGemini>;
		const limit = Math.max(1, Math.min(50, Math.floor(params.limit || 10)));

		try {
			// Load recent sessions (fetch more than limit to allow filtering)
			const allSessions = await plugin.sessionManager.getRecentAgentSessions(50);

			// Exclude the current session from results
			const currentSessionId = context.session?.id;

			let filtered = allSessions.filter((s) => s.id !== currentSessionId);

			// Filter by file path
			if (params.filePath) {
				const searchPath = params.filePath.toLowerCase();
				filtered = filtered.filter((s) => {
					// Check accessed files if present
					if (s.accessedFiles) {
						for (const path of s.accessedFiles) {
							if (path.toLowerCase().includes(searchPath)) return true;
						}
					}
					// Also check context files
					for (const file of s.context?.contextFiles ?? []) {
						if (file.path.toLowerCase().includes(searchPath)) return true;
					}
					return false;
				});
			}

			// Filter by project
			if (params.project) {
				const searchProject = params.project.toLowerCase();
				const projectMatches = await Promise.all(
					filtered.map(async (s) => {
						if (!s.projectPath) return false;
						// Match against project path or project name
						if (s.projectPath.toLowerCase().includes(searchProject)) return true;
						// Try to resolve project name
						const project = await plugin.projectManager?.getProject(s.projectPath);
						if (project?.config.name.toLowerCase().includes(searchProject)) return true;
						return false;
					})
				);
				filtered = filtered.filter((_, i) => projectMatches[i]);
			}

			// Filter by title query
			if (params.query) {
				const searchQuery = params.query.toLowerCase();
				filtered = filtered.filter((s) => s.title.toLowerCase().includes(searchQuery));
			}

			// Apply limit
			const results = filtered.slice(0, limit);

			// Build summaries
			const sessions = results.map((s) => ({
				title: s.title,
				date: s.lastActive.toISOString(),
				historyPath: s.historyPath,
				project: s.projectPath || null,
				filesAccessed: s.accessedFiles ? Array.from(s.accessedFiles).slice(0, 20) : [],
				contextFiles: (s.context?.contextFiles ?? []).map((f) => f.path),
			}));

			return {
				success: true,
				data: {
					sessions,
					count: sessions.length,
					totalMatched: filtered.length,
					hint: 'Use read_file on historyPath to see the full conversation from a past session.',
				},
			};
		} catch (error) {
			return {
				success: false,
				error: `Failed to search sessions: ${error instanceof Error ? error.message : 'Unknown error'}`,
			};
		}
	}
}

export function getSessionRecallTools(): Tool[] {
	return [new RecallSessionsTool()];
}
