import { GoogleGenAI, HttpOptions } from '@google/genai';
import type ObsidianGemini from '../main';

/**
 * Creates a GoogleGenAI instance using plugin settings.
 * Always use this helper instead of calling `new GoogleGenAI(...)` directly,
 * so that customBaseUrl is applied consistently across all call sites.
 */
export function createGoogleGenAI(plugin: ObsidianGemini): GoogleGenAI {
	const apiKey = plugin.apiKey;
	const customBaseUrl = plugin.settings.customBaseUrl?.trim();
	const httpOptions: HttpOptions | undefined = customBaseUrl ? { baseUrl: customBaseUrl } : undefined;

	return new GoogleGenAI({
		apiKey,
		...(httpOptions && { httpOptions }),
	});
}
