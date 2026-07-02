/**
 * Builds the user-facing message for "plugin isn't usable right now" cases
 * (guarded commands, ribbon icon) shared by every provider.
 */

import { t } from '../i18n';
import type { ModelProvider } from '../models';

export interface ApiKeyErrorMessageParams {
	provider: ModelProvider;
	lastInitError: string | null;
	apiKeySecretName: string;
	ollamaBaseUrl: string;
}

/**
 * A captured init-time error is provider-agnostic and more specific than any
 * generic fallback, so it wins regardless of which provider is active.
 */
export function getApiKeyErrorMessage(params: ApiKeyErrorMessageParams): string {
	if (params.lastInitError) {
		return t('notice.main.initFailedFix', { error: params.lastInitError });
	}
	if (params.provider === 'ollama') {
		return t('notice.main.ollamaUnreachable', { url: params.ollamaBaseUrl });
	}
	if (!params.apiKeySecretName) {
		return t('notice.main.noApiKey');
	}
	return t('notice.main.apiKeyRetrieveFailed');
}
