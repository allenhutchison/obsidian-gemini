// WP2 STUB — replaced by WP3 at integration
/**
 * Placeholder for the Lifecycle hooks sub-page (settings-redesign design doc
 * §5.4). WP3 owns this file's real content (the `hooksEnabled` toggle first,
 * then "Open hook manager" / "New hook" actions opening
 * `HookManagementModal`); this stub only keeps `master` building and lets
 * WP2 wire the top-level tab's navigation entry.
 */

import type { SettingDefinitionPage } from 'obsidian';
import { t } from '../../i18n';
import type { SettingsContext } from './context';

export function hooksPage(_ctx: SettingsContext): SettingDefinitionPage {
	return {
		type: 'page',
		name: t('settings.main.lifecycleHooksName'),
		items: [],
	};
}
