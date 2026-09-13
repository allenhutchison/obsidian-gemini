// WP2 STUB — replaced by WP3 at integration
/**
 * Placeholder for the Tool permissions sub-page (settings-redesign design
 * doc §7). WP3 owns this file's real content (preset dropdown + one
 * searchable group with classification filter pills over every registered
 * tool); this stub only keeps `master` building and lets WP2 wire the
 * top-level tab's navigation entry.
 */

import type { SettingDefinitionPage } from 'obsidian';
import { t } from '../../i18n';
import type { SettingsContext } from './context';
import type { SettingWriter } from './writer-types';

export function toolPermissionsPage(_ctx: SettingsContext): SettingDefinitionPage {
	return {
		type: 'page',
		name: t('settings.main.toolPermissionsName'),
		items: [],
	};
}

/** WP3 contributes `toolPolicy.activePreset` / `toolPolicy.toolPermissions.*` writers here. */
export const TOOL_POLICY_WRITERS: Record<string, SettingWriter> = {};
