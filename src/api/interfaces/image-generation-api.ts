/**
 * Provider-neutral surface for one-shot image generation.
 *
 * Image generation is separate from ModelApi because it returns encoded image
 * bytes rather than a conversational ModelResponse.
 */
export interface ImageGenerationApi {
	/** Generate one PNG image and return its base64-encoded bytes. */
	generateImage(prompt: string, model: string): Promise<string>;
}
