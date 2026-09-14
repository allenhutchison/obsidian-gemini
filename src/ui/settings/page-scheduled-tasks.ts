import { Notice } from 'obsidian';
import type { SettingDefinitionPage } from 'obsidian';
import { t } from '../../i18n';
import { getErrorMessage } from '../../utils/error-utils';
import type { SettingsContext } from './context';

/**
 * Scheduled tasks settings sub-page (settings-redesign design doc §5.4/§5.5).
 *
 * Ex-`settings-automation.ts`'s scheduler half. Entry points into the
 * existing `SchedulerManagementModal` (unchanged, dynamically imported as
 * before) plus the one setting that lived alongside it, "Auto-run missed
 * tasks on startup".
 */
export function scheduledTasksPage(ctx: SettingsContext): SettingDefinitionPage {
	const { app, plugin } = ctx;

	return {
		type: 'page',
		name: t('settings.main.scheduledTasksName'),
		displayValue: () => {
			const count = plugin.scheduledTaskManager?.getTasks().length ?? 0;
			return count === 1
				? t('settings.automation.taskCountSingular', { count })
				: t('settings.automation.taskCount', { count });
		},
		items: [
			{
				name: t('settings.automation.manageScheduledTasksName'),
				desc: t('settings.automation.manageScheduledTasksDesc'),
				action: () => {
					void openScheduler(app, plugin, 'list');
				},
			},
			{
				name: t('settings.automation.newTaskName'),
				desc: t('settings.automation.newTaskDesc'),
				action: () => {
					void openScheduler(app, plugin, 'create');
				},
			},
			{
				name: t('settings.automation.autoRunCatchUpName'),
				desc: t('settings.automation.autoRunCatchUpDesc'),
				control: { type: 'toggle', key: 'autoRunCatchUp' },
			},
		],
	};
}

async function openScheduler(
	app: SettingsContext['app'],
	plugin: SettingsContext['plugin'],
	view: 'list' | 'create'
): Promise<void> {
	try {
		const { SchedulerManagementModal } = await import('../scheduler-management-modal');
		new SchedulerManagementModal(app, plugin, view).open();
	} catch (error) {
		plugin.logger.error('Failed to load scheduler management modal:', error);
		new Notice(t('settings.automation.openSchedulerFailed', { error: getErrorMessage(error) }));
	}
}
