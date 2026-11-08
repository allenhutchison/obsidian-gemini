import { Tool, ToolResult, ToolExecutionContext, ToolParams } from './types';
import { ToolCategory } from '../types/agent';
import { ToolClassification } from '../types/tool-policy';
import { getRawErrorMessage } from '../utils/error-utils';
import { t } from '../i18n';

/**
 * Narrow the model-supplied image params to their expected string types once, so
 * `confirmationMessage` and `execute` share a single source of truth for the
 * `prompt`/`output_path` fields instead of re-deriving them independently.
 */
function parseImageParams(params: ToolParams): { prompt?: string; outputPath?: string } {
	const prompt = typeof params.prompt === 'string' ? params.prompt : undefined;
	const outputPath = typeof params.output_path === 'string' ? params.output_path : undefined;
	return { prompt, outputPath };
}

/**
 * Tool to generate images from text prompts through the routed provider.
 */
export class GenerateImageTool implements Tool {
	name = 'generate_image';
	displayName = 'Generate Image';
	category = ToolCategory.VAULT_OPERATIONS;
	classification = ToolClassification.WRITE;
	description =
		'Generate an image from a text prompt and save it to the vault. Returns the wikilink that can be used to embed the image in a note. IMPORTANT: This tool only generates and saves the image file - it does NOT insert the image into any note. To add the generated image to a note, you must use write_file to insert the returned wikilink into the note content. ' +
		'Set background=true to submit as a background task and return immediately with { taskId, output_path }. The returned output_path is where the image will land, except that the file extension is set from the image data once it exists: the model may return JPEG, WebP or GIF, so the saved file can end in .jpg, .webp or .gif instead of .png. Read it later with read_file, trying those extensions if the .png path is missing.';

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
					'Optional: Explicit vault path where the generated image file should be saved (e.g. "attachments/my-image.png"). The extension is replaced to match the format of the generated image (e.g. .jpg for JPEG). When omitted, the image is saved under the plugin\'s Background-Tasks folder.',
			},
			background: {
				type: 'boolean' as const,
				description:
					'When true, submit as a background task and return immediately with { taskId, output_path }. ' +
					'The output_path in the response is where the image will be saved; its extension may change from .png to .jpg, .webp or .gif to match the image data. Once the task completes, read_file it, and if the .png path is missing, try the same path with those extensions.',
			},
		},
		required: ['prompt'],
	};

	requiresConfirmation = true;

	confirmationMessage = (params: ToolParams) => {
		const { prompt = '', outputPath } = parseImageParams(params);
		let message = t('tool.confirm.generateImage', { prompt });
		if (outputPath) {
			message += `\n\n${t('tool.confirm.generateImageDestination', { path: outputPath })}`;
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

	async execute(params: ToolParams, context: ToolExecutionContext): Promise<ToolResult> {
		const plugin = context.plugin;
		const { prompt, outputPath } = parseImageParams(params);
		const background = !!params.background;

		try {
			// Get the image generation service
			if (!plugin.imageGeneration) {
				return {
					success: false,
					error: 'Image generation service not available',
				};
			}

			// Validate prompt
			if (!prompt || prompt.trim().length === 0) {
				return {
					success: false,
					error: 'Prompt is required and must be a non-empty string',
				};
			}

			// ── Background mode ──────────────────────────────────────────────────
			if (background) {
				if (!plugin.backgroundTaskManager) {
					return { success: false, error: 'Background task manager not available' };
				}

				// Pre-resolve the output path at submit time so the agent has a concrete
				// vault path to read_file later. resolveOutputPath handles both the
				// explicit-path case (validation + provisional .png extension) and the
				// default Background-Tasks fallback. The image doesn't exist yet, so
				// the extension can't be known: the save swaps .png for whatever the
				// bytes turn out to be (.jpg, .webp, .gif) and keeps the rest.
				let resolvedOutputPath: string;
				try {
					resolvedOutputPath = await plugin.imageGeneration.resolveOutputPath(prompt, outputPath);
				} catch (error) {
					return {
						success: false,
						error: `Failed to resolve image output path: ${getRawErrorMessage(error)}`,
					};
				}

				// The extension of the saved file isn't known until the image exists, so
				// the agent locates it by stem. Refuse a stem another image already uses
				// (or that another pending background image has reserved), so that lookup
				// can't land on a different file.
				const existing = plugin.imageGeneration.findImageWithSameStem(resolvedOutputPath);
				if (existing) {
					return {
						success: false,
						error: `An image with the same name already exists or is still being generated at "${existing}". Choose an output_path with a different file name.`,
					};
				}

				const imageGeneration = plugin.imageGeneration;
				const label = prompt.length > 40 ? prompt.slice(0, 37) + '…' : prompt;
				const releaseStem = imageGeneration.reserveImageStem(resolvedOutputPath);
				let taskId: string;
				try {
					taskId = plugin.backgroundTaskManager.submit('image-generation', label, async (isCancelled) => {
						try {
							if (isCancelled()) return undefined;
							// Always pass the pre-resolved path as the explicit outputPath so the
							// task writes exactly where we told the agent it would land.
							return await imageGeneration.generateImage(prompt, resolvedOutputPath);
						} finally {
							releaseStem();
						}
					});
				} catch (error) {
					releaseStem();
					throw error;
				}

				return {
					success: true,
					data: {
						taskId,
						output_path: resolvedOutputPath,
						note: 'The extension is set from the generated image data, so the saved file may end in .jpg, .webp or .gif instead of .png.',
					},
				};
			}

			// ── Foreground mode (default) ────────────────────────────────────────
			// Without an explicit path the default name is unique, so there is
			// nothing to guard. With one, respect a stem a pending background image
			// has reserved, and reserve it ourselves while generating, so neither
			// request can save a same-stem file the other then finds by extension.
			let imagePath: string;
			if (outputPath) {
				const imageGeneration = plugin.imageGeneration;
				const resolvedOutputPath = await imageGeneration.resolveOutputPath(prompt, outputPath);
				if (imageGeneration.isImageStemReserved(resolvedOutputPath)) {
					return {
						success: false,
						error: `An image with the same name is still being generated at "${resolvedOutputPath}". Choose an output_path with a different file name, or wait for that task to finish.`,
					};
				}
				const releaseStem = imageGeneration.reserveImageStem(resolvedOutputPath);
				try {
					imagePath = await imageGeneration.generateImage(prompt, outputPath);
				} finally {
					releaseStem();
				}
			} else {
				imagePath = await plugin.imageGeneration.generateImage(prompt, outputPath);
			}

			return {
				success: true,
				data: {
					path: imagePath,
					prompt,
					wikilink: `![[${imagePath}]]`,
				},
			};
		} catch (error) {
			return {
				success: false,
				error: `Failed to generate image: ${getRawErrorMessage(error)}`,
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
