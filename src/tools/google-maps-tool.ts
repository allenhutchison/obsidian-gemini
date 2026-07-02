import { Tool, ToolResult, ToolExecutionContext } from './types';
import { ToolCategory } from '../types/agent';
import { ToolClassification } from '../types/tool-policy';
import { runGroundingTool } from './grounding-tool-runner';

/**
 * Google Maps grounding tool that uses a separate model instance with the
 * `googleMaps` grounding tool enabled. Mirrors {@link GoogleSearchTool} but
 * grounds answers in Google Maps place data (locations, hours, reviews,
 * directions) instead of web search results. The shared execute pipeline lives
 * in {@link runGroundingTool}; this class only holds the Maps-specific metadata
 * and grounding configuration.
 */
export class GoogleMapsTool implements Tool {
	name = 'google_maps';
	displayName = 'Google Maps';
	category = ToolCategory.READ_ONLY;
	classification = ToolClassification.EXTERNAL;
	description =
		'Look up real-world places and location information using Google Maps. Returns an answer with inline citations and links to the places referenced. Use this for finding businesses, points of interest, addresses, opening hours, ratings/reviews, or "near me" style queries. Include the location in the query (e.g. "coffee shops near Ferry Building, San Francisco") for best results.';

	parameters = {
		type: 'object' as const,
		properties: {
			query: {
				type: 'string' as const,
				description: 'The place or location question to answer with Google Maps. Include a location for best results.',
			},
		},
		required: ['query'],
	};

	getProgressDescription(params: { query: string }): string {
		if (params.query) {
			const query = params.query.length > 30 ? params.query.substring(0, 27) + '...' : params.query;
			return `Searching Maps for "${query}"`;
		}
		return 'Searching Google Maps';
	}

	async execute(params: { query: string }, context: ToolExecutionContext): Promise<ToolResult> {
		return runGroundingTool(context.plugin, {
			query: params.query,
			groundingTool: { googleMaps: {} },
			// Maps grounding returns place evidence on `chunk.maps` rather than `chunk.web`,
			// with the snippet stored on `text`.
			getChunkCitation: (chunk) => ({
				uri: chunk.maps?.uri,
				title: chunk.maps?.title,
				snippet: chunk.maps?.text,
			}),
			promptPrefix: 'Please answer the following using current Google Maps information about real-world places: ',
			errorPrefix: 'Google Maps lookup failed: ',
			operationName: 'GoogleMapsTool.generateContent',
		});
	}
}

/**
 * Get Google Maps tool
 */
export function getGoogleMapsTool(): Tool {
	return new GoogleMapsTool();
}
