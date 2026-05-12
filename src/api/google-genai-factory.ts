import { GoogleGenAI, HttpOptions } from '@google/genai';
import type ObsidianGemini from '../main';

/**
 * Creates a GoogleGenAI instance using plugin settings.
 * Always use this helper instead of calling `new GoogleGenAI(...)` directly,
 * so that customBaseUrl is applied consistently across all call sites.
 *
 * `apiKeyOverride` lets callers (e.g. GeminiClient) pass an explicit key that
 * wins over `plugin.apiKey`. Today every production caller passes the same
 * value, but accepting an override keeps GeminiClientConfig.apiKey honest as
 * the authoritative source when it is supplied.
 */
export function createGoogleGenAI(plugin: ObsidianGemini, apiKeyOverride?: string): GoogleGenAI {
	const apiKey = apiKeyOverride ?? plugin.apiKey;
	const customBaseUrl = plugin.settings.customBaseUrl?.trim();
	const httpOptions: HttpOptions | undefined = customBaseUrl ? { baseUrl: customBaseUrl } : undefined;

	return new GoogleGenAI({
		apiKey,
		...(httpOptions && { httpOptions }),
	});
}
