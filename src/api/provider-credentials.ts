/**
 * Provider credential lookups — a credentials concern, not a UI one, so it
 * lives here rather than in the settings UI (moved out of
 * `src/ui/settings-helpers.ts` by the settings redesign).
 */

import type { ObsidianGeminiSettings } from '../types/settings';
import type { ModelProvider } from './providers/registry';

/**
 * Which settings field holds a provider's API key secret name. Every
 * key-requiring provider has its own field (`apiKeySecretName` for Gemini,
 * `openaiApiKeySecretName` for OpenAI) rather than sharing one, so a mixed
 * configuration with both active needs its own key each. Single source of
 * truth — the settings UI and the init-error path both resolve through this.
 */
export function apiKeySecretNameFor(settings: ObsidianGeminiSettings, provider: ModelProvider): string {
	return provider === 'openai' ? settings.openaiApiKeySecretName : settings.apiKeySecretName;
}
