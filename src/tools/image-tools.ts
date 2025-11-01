import { Tool, ToolResult, ToolExecutionContext } from './types';
import { ToolCategory } from '../types/agent';

/**
 * Tool to generate images from text prompts using Gemini's image generation API
 */
export class GenerateImageTool implements Tool {
	name = 'generate_image';
	displayName = 'Generate Image';
	category = ToolCategory.VAULT_OPERATIONS;
	description = 'Generate an image from a text prompt and save it to the vault. Returns the wikilink that can be used to embed the image in a note. IMPORTANT: This tool only generates and saves the image file - it does NOT insert the image into any note. To add the generated image to a note, you must use write_file to insert the returned wikilink into the note content.';

	parameters = {
		type: 'object' as const,
		properties: {
			prompt: {
				type: 'string' as const,
				description: 'Detailed description of the image to generate'
			},
			target_note: {
				type: 'string' as const,
				description: 'Optional: The path of the note to use for determining the attachment folder location where the image file will be saved. This does NOT insert the image into the note - it only affects where the image file is stored. If not provided, uses the currently active note to determine the attachment folder.'
			}
		},
		required: ['prompt']
	};

	requiresConfirmation = true;

	confirmationMessage = (params: any) => {
		return `Generate an image with prompt: "${params.prompt}"?\n\nThis will create a new image file in your vault.`;
	};

	async execute(params: any, context: ToolExecutionContext): Promise<ToolResult> {
		const { plugin } = context;

		try {
			// Get the image generation service
			const imageGeneration = (plugin as any).imageGeneration;
			if (!imageGeneration) {
				return {
					success: false,
					error: 'Image generation service not available'
				};
			}

			// Validate prompt
			if (!params.prompt || typeof params.prompt !== 'string' || params.prompt.trim().length === 0) {
				return {
					success: false,
					error: 'Prompt is required and must be a non-empty string'
				};
			}

			// Generate the image
			const imagePath = await imageGeneration.generateImage(
				params.prompt,
				params.target_note
			);

			return {
				success: true,
				data: {
					path: imagePath,
					prompt: params.prompt,
					wikilink: `![[${imagePath}]]`
				}
			};
		} catch (error) {
			return {
				success: false,
				error: `Failed to generate image: ${error instanceof Error ? error.message : String(error)}`
			};
		}
	}
}

/**
 * Get all image-related tools
 */
export function getImageTools(): Tool[] {
	return [
		new GenerateImageTool()
	];
}
