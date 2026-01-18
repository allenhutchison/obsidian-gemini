import { Tool, ToolResult, ToolExecutionContext } from './types';
import { ToolCategory } from '../types/agent';
import type ObsidianGemini from '../main';

/**
 * Search result from RAG semantic search
 */
interface RagSearchResult {
	path?: string;
	excerpt: string;
	relevance?: number;
}

/**
 * Tool for semantic search across indexed vault files
 * Uses Google's File Search API for RAG-based retrieval
 *
 * Note: Google's File Search API has a limitation where the grounding response
 * doesn't include the source file path (displayName/title/uri), only the text
 * content and fileSearchStore name. The file paths are stored in customMetadata
 * during upload but aren't returned in search results. This means results
 * may not include the source file path.
 */
export class RagSearchTool implements Tool {
	name = 'vault_semantic_search';
	displayName = 'Semantic Vault Search';
	category = ToolCategory.READ_ONLY;
	description =
		'Search across all indexed vault files using semantic search. Returns relevant passages from your notes based on meaning, not just keywords. Optionally filter by folder path or tags. Use this when you need to find information across the vault based on concepts or topics.';

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
			},
			folder: {
				type: 'string' as const,
				description: 'Limit search to files in this folder path (e.g., "projects" or "projects/2024")'
			},
			tags: {
				type: 'array' as const,
				items: { type: 'string' as const },
				description: 'Filter by tags. Multiple tags use OR logic (matches any tag).'
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

	/**
	 * Escape a value for use in AIP-160 filter expressions.
	 * Prevents injection attacks by escaping backslashes and double quotes.
	 */
	private escapeFilterValue(value: string): string {
		// First escape backslashes, then escape double quotes (RE2-style)
		return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
	}

	/**
	 * Build a metadata filter expression for Google's File Search API.
	 * Uses AIP-160 filter syntax.
	 */
	private buildMetadataFilter(folder?: string, tags?: string[]): string | undefined {
		const conditions: string[] = [];

		if (folder && folder.trim()) {
			// Folder filter - exact match on folder path
			const escapedFolder = this.escapeFilterValue(folder.trim());
			conditions.push(`folder="${escapedFolder}"`);
		}

		if (tags && tags.length > 0) {
			// Filter out empty tags
			const validTags = tags.filter((tag) => tag && tag.trim());
			if (validTags.length > 0) {
				// OR logic for tags - match files with any of the specified tags
				const tagConditions = validTags
					.map((tag) => {
						const escapedTag = this.escapeFilterValue(tag.trim());
						return `tags="${escapedTag}"`;
					})
					.join(' OR ');
				if (validTags.length > 1) {
					conditions.push(`(${tagConditions})`);
				} else {
					conditions.push(tagConditions);
				}
			}
		}

		return conditions.length > 0 ? conditions.join(' AND ') : undefined;
	}

	/**
	 * Extract file path from retrievedContext.
	 * Note: Google's File Search API grounding response may not include
	 * title or uri fields, only text and fileSearchStore.
	 */
	private extractPathFromContext(context: { uri?: string; title?: string }): string | undefined {
		// Try title first (should be the displayName which is set to file.path)
		if (context.title) {
			return context.title;
		}

		// Try to extract path from uri
		// URI format may be like: fileSearchStores/xxx/files/yyy
		if (context.uri) {
			const uriParts = context.uri.split('/');
			const lastPart = uriParts[uriParts.length - 1];
			if (lastPart && lastPart.includes('.')) {
				// Looks like a filename with extension
				return lastPart;
			}
			// Only return uri if it looks meaningful (not just the store name)
			if (!context.uri.startsWith('fileSearchStores/') || context.uri.includes('/files/')) {
				return context.uri;
			}
		}

		// API doesn't provide file path in grounding response
		return undefined;
	}

	async execute(
		params: { query: string; maxResults?: number; folder?: string; tags?: string[] },
		context: ToolExecutionContext
	): Promise<ToolResult> {
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

			// Build metadata filter if folder or tags are specified
			const metadataFilter = this.buildMetadataFilter(params.folder, params.tags);

			// Reuse API client from RAG indexing service
			const ai = plugin.ragIndexing.getClient();
			if (!ai) {
				return {
					success: false,
					error: 'RAG API client not available. Please wait for service initialization.'
				};
			}

			// Build fileSearch config with optional metadata filter
			const fileSearchConfig: { fileSearchStoreNames: string[]; metadataFilter?: string } = {
				fileSearchStoreNames: [storeName]
			};
			if (metadataFilter) {
				fileSearchConfig.metadataFilter = metadataFilter;
			}

			// Perform search using generateContent with File Search tool
			// Use the configured chat model for consistency
			const response = await ai.models.generateContent({
				model: plugin.settings.chatModelName,
				contents: `Search for information about: ${params.query}\n\nProvide a summary of the most relevant findings from the indexed documents. Include specific file references when available.`,
				config: {
					tools: [
						{
							fileSearch: fileSearchConfig
						}
					]
				}
			});

			// Extract results from response
			const results: RagSearchResult[] = [];

			// Get grounding metadata for citations
			const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
			plugin.logger.debug('RAG Search grounding metadata:', JSON.stringify(groundingMetadata, null, 2));

			if (groundingMetadata?.groundingChunks) {
				for (const chunk of groundingMetadata.groundingChunks.slice(0, maxResults)) {
					if (chunk.retrievedContext) {
						// Try to extract path from title or uri
						// Note: Google's File Search API may not include source file info in grounding response
						const path = this.extractPathFromContext(chunk.retrievedContext);
						const result: RagSearchResult = {
							excerpt: chunk.retrievedContext.text || ''
						};
						if (path) {
							result.path = path;
						}
						results.push(result);
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
