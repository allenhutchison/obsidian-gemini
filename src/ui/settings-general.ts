/**
 * @deprecated Transitional remnant of the deleted `settings-general.ts` (the
 * settings redesign rebuilds this content on the Providers page's Gemini card
 * — see the design doc §6.2). Kept only because `commands/register-commands.ts`
 * still imports `refreshGeminiModelList` from this exact path; that import
 * moves to its new home (or is inlined) when the runtime/settings-UI work
 * packages touch that file. Delete this file once nothing imports it.
 */

import { Notice } from 'obsidian';
import type { ObsidianGemini } from '../types/plugin';
import { getErrorMessage } from '../utils/error-utils';
import { t } from '../i18n';

export async function refreshGeminiModelList(
	plugin: ObsidianGemini,
	onSuccess?: () => void | Promise<void>
): Promise<void> {
	try {
		const result = await plugin.getModelManager().refreshRemoteModels();
		if (result.fetched) {
			new Notice(
				result.modelCount === 1
					? t('settings.general.modelListUpdatedSingular', { count: result.modelCount })
					: t('settings.general.modelListUpdated', { count: result.modelCount })
			);
			if (onSuccess) await onSuccess();
			return;
		}
		const reasonMessage =
			result.skippedReason === 'offline'
				? t('settings.general.refreshSkippedOffline')
				: t('settings.general.refreshSkippedNotGemini');
		new Notice(reasonMessage);
	} catch (error) {
		plugin.logger.error('Failed to refresh Gemini model list:', error);
		new Notice(t('settings.general.refreshModelListFailed', { error: getErrorMessage(error) }));
	}
}
