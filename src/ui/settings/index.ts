import { App, PluginSettingTab } from 'obsidian';
import type { SettingDefinitionItem } from 'obsidian';
import type { ObsidianGemini } from '../../types/plugin';
import { t } from '../../i18n';

/**
 * Settings tab, rebuilt on Obsidian 1.13's declarative `getSettingDefinitions()`
 * API (settings redesign; replaces the imperative `display()` tree in the
 * now-deleted `settings.ts` + eight `settings-*.ts` section modules).
 *
 * **This is a placeholder.** It wires the 13 top-level rows from the design
 * (five non-page controls, eight sub-pages) so `master` keeps building while
 * the settings-UI work packages fill each sub-page in with real content —
 * every `page` entry below has an empty `items: []` until then. See the
 * settings-redesign design doc §10.3.
 */
export default class ObsidianGeminiSettingTab extends PluginSettingTab {
	plugin: ObsidianGemini;

	constructor(app: App, plugin: ObsidianGemini) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				type: 'page',
				name: t('settings.main.providersName'),
				items: [],
			},
			{
				type: 'page',
				name: t('settings.main.featuresName'),
				items: [],
			},
			{
				type: 'group',
				heading: t('settings.main.groupChat'),
				items: [
					{
						name: t('settings.main.yourNameName'),
						desc: t('settings.main.yourNameDesc'),
						control: { type: 'text', key: 'userName' },
					},
					{
						name: t('settings.main.keepSessionHistoryName'),
						desc: t('settings.main.keepSessionHistoryDesc'),
						control: { type: 'toggle', key: 'chatHistory' },
					},
					{
						name: t('settings.main.reviewDiffName'),
						desc: t('settings.main.reviewDiffDesc'),
						control: { type: 'toggle', key: 'alwaysShowDiffView' },
					},
				],
			},
			{
				type: 'group',
				heading: t('settings.main.groupVault'),
				items: [
					{
						type: 'page',
						name: t('settings.main.vaultSearchIndexName'),
						items: [],
					},
					{
						name: t('settings.main.pluginFolderName'),
						desc: t('settings.main.pluginFolderDesc'),
						control: { type: 'folder', key: 'historyFolder' },
					},
				],
			},
			{
				type: 'group',
				heading: t('settings.main.groupAutomation'),
				items: [
					{
						type: 'page',
						name: t('settings.main.scheduledTasksName'),
						items: [],
					},
					{
						type: 'page',
						name: t('settings.main.lifecycleHooksName'),
						items: [],
					},
					{
						type: 'page',
						name: t('settings.main.mcpServersName'),
						items: [],
					},
				],
			},
			{
				type: 'page',
				name: t('settings.main.toolPermissionsName'),
				items: [],
			},
			{
				type: 'page',
				name: t('settings.main.advancedName'),
				items: [],
			},
			{
				name: t('settings.main.documentationName'),
				desc: t('settings.main.documentationDesc'),
				action: () => {
					window.open('https://allenhutchison.github.io/obsidian-gemini/', '_blank');
				},
			},
		];
	}
}
