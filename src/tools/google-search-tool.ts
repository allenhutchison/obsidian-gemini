import { Tool, ToolResult, ToolExecutionContext } from './types';
import { ToolCategory } from '../types/agent';
import { ToolClassification } from '../types/tool-policy';
import { runGroundingTool } from './grounding-tool-runner';

/**
 * Google Search tool that uses a separate model instance with search grounding.
 * The shared execute pipeline lives in {@link runGroundingTool}; this class only
 * holds the Search-specific metadata and grounding configuration.
 */
export class GoogleSearchTool implements Tool {
	name = 'google_search';
	displayName = 'Google Search';
	category = ToolCategory.READ_ONLY;
	classification = ToolClassification.EXTERNAL;
	description =
		'Search Google for current, up-to-date information from the web. Returns an answer with inline citations and source links. Use this for quick factual lookups, recent news, statistics, or information that may have changed since training. The query you provide is used as the core search input — keep queries focused and specific for best results.';

	parameters = {
		type: 'object' as const,
		properties: {
			query: {
				type: 'string' as const,
				description: 'The search query to send to Google',
			},
		},
		required: ['query'],
	};

	getProgressDescription(params: { query: string }): string {
		if (params.query) {
			// Truncate long queries
			const query = params.query.length > 30 ? params.query.substring(0, 27) + '...' : params.query;
			return `Searching Google for "${query}"`;
		}
		return 'Searching Google';
	}

	async execute(params: { query: string }, context: ToolExecutionContext): Promise<ToolResult> {
		return runGroundingTool(context.plugin, {
			query: params.query,
			groundingTool: { googleSearch: {} },
			// Web-search evidence lives on `chunk.web`. `snippet` isn't in the SDK's
			// GroundingChunkWeb type but the API returns it, so read it via a narrow cast.
			getChunkCitation: (chunk) => ({
				uri: chunk.web?.uri,
				title: chunk.web?.title,
				snippet: (chunk.web as { snippet?: string } | undefined)?.snippet,
			}),
			promptPrefix: 'Please search for the following and provide a comprehensive answer based on current web results: ',
			errorPrefix: 'Google search failed: ',
			operationName: 'GoogleSearchTool.generateContent',
		});
	}
}

/**
 * Get Google Search tool
 */
export function getGoogleSearchTool(): Tool {
	return new GoogleSearchTool();
}
