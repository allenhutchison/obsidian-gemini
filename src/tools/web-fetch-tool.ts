import { Tool, ToolResult, ToolExecutionContext } from './types';
import { ToolCategory } from '../types/agent';
import type ObsidianGemini from '../main';
import { GoogleGenAI } from '@google/genai';
import { requestUrl } from 'obsidian';

/**
 * Web fetch tool using Google's URL Context feature
 * This allows the model to fetch and analyze content from URLs
 * 
 * Note: URL context is automatically recognized when a URL is present in the prompt.
 * The model will fetch and analyze the content at the URL.
 */
export class WebFetchTool implements Tool {
	name = 'web_fetch';
	displayName = 'Web Fetch';
	category = ToolCategory.READ_ONLY;
	description = 'Fetch and analyze content from a specific URL using Google\'s URL Context feature and AI. Provide a URL and a query describing what information to extract or questions to answer about the page content. The AI will read the page and provide a targeted analysis based on your query. Returns the analyzed content, URL metadata, and fetch timestamp. Falls back to direct HTTP fetch if URL Context fails. Use this to extract specific information from web pages, documentation, articles, or any publicly accessible URL.';
	
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

	getProgressDescription(params: { url: string }): string {
		if (params.url) {
			// Extract domain for brevity
			try {
				const domain = new URL(params.url).hostname.replace('www.', '');
				return `Fetching from ${domain}`;
			} catch {
				return 'Fetching web page';
			}
		}
		return 'Fetching web page';
	}

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
			plugin.logger.log('Web fetch - sending prompt:', prompt);
			const result = await genAI.models.generateContent({
				model: modelToUse,
				contents: prompt,
				config: {
					temperature: plugin.settings.temperature || 0.7,
					tools: [{ urlContext: {} }]
				}
			});
			plugin.logger.log('Web fetch - received result:', result);
			
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
				plugin.logger.log('URL Context Metadata:', urlMetadata.urlMetadata);
				// Log more details about the metadata structure
				if (urlMetadata.urlMetadata.length > 0) {
					plugin.logger.log('First metadata entry:', JSON.stringify(urlMetadata.urlMetadata[0], null, 2));
				}
			}
			
			// Check if URL retrieval failed - the field is urlRetrievalStatus (camelCase)
			const urlRetrievalFailed = urlMetadata?.urlMetadata?.some((meta: any) => {
				const status = meta.urlRetrievalStatus;
				plugin.logger.log('Checking URL status:', status);
				return status === 'URL_RETRIEVAL_STATUS_ERROR' ||
					   status === 'URL_RETRIEVAL_STATUS_ACCESS_DENIED' ||
					   status === 'URL_RETRIEVAL_STATUS_NOT_FOUND';
			});
			
			if (urlRetrievalFailed) {
				plugin.logger.log('URL retrieval failed, attempting fallback fetch...');
				// Try fallback fetch
				return await this.fallbackFetch(params, plugin);
			}
			
			return {
				success: true,
				data: {
					url: params.url,
					query: params.query,
					content: text,
					urlsRetrieved: urlMetadata?.urlMetadata?.map((meta: any) => ({
						url: meta.retrievedUrl,
						status: meta.urlRetrievalStatus
					})) || [],
					fetchedAt: new Date().toISOString()
				}
			};

		} catch (error) {
			plugin.logger.error('Web fetch error:', error);

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
			
			// Try fallback fetch for any other errors
			plugin.logger.log('Primary web fetch failed, attempting fallback...');
			try {
				return await this.fallbackFetch(params, plugin);
			} catch (fallbackError) {
				return {
					success: false,
					error: `Failed to fetch URL with both methods: ${error instanceof Error ? error.message : 'Unknown error'}`
				};
			}
		}
	}
	
	/**
	 * Fallback method using direct HTTP fetch
	 */
	private async fallbackFetch(params: { url: string; query: string }, plugin: InstanceType<typeof ObsidianGemini>): Promise<ToolResult> {
		try {
			// Fetch the URL content directly
			const response = await requestUrl({
				url: params.url,
				method: 'GET',
				headers: {
					'User-Agent': 'Mozilla/5.0 (compatible; ObsidianGemini/1.0)'
				}
			});
			
			if (response.status !== 200) {
				return {
					success: false,
					error: `HTTP ${response.status}: ${response.text || 'Failed to fetch URL'}`
				};
			}
			
			// Convert HTML to text (basic conversion)
			let content = response.text;
			
			// Remove script and style tags
			content = content.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
			content = content.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
			
			// Extract title
			const titleMatch = content.match(/<title[^>]*>([^<]+)<\/title>/i);
			const title = titleMatch ? titleMatch[1].trim() : params.url;
			
			// Convert common HTML entities
			content = content.replace(/&nbsp;/g, ' ');
			content = content.replace(/&amp;/g, '&');
			content = content.replace(/&lt;/g, '<');
			content = content.replace(/&gt;/g, '>');
			content = content.replace(/&quot;/g, '"');
			content = content.replace(/&#39;/g, "'");
			
			// Remove HTML tags but keep text
			content = content.replace(/<[^>]+>/g, ' ');
			
			// Clean up whitespace
			content = content.replace(/\s+/g, ' ').trim();
			
			// Truncate if too long
			if (content.length > 10000) {
				content = content.substring(0, 10000) + '\n\n[Content truncated...]';
			}
			
			// Now use Gemini to analyze the content
			const genAI = new GoogleGenAI({ apiKey: plugin.settings.apiKey });
			const modelToUse = plugin.settings.chatModelName || 'gemini-2.5-flash';
			
			// Create a prompt with the content
			const prompt = `Based on the following web page content from ${params.url}, ${params.query}\n\nWeb Page Title: ${title}\n\nContent:\n${content}`;
			
			const result = await genAI.models.generateContent({
				model: modelToUse,
				contents: prompt,
				config: {
					temperature: plugin.settings.temperature || 0.7
				}
			});
			
			// Extract text from response
			let analysisText = '';
			if (result.candidates?.[0]?.content?.parts) {
				for (const part of result.candidates[0].content.parts) {
					if (part.text) {
						analysisText += part.text;
					}
				}
			}
			
			if (!analysisText) {
				return {
					success: false,
					error: 'No analysis generated from page content'
				};
			}
			
			return {
				success: true,
				data: {
					url: params.url,
					query: params.query,
					content: analysisText,
					title: title,
					fallbackMethod: true,
					fetchedAt: new Date().toISOString()
				}
			};

		} catch (error) {
			plugin.logger.error('Fallback fetch error:', error);
			return {
				success: false,
				error: `Fallback fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`
			};
		}
	}
}