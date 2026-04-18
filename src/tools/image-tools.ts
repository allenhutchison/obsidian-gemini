import { Tool, ToolResult, ToolExecutionContext } from './types';
import { ToolCategory } from '../types/agent';
import { ToolClassification } from '../types/tool-policy';
import type ObsidianGemini from '../main';

/**
 * Tool to generate images from text prompts using Gemini's image generation API
 */
export class GenerateImageTool implements Tool {
	name = 'generate_image';
	displayName = 'Generate Image';
	category = ToolCategory.VAULT_OPERATIONS;
	classification = ToolClassification.WRITE;
	description =
		'Generate an image from a text prompt and save it to the vault. Returns the wikilink that can be used to embed the image in a note. IMPORTANT: This tool only generates and saves the image file - it does NOT insert the image into any note. To add the generated image to a note, you must use write_file to insert the returned wikilink into the note content. ' +
		'Set background=true to submit as a background task and return immediately with { taskId, output_path } — provide output_path so you know the exact location to retrieve the result with read_file.';

	parameters = {
		type: 'object' as const,
		properties: {
			prompt: {
				type: 'string' as const,
				description: 'Detailed description of the image to generate',
			},
			target_note: {
				type: 'string' as const,
				description:
					'Optional: The path of the note to use for determining the attachment folder location where the image file will be saved. This does NOT insert the image into the note - it only affects where the image file is stored. If not provided, uses the currently active note to determine the attachment folder.',
			},
			output_path: {
				type: 'string' as const,
				description:
					'Optional: Explicit vault path where the generated image file should be saved (e.g. "attachments/my-image.png"). When provided, the image is saved at exactly this path regardless of target_note. Useful when the caller needs a predictable location to retrieve the result later.',
			},
			background: {
				type: 'boolean' as const,
				description:
					'When true, submit as a background task and return immediately with { taskId, output_path }. ' +
					'Provide output_path alongside background=true so you know the exact path to read the result with read_file once the task completes.',
			},
		},
		required: ['prompt'],
	};

	requiresConfirmation = true;

	confirmationMessage = (params: any) => {
		let message = `Generate an image with prompt: "${params.prompt}"?\n\nThis will create a new image file in your vault.`;
		if (params.output_path) {
			message += `\n\nDestination: ${params.output_path}`;
		} else if (params.target_note) {
			message += `\n\nAttachment folder resolved from: ${params.target_note}`;
		}
		return message;
	};

	getProgressDescription(params: { prompt: string }): string {
		if (params.prompt) {
			const prompt = params.prompt.length > 25 ? params.prompt.substring(0, 22) + '...' : params.prompt;
			return `Generating image: "${prompt}"`;
		}
		return 'Generating image';
	}

	async execute(params: any, context: ToolExecutionContext): Promise<ToolResult> {
		const plugin = context.plugin as ObsidianGemini;

		try {
			// Get the image generation service
			if (!plugin.imageGeneration) {
				return {
					success: false,
					error: 'Image generation service not available',
				};
			}

			// Validate prompt
			if (!params.prompt || typeof params.prompt !== 'string' || params.prompt.trim().length === 0) {
				return {
					success: false,
					error: 'Prompt is required and must be a non-empty string',
				};
			}

			// ── Background mode ──────────────────────────────────────────────────
			if (params.background) {
				if (!plugin.backgroundTaskManager) {
					return { success: false, error: 'Background task manager not available' };
				}

				const imageGeneration = plugin.imageGeneration;
				const label = params.prompt.length > 40 ? params.prompt.slice(0, 37) + '…' : params.prompt;
				const taskId = plugin.backgroundTaskManager.submit('image-generation', label, async (isCancelled) => {
					if (isCancelled()) return undefined;
					return imageGeneration.generateImage(params.prompt, params.target_note, params.output_path);
				});

				return {
					success: true,
					data: { taskId, output_path: params.output_path ?? null },
				};
			}

			// ── Foreground mode (default) ────────────────────────────────────────
			const imagePath = await plugin.imageGeneration.generateImage(
				params.prompt,
				params.target_note,
				params.output_path
			);

			return {
				success: true,
				data: {
					path: imagePath,
					prompt: params.prompt,
					wikilink: `![[${imagePath}]]`,
				},
			};
		} catch (error) {
			return {
				success: false,
				error: `Failed to generate image: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	}
}

/**
 * Get all image-related tools
 */
export function getImageTools(): Tool[] {
	return [new GenerateImageTool()];
}
