import { Tool } from './types';
import { ToolDefinition } from '../api/interfaces/model-api';

/**
 * Converts Tool objects to ToolDefinition format for the Gemini API
 */
export class ToolConverter {
	/**
	 * Convert a Tool to a ToolDefinition for the API
	 */
	static toToolDefinition(tool: Tool): ToolDefinition {
		return {
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
		};
	}

	/**
	 * Convert multiple Tools to ToolDefinitions
	 */
	static toToolDefinitions(tools: Tool[]): ToolDefinition[] {
		return tools.map((tool) => this.toToolDefinition(tool));
	}

	/**
	 * Format tools for Gemini API's expected format
	 * Gemini expects tools in a specific structure
	 */
	static toGeminiFormat(tools: Tool[]): any[] {
		if (!tools || tools.length === 0) {
			return [];
		}

		// Gemini expects tools wrapped in a function_declarations array
		return [
			{
				function_declarations: tools.map((tool) => ({
					name: tool.name,
					description: tool.description,
					parameters: {
						type: 'object',
						properties: tool.parameters.properties || {},
						required: tool.parameters.required || [],
					},
				})),
			},
		];
	}
}
