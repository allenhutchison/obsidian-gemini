/**
 * Provider-neutral surface for one-shot image generation.
 *
 * Image generation is separate from ModelApi because it returns encoded image
 * bytes rather than a conversational ModelResponse.
 */
export interface ImageGenerationApi {
	/**
	 * Generate one image and return its base64-encoded bytes. The format is
	 * whatever the provider returned (PNG, JPEG, WebP, ...); callers sniff it
	 * from the bytes (`sniffImageFormat`) rather than assuming PNG.
	 */
	generateImage(prompt: string, model: string): Promise<string>;
}
