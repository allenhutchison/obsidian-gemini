import { Tool, ToolResult, ToolExecutionContext } from './types';
import { ToolCategory } from '../types/agent';
import { ToolClassification } from '../types/tool-policy';
import { getDefaultModelForRole } from '../models';
import { createGoogleGenAI } from '../api/providers/gemini/google-genai-factory';
import { executeWithRetry } from '../utils/retry';

/**
 * Google Maps grounding tool that uses a separate model instance with the
 * `googleMaps` grounding tool enabled. Mirrors {@link GoogleSearchTool} but
 * grounds answers in Google Maps place data (locations, hours, reviews,
 * directions) instead of web search results.
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
		const plugin = context.plugin;

		try {
			// Check if API key is available
			if (!plugin.apiKey) {
				return {
					success: false,
					error: 'Google API key not configured',
				};
			}

			// Create a separate model instance with Google Maps grounding enabled
			const genAI = createGoogleGenAI(plugin);
			const modelToUse = plugin.settings.chatModelName || getDefaultModelForRole('chat');
			const config = {
				temperature: plugin.settings.temperature,
				maxOutputTokens: 8192,
				tools: [{ googleMaps: {} }],
			};

			const prompt = `Please answer the following using current Google Maps information about real-world places: ${params.query}`;

			const result = await executeWithRetry(
				() =>
					genAI.models.generateContent({
						model: modelToUse,
						config: config,
						contents: prompt,
					}),
				undefined,
				{ operationName: 'GoogleMapsTool.generateContent', logger: plugin.logger }
			);

			// Extract text from response
			let text = '';
			if (result.candidates?.[0]?.content?.parts) {
				for (const part of result.candidates[0].content.parts) {
					if (part.text) {
						text += part.text;
					}
				}
			} else if (result.text) {
				try {
					text = result.text;
				} catch (e) {
					plugin.logger.warn('Failed to get text from result:', e);
				}
			}

			// Extract grounding metadata and place citations if available
			const groundingMetadata = result.candidates?.[0]?.groundingMetadata;
			let citations: Array<{ title?: string; url: string; snippet?: string }> = [];
			let textWithCitations = text;

			// Maps grounding returns place evidence on `chunk.maps` rather than `chunk.web`.
			if (groundingMetadata?.groundingChunks) {
				const chunks = groundingMetadata.groundingChunks;
				citations = chunks
					.filter((chunk: any) => chunk.maps?.uri)
					.map((chunk: any) => ({
						url: chunk.maps.uri,
						title: chunk.maps.title || chunk.maps.uri,
						snippet: chunk.maps.text || '',
					}));

				// Add inline citations to text if supports are available
				if (groundingMetadata.groundingSupports) {
					const supports = groundingMetadata.groundingSupports;
					// Sort supports by end_index in descending order so insertions don't shift later offsets
					const sortedSupports = [...supports].sort(
						(a: any, b: any) => (b.segment?.endIndex ?? 0) - (a.segment?.endIndex ?? 0)
					);

					for (const support of sortedSupports) {
						const endIndex = support.segment?.endIndex;
						if (endIndex === undefined || !support.groundingChunkIndices?.length) {
							continue;
						}

						const citationLinks = support.groundingChunkIndices
							.map((i: number) => {
								const uri = chunks[i]?.maps?.uri;
								if (uri) {
									return `[${i + 1}](${uri})`;
								}
								return null;
							})
							.filter(Boolean);

						if (citationLinks.length > 0) {
							const citationString = ` ${citationLinks.join(', ')}`;
							textWithCitations =
								textWithCitations.slice(0, endIndex) + citationString + textWithCitations.slice(endIndex);
						}
					}
				}
			}

			return {
				success: true,
				data: {
					query: params.query,
					answer: textWithCitations, // Text with inline citations
					originalAnswer: text, // Original text without citations
					citations: citations,
					searchGrounding: groundingMetadata || undefined,
				},
			};
		} catch (error) {
			return {
				success: false,
				error: `Google Maps lookup failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
			};
		}
	}
}

/**
 * Get Google Maps tool
 */
export function getGoogleMapsTool(): Tool {
	return new GoogleMapsTool();
}
