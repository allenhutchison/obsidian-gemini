/**
 * OpenRouter implementation of the ModelApi interface.
 *
 * OpenRouter speaks the OpenAI Chat Completions dialect, so this is a thin
 * subclass of `OpenAIClient` pointed at `https://openrouter.ai/api/v1` with
 * OpenRouter's app-attribution headers. Everything OpenRouter adds on top of
 * that dialect is handled in the shared client, because it is harmless for
 * other OpenAI-compatible servers:
 *  - reasoning text arrives as `reasoning` (read alongside `reasoning_content`)
 *  - `reasoning_details` must be replayed on tool-calling turns
 *    (`openai/reasoning-replay.ts`)
 *
 * The one real divergence is image generation: OpenRouter's Images endpoint is
 * `POST /images` (not OpenAI's `/images/generations`), so `generateImage` is
 * overridden here.
 */

import type { GeminiPrompts } from '../../../prompts';
import type { ObsidianGemini } from '../../../types/plugin';
import { t } from '../../../i18n';
import { describeSdkApiError } from '../../../utils/error-utils';
import { OpenAIClient } from '../openai/client';
import { OPENROUTER_ATTRIBUTION_HEADERS, OPENROUTER_BASE_URL, type OpenRouterClientConfig } from './config';

interface OpenRouterImageResponse {
	data?: { b64_json?: string; media_type?: string }[];
}

export class OpenRouterClient extends OpenAIClient {
	constructor(config: OpenRouterClientConfig, prompts?: GeminiPrompts, plugin?: ObsidianGemini) {
		super(
			{
				apiKey: config.apiKey,
				model: config.model,
				baseUrl: OPENROUTER_BASE_URL,
				defaultHeaders: { ...OPENROUTER_ATTRIBUTION_HEADERS },
			},
			prompts,
			plugin
		);
	}

	protected override get providerName(): string {
		return 'OpenRouter';
	}

	protected override noModelSelectedMessage(): string {
		return t('provider.openrouter.noModelSelected');
	}

	/** Generate one image through OpenRouter's `POST /images` and return its base64 bytes. */
	override async generateImage(prompt: string, model: string): Promise<string> {
		try {
			if (!model) {
				throw new Error(this.noModelSelectedMessage());
			}
			const response = await this.client.post<OpenRouterImageResponse>('/images', { body: { model, prompt } });
			const image = response?.data?.[0]?.b64_json;
			if (!image) {
				throw new Error(t('provider.openrouter.noImageData'));
			}
			return image;
		} catch (error) {
			this.plugin?.logger.error('[OpenRouterClient] Error generating image:', describeSdkApiError(error), error);
			throw error;
		}
	}
}
