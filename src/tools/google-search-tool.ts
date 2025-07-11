import { Tool, ToolResult, ToolExecutionContext } from './types';
import { ToolCategory } from '../types/agent';
import type ObsidianGemini from '../main';
import { GoogleGenAI } from '@google/genai';

/**
 * Google Search tool that uses a separate model instance with search grounding
 */
export class GoogleSearchTool implements Tool {
	name = 'google_search';
	category = ToolCategory.READ_ONLY;
	description = 'Search Google for current information from the web';
	
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
			const modelToUse = plugin.settings.chatModelName || 'gemini-1.5-flash-002';
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
					console.warn('Failed to get text from result:', e);
				}
			}

			// Extract search results metadata if available
			const searchMetadata = result.candidates?.[0]?.groundingMetadata;
			
			return {
				success: true,
				data: {
					query: params.query,
					answer: text,
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