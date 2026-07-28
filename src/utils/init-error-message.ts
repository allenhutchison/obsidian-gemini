/**
 * Builds the user-facing message for "plugin isn't usable right now" cases
 * (guarded commands, ribbon icon) shared by every provider.
 */

import { t } from '../i18n';
import type { ModelProvider } from '../models';
import { getCapabilities } from '../api/providers/registry';

export interface ApiKeyErrorMessageParams {
	/** The primary provider — the one whose failure blocks plugin init. */
	provider: ModelProvider;
	lastInitError: string | null;
	apiKeySecretName: string;
	ollamaBaseUrl: string;
}

/**
 * A captured init-time error is provider-agnostic and more specific than any
 * generic fallback, so it wins regardless of which provider is active.
 *
 * Otherwise the guidance follows the *primary* provider: a keyless primary that
 * failed to start points at its daemon, a key-requiring one points at the key.
 * Per-use-case overrides don't participate — a broken override degrades that one
 * feature, it doesn't stop the plugin from initializing.
 */
export function getApiKeyErrorMessage(params: ApiKeyErrorMessageParams): string {
	if (params.lastInitError) {
		return t('notice.main.initFailedFix', { error: params.lastInitError });
	}
	if (!getCapabilities(params.provider).requiresApiKey) {
		return t('notice.main.ollamaUnreachable', { url: params.ollamaBaseUrl });
	}
	if (!params.apiKeySecretName) {
		return t('notice.main.noApiKey');
	}
	return t('notice.main.apiKeyRetrieveFailed');
}
