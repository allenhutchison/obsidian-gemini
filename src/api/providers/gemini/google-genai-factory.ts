import { GoogleGenAI, HttpOptions } from '@google/genai';
import type { ObsidianGemini } from '../../../types/plugin';

/**
 * Gemini Developer API version every GoogleGenAI instance targets.
 *
 * `@google/genai` 3.x changed its default from `v1beta` to `v1`, but the
 * `-latest` aliases this plugin bundles as role defaults (`gemini-flash-latest`,
 * `gemini-flash-lite-latest`, `gemini-pro-latest`) are served only on `v1beta`,
 * as are features we rely on (Google Search grounding, URL context, thinking
 * config). Pin it so an SDK upgrade cannot silently move requests to `v1`.
 */
export const GEMINI_API_VERSION = 'v1beta';

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
		apiVersion: GEMINI_API_VERSION,
		...(httpOptions && { httpOptions }),
	});
}
