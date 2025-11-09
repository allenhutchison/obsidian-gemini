import { Tool, ToolResult, ToolExecutionContext } from './types';
import { ToolCategory } from '../types/agent';
import type ObsidianGemini from '../main';
import { GoogleGenAI } from '@google/genai';
import { getDefaultModelForRole } from '../models';

/**
 * Google Search tool that uses a separate model instance with search grounding
 */
export class GoogleSearchTool implements Tool {
	name = 'google_search';
	displayName = 'Google Search';
	category = ToolCategory.READ_ONLY;
	description = 'Search Google for current, up-to-date information from the web using Google\'s Search Grounding feature. Returns AI-generated answer with inline citations and source links. Use this to find recent news, facts, statistics, or any information that might have changed since the AI model\'s training cutoff. Results include structured citations with URLs, titles, and snippets from authoritative web sources.';
	
	parameters = {
		type: 'object' as const,
		properties: {
			query: {
				type: 'string' as const,
				description: 'The search query to send to Google'
			}
		},
		required: ['query']
	};

	async execute(params: { query: string }, context: ToolExecutionContext): Promise<ToolResult> {
		const plugin = context.plugin as InstanceType<typeof ObsidianGemini>;
		
		try {
			// Check if API key is available
			if (!plugin.settings.apiKey) {
				return {
					success: false,
					error: 'Google API key not configured'
				};
			}

			// Create a separate model instance with Google Search enabled
			const genAI = new GoogleGenAI({ apiKey: plugin.settings.apiKey });

			// Use the models API similar to gemini-api-new.ts
			const modelToUse = plugin.settings.chatModelName || getDefaultModelForRole('chat');
			const config = {
				temperature: plugin.settings.temperature,
				maxOutputTokens: 8192, // Default max tokens
				tools: [{ googleSearch: {} }]
			};

			// Create a simple prompt that encourages the model to search
			const prompt = `Please search for the following and provide a comprehensive answer based on current web results: ${params.query}`;

			// Generate response with search grounding using the same API as gemini-api-new.ts
			const result = await genAI.models.generateContent({
				model: modelToUse,
				config: config,
				contents: prompt
			});
			
			// Extract text from response
			let text = '';
			if (result.candidates?.[0]?.content?.parts) {
				// Extract text from parts
				for (const part of result.candidates[0].content.parts) {
					if (part.text) {
						text += part.text;
					}
				}
			} else if (result.text) {
				// The text property might be a getter, not a function
				try {
					text = result.text;
				} catch (e) {
					// If it fails, it might be a legacy format
					plugin.logger.warn('Failed to get text from result:', e);
				}
			}

			// Extract search results metadata and citations if available
			const searchMetadata = result.candidates?.[0]?.groundingMetadata;
			let citations: Array<{title?: string; url: string; snippet?: string}> = [];
			let textWithCitations = text;

			// Extract citations from groundingChunks
			if (searchMetadata?.groundingChunks) {
				const chunks = searchMetadata.groundingChunks;
				citations = chunks
					.filter((chunk: any) => chunk.web?.uri)
					.map((chunk: any, index: number) => ({
						url: chunk.web.uri,
						title: chunk.web.title || chunk.web.uri,
						snippet: chunk.web.snippet || ''
					}));
				
				// Add inline citations to text if supports are available
				if (searchMetadata.groundingSupports) {
					const supports = searchMetadata.groundingSupports;
					// Sort supports by end_index in descending order
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
								const uri = chunks[i]?.web?.uri;
								if (uri) {
									return `[${i + 1}](${uri})`;
								}
								return null;
							})
							.filter(Boolean);
						
						if (citationLinks.length > 0) {
							const citationString = ` ${citationLinks.join(', ')}`;
							textWithCitations = textWithCitations.slice(0, endIndex) + citationString + textWithCitations.slice(endIndex);
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
					searchGrounding: searchMetadata || undefined
				}
			};
			
		} catch (error) {
			return {
				success: false,
				error: `Google search failed: ${error instanceof Error ? error.message : 'Unknown error'}`
			};
		}
	}
}

/**
 * Get Google Search tool
 */
export function getGoogleSearchTool(): Tool {
	return new GoogleSearchTool();
}