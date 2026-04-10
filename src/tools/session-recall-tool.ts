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
		const plugin = context.plugin as ObsidianGemini;
		const limit = Math.max(1, Math.min(50, Math.floor(params.limit || 10)));

		try {
			// Use lightweight metadata query to avoid full session hydration (#505)
			const allSessions = await plugin.sessionManager.getSessionMetadata(50);

			// Exclude the current session from results
			const currentSessionId = context.session?.id;

			let filtered = allSessions.filter((s) => s.id !== currentSessionId);

			// Filter by file path (matches against raw ref strings).
			// Refs are basenames stripped of [[]], not full vault paths, so we use
			// bidirectional substring matching: a full-path query like
			// "notes/meeting.md" still matches a basename ref like "meeting"
			// because the path contains the basename.
			if (params.filePath) {
				const searchPath = params.filePath.toLowerCase();
				filtered = filtered.filter((s) => {
					for (const ref of s.accessedFileRefs) {
						const lRef = ref.toLowerCase();
						if (lRef.includes(searchPath) || searchPath.includes(lRef)) return true;
					}
					for (const ref of s.contextFileRefs) {
						const lRef = ref.toLowerCase();
						if (lRef.includes(searchPath) || searchPath.includes(lRef)) return true;
					}
					return false;
				});
			}

			// Filter by project
			if (params.project) {
				const searchProject = params.project.toLowerCase();
				// Use allSettled so that a single malformed/unreadable project file
				// doesn't nuke the entire recall result set.
				const projectMatches = await Promise.allSettled(
					filtered.map(async (s) => {
						if (!s.projectRef) return false;
						// Match against raw project reference
						if (s.projectRef.toLowerCase().includes(searchProject)) return true;
						// Try to resolve project name
						const project = await plugin.projectManager?.getProject(s.projectRef);
						if (project?.config.name.toLowerCase().includes(searchProject)) return true;
						return false;
					})
				);
				filtered = filtered.filter((_, i) => {
					const outcome = projectMatches[i];
					if (outcome.status === 'rejected') {
						plugin.logger.warn('recall_sessions: project lookup failed, treating as no match:', outcome.reason);
						return false;
					}
					return outcome.value;
				});
			}

			// Filter by title query
			if (params.query) {
				const searchQuery = params.query.toLowerCase();
				filtered = filtered.filter((s) => s.title.toLowerCase().includes(searchQuery));
			}

			// Explicitly sort by lastActive descending so the agent always sees the
			// most recent matches first, regardless of how getSessionMetadata
			// happened to order things.
			filtered.sort((a, b) => b.lastActive.getTime() - a.lastActive.getTime());

			// Apply limit
			const results = filtered.slice(0, limit);

			// Build summaries
			const sessions = results.map((s) => ({
				title: s.title,
				date: s.lastActive.toISOString(),
				historyPath: s.historyPath,
				project: s.projectRef || null,
				filesAccessed: s.accessedFileRefs.slice(0, 20),
				contextFiles: s.contextFileRefs,
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
