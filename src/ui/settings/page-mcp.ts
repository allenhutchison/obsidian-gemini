// WP2 STUB — replaced by WP3 at integration
/**
 * Placeholder for the MCP servers sub-page (settings-redesign design doc
 * §5.4). WP3 owns this file's real content (a native `SettingDefinitionList`
 * over `settings.mcpServers` with add/edit/delete); this stub only keeps
 * `master` building and lets WP2 wire the top-level tab's navigation entry.
 */

import type { SettingDefinitionPage } from 'obsidian';
import { t } from '../../i18n';
import type { SettingsContext } from './context';

export function mcpPage(_ctx: SettingsContext): SettingDefinitionPage {
	return {
		type: 'page',
		name: t('settings.main.mcpServersName'),
		items: [],
	};
}
