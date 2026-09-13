// WP2 STUB — replaced by WP3 at integration
/**
 * Placeholder for the Vault search index sub-page (settings-redesign design
 * doc §5.4). WP3 owns this file's real content (RAG indexing toggle, status
 * row, exclude-folders textarea, …); this stub only keeps `master` building
 * and lets WP2 wire the top-level tab's navigation entry.
 */

import type { SettingDefinitionPage } from 'obsidian';
import { t } from '../../i18n';
import type { SettingsContext } from './context';
import type { SettingWriter } from './writer-types';

export function vaultIndexPage(_ctx: SettingsContext): SettingDefinitionPage {
	return {
		type: 'page',
		name: t('settings.main.vaultSearchIndexName'),
		items: [],
	};
}

/** WP3 contributes `ragIndexing.enabled` / `ragIndexing.excludeFolders` writers here. */
export const RAG_WRITERS: Record<string, SettingWriter> = {};
