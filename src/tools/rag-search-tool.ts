import { Tool, ToolResult, ToolExecutionContext } from './types';
import { ToolCategory } from '../types/agent';
import { GoogleGenAI } from '@google/genai';
import type ObsidianGemini from '../main';

/**
 * Search result from RAG semantic search
 */
interface RagSearchResult {
	path: string;
	excerpt: string;
	relevance?: number;
}

/**
 * Tool for semantic search across indexed vault files
 * Uses Google's File Search API for RAG-based retrieval
 */
export class RagSearchTool implements Tool {
	name = 'vault_semantic_search';
	displayName = 'Semantic Vault Search';
	category = ToolCategory.READ_ONLY;
	description = 'Search across all indexed vault files using semantic search. Returns relevant passages from your notes based on meaning, not just keywords. Use this when you need to find information across the entire vault based on concepts or topics.';

	parameters = {
		type: 'object' as const,
		properties: {
			query: {
				type: 'string' as const,
				description: 'The search query. Can be a question, topic, or concept to search for.'
			},
			maxResults: {
				type: 'number' as const,
				description: 'Maximum number of results to return (default: 5, max: 20)'
			}
		},
		required: ['query']
	};

	getProgressDescription(params: { query: string }): string {
		const truncatedQuery = params.query.length > 50
			? params.query.substring(0, 47) + '...'
			: params.query;
		return `Searching vault for "${truncatedQuery}"`;
	}

	async execute(params: { query: string; maxResults?: number }, context: ToolExecutionContext): Promise<ToolResult> {
		const plugin = context.plugin as InstanceType<typeof ObsidianGemini>;

		try {
			// Validate query
			if (!params.query || typeof params.query !== 'string' || params.query.trim().length === 0) {
				return {
					success: false,
					error: 'Query is required and must be a non-empty string'
				};
			}

			// Check if RAG indexing is enabled
			if (!plugin.settings.ragIndexing.enabled) {
				return {
					success: false,
					error: 'RAG indexing is not enabled. Enable it in settings to use semantic search.'
				};
			}

			// Check if service is ready
			if (!plugin.ragIndexing?.isReady()) {
				return {
					success: false,
					error: 'RAG indexing service is not ready. Please wait for initialization to complete.'
				};
			}

			// Get store name
			const storeName = plugin.ragIndexing.getStoreName();
			if (!storeName) {
				return {
					success: false,
					error: 'No File Search Store configured. Please reindex your vault.'
				};
			}

			// Validate and clamp maxResults
			const maxResults = Math.min(Math.max(params.maxResults || 5, 1), 20);

			// Create API client
			const ai = new GoogleGenAI({ apiKey: plugin.settings.apiKey });

			// Perform search using generateContent with File Search tool
			// Use the configured chat model for consistency
			const response = await ai.models.generateContent({
				model: plugin.settings.chatModelName,
				contents: `Search for information about: ${params.query}\n\nProvide a summary of the most relevant findings from the indexed documents. Include specific file references when available.`,
				config: {
					tools: [
						{
							fileSearch: {
								fileSearchStoreNames: [storeName]
							}
						}
					]
				}
			});

			// Extract results from response
			const results: RagSearchResult[] = [];

			// Get grounding metadata for citations
			const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
			if (groundingMetadata?.groundingChunks) {
				for (const chunk of groundingMetadata.groundingChunks.slice(0, maxResults)) {
					if (chunk.retrievedContext) {
						results.push({
							path: chunk.retrievedContext.title || 'Unknown',
							excerpt: chunk.retrievedContext.text || '',
						});
					}
				}
			}

			// Get the generated text response
			const textResponse = response.text;

			return {
				success: true,
				data: {
					query: params.query,
					summary: textResponse,
					results: results,
					totalMatches: results.length,
					message: results.length > 0
						? `Found ${results.length} relevant passages`
						: 'No relevant passages found'
				}
			};
		} catch (error) {
			plugin.logger.error('RAG Search failed:', error);
			return {
				success: false,
				error: `Search failed: ${error instanceof Error ? error.message : String(error)}`
			};
		}
	}
}

/**
 * Get all RAG-related tools
 */
export function getRagTools(): Tool[] {
	return [
		new RagSearchTool()
	];
}
