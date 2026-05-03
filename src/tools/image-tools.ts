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
		'Set background=true to submit as a background task and return immediately with { taskId, output_path }. The returned output_path is the exact vault location where the image will land — read it later with read_file.';

	parameters = {
		type: 'object' as const,
		properties: {
			prompt: {
				type: 'string' as const,
				description: 'Detailed description of the image to generate',
			},
			output_path: {
				type: 'string' as const,
				description:
					'Optional: Explicit vault path where the generated image file should be saved (e.g. "attachments/my-image.png"). When omitted, the image is saved under the plugin\'s Background-Tasks folder.',
			},
			background: {
				type: 'boolean' as const,
				description:
					'When true, submit as a background task and return immediately with { taskId, output_path }. ' +
					'The output_path in the response is the exact vault location where the image will be saved — pass it to read_file once the task completes.',
			},
		},
		required: ['prompt'],
	};

	requiresConfirmation = true;

	confirmationMessage = (params: any) => {
		let message = `Generate an image with prompt: "${params.prompt}"?\n\nThis will create a new image file in your vault.`;
		if (params.output_path) {
			message += `\n\nDestination: ${params.output_path}`;
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

				// Pre-resolve the output path at submit time so the agent has a concrete
				// vault path to read_file later. resolveOutputPath handles both the
				// explicit-path case (validation + .png extension rewrite) and the
				// default Background-Tasks fallback — so the path we return here always
				// matches where the task will actually write.
				let resolvedOutputPath: string;
				try {
					resolvedOutputPath = await plugin.imageGeneration.resolveOutputPath(params.prompt, params.output_path);
				} catch (error) {
					return {
						success: false,
						error: `Failed to resolve image output path: ${error instanceof Error ? error.message : String(error)}`,
					};
				}

				const imageGeneration = plugin.imageGeneration;
				const label = params.prompt.length > 40 ? params.prompt.slice(0, 37) + '…' : params.prompt;
				const taskId = plugin.backgroundTaskManager.submit('image-generation', label, async (isCancelled) => {
					if (isCancelled()) return undefined;
					// Always pass the pre-resolved path as the explicit outputPath so the
					// task writes exactly where we told the agent it would land.
					return imageGeneration.generateImage(params.prompt, resolvedOutputPath);
				});

				return {
					success: true,
					data: { taskId, output_path: resolvedOutputPath },
				};
			}

			// ── Foreground mode (default) ────────────────────────────────────────
			const imagePath = await plugin.imageGeneration.generateImage(params.prompt, params.output_path);

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
