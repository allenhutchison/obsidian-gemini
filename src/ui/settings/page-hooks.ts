import { Notice } from 'obsidian';
import type { SettingDefinitionPage } from 'obsidian';
import { t } from '../../i18n';
import { getErrorMessage } from '../../utils/error-utils';
import type { SettingsContext } from './context';

/**
 * Lifecycle hooks settings sub-page (settings-redesign design doc §5.4/§5.5).
 *
 * Ex-`settings-automation.ts`'s hooks half. The enable toggle is the page's
 * first row (brief §5); the manage/new entry points into the existing
 * `HookManagementModal` only show once hooks are enabled.
 */
export function hooksPage(ctx: SettingsContext): SettingDefinitionPage {
	const { app, plugin } = ctx;

	return {
		type: 'page',
		name: t('settings.main.lifecycleHooksName'),
		displayValue: () =>
			plugin.settings.hooksEnabled ? t('settings.automation.hooksStatusOn') : t('settings.automation.hooksStatusOff'),
		items: [
			{
				name: t('settings.automation.enableHooksName'),
				desc: t('settings.automation.enableHooksDesc'),
				control: { type: 'toggle', key: 'hooksEnabled' },
			},
			{
				name: t('settings.automation.manageHooksName'),
				desc: t('settings.automation.manageHooksDesc'),
				visible: () => plugin.settings.hooksEnabled,
				action: () => {
					void openHookManager(app, plugin, 'list');
				},
			},
			{
				name: t('settings.automation.newHookName'),
				desc: t('settings.automation.newHookDesc'),
				visible: () => plugin.settings.hooksEnabled,
				action: () => {
					void openHookManager(app, plugin, 'create');
				},
			},
		],
	};
}

async function openHookManager(
	app: SettingsContext['app'],
	plugin: SettingsContext['plugin'],
	view: 'list' | 'create'
): Promise<void> {
	try {
		const { HookManagementModal } = await import('../hook-management-modal');
		new HookManagementModal(app, plugin, view).open();
	} catch (error) {
		plugin.logger.error('Failed to load hook management modal:', error);
		new Notice(t('settings.automation.openHookManagerFailed', { error: getErrorMessage(error) }));
	}
}
