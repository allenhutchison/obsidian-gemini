import { Tool, ToolResult, ToolExecutionContext } from './types';
import { ToolCategory } from '../types/agent';
import type ObsidianGemini from '../main';
import { GoogleGenAI } from '@google/genai';

/**
 * Web fetch tool using Google's URL Context feature
 * This allows the model to fetch and analyze content from URLs
 * 
 * Note: URL context is automatically recognized when a URL is present in the prompt.
 * The model will fetch and analyze the content at the URL.
 */
export class WebFetchTool implements Tool {
	name = 'web_fetch';
	category = ToolCategory.READ_ONLY;
	description = 'Fetch and analyze content from a URL using AI';
	
	parameters = {
		type: 'object' as const,
		properties: {
			url: {
				type: 'string' as const,
				description: 'The URL to fetch and analyze'
			},
			query: {
				type: 'string' as const,
				description: 'What information to extract or questions to answer about the content'
			}
		},
		required: ['url', 'query']
	};

	async execute(params: { url: string; query: string }, context: ToolExecutionContext): Promise<ToolResult> {
		const plugin = context.plugin as InstanceType<typeof ObsidianGemini>;
		
		if (!plugin.settings.apiKey) {
			return {
				success: false,
				error: 'API key not configured'
			};
		}

		try {
			// Validate URL
			const urlObj = new URL(params.url);
			if (!['http:', 'https:'].includes(urlObj.protocol)) {
				return {
					success: false,
					error: 'Only HTTP and HTTPS URLs are supported'
				};
			}

			// Create a new instance of GoogleGenAI
			const genAI = new GoogleGenAI({ apiKey: plugin.settings.apiKey });
			
			// Use the same model that's configured for chat
			// This ensures consistency with the main conversation
			const modelToUse = plugin.settings.chatModelName || 'gemini-2.5-flash';

			// Create a prompt that includes the URL and the query
			const prompt = `${params.query} for ${params.url}`;

			// Generate content with URL context using the genAI.models API
			console.log('Web fetch - sending prompt:', prompt);
			const result = await genAI.models.generateContent({
				model: modelToUse,
				contents: prompt,
				config: {
					temperature: plugin.settings.temperature || 0.7,
					tools: [{ urlContext: {} }]
				}
			});
			console.log('Web fetch - received result:', result);
			
			// Extract text from response
			let text = '';
			if (result.candidates?.[0]?.content?.parts) {
				for (const part of result.candidates[0].content.parts) {
					if (part.text) {
						text += part.text;
					}
				}
			}

			if (!text) {
				return {
					success: false,
					error: 'No response generated from URL content'
				};
			}

			// Extract URL context metadata if available
			const urlMetadata = result.candidates?.[0]?.urlContextMetadata;
			
			// Log metadata for debugging
			if (urlMetadata?.urlMetadata) {
				console.log('URL Context Metadata:', urlMetadata.urlMetadata);
			}
			
			return {
				success: true,
				data: {
					url: params.url,
					query: params.query,
					content: text,
					urlsRetrieved: urlMetadata?.urlMetadata?.map((meta: any) => ({
						url: meta.retrieved_url,
						status: meta.url_retrieval_status
					})) || [],
					fetchedAt: new Date().toISOString()
				}
			};

		} catch (error) {
			console.error('Web fetch error:', error);
			
			// Provide more specific error messages
			if (error instanceof TypeError && error.message.includes('Failed to construct')) {
				return {
					success: false,
					error: `Invalid URL format: ${params.url}`
				};
			}
			
			if (error instanceof Error) {
				// Check for common API errors
				if (error.message.includes('404')) {
					return {
						success: false,
						error: 'URL not found (404)'
					};
				}
				if (error.message.includes('403')) {
					return {
						success: false,
						error: 'Access forbidden to this URL (403)'
					};
				}
				if (error.message.includes('quota')) {
					return {
						success: false,
						error: 'API quota exceeded'
					};
				}
			}
			
			return {
				success: false,
				error: `Failed to fetch URL: ${error instanceof Error ? error.message : 'Unknown error'}`
			};
		}
	}
}