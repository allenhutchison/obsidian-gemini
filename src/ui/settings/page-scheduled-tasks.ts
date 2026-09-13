// WP2 STUB — replaced by WP3 at integration
/**
 * Placeholder for the Scheduled tasks sub-page (settings-redesign design doc
 * §5.4). WP3 owns this file's real content ("Open scheduler" / "New task"
 * actions opening `SchedulerManagementModal`, plus the auto-run-catch-up
 * toggle); this stub only keeps `master` building and lets WP2 wire the
 * top-level tab's navigation entry.
 */

import type { SettingDefinitionPage } from 'obsidian';
import { t } from '../../i18n';
import type { SettingsContext } from './context';

export function scheduledTasksPage(_ctx: SettingsContext): SettingDefinitionPage {
	return {
		type: 'page',
		name: t('settings.main.scheduledTasksName'),
		items: [],
	};
}
