import { App, PluginSettingTab } from 'obsidian';
import type { SettingDefinitionItem } from 'obsidian';
import type { ObsidianGemini } from '../../types/plugin';
import { t } from '../../i18n';
import type { SettingsContext, SettingsTabHandle } from './context';
import { readControlValue, writeSettingPath, resolveWriter } from './paths';
import { providersPage } from './page-providers';
import { featuresPage } from './page-features';
import { vaultIndexPage } from './page-vault-index';
import { scheduledTasksPage } from './page-scheduled-tasks';
import { hooksPage } from './page-hooks';
import { mcpPage } from './page-mcp';
import { toolPermissionsPage } from './page-tool-permissions';
import { advancedPage } from './page-advanced';

/**
 * Settings tab, rebuilt on Obsidian 1.13's declarative `getSettingDefinitions()`
 * API (settings redesign; replaces the imperative `display()` tree that used
 * to live in `settings.ts` + eight `settings-*.ts` section modules — all
 * deleted).
 *
 * 13 top-level rows in 5 groups (design doc §5.4): Providers · Features |
 * Chat: Your name, Keep session history, Review a diff | Vault: Vault
 * search index, Plugin folder | Automation: Scheduled tasks, Lifecycle
 * hooks, MCP servers | Tool permissions · Advanced · Documentation.
 */
export default class ObsidianGeminiSettingTab extends PluginSettingTab implements SettingsTabHandle {
	plugin: ObsidianGemini;

	constructor(app: App, plugin: ObsidianGemini) {
		super(app, plugin);
		this.plugin = plugin;
	}

	private context(): SettingsContext {
		return { plugin: this.plugin, app: this.app, tab: this };
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const ctx = this.context();
		return [
			providersPage(ctx),
			featuresPage(ctx),
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
					vaultIndexPage(ctx),
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
				items: [scheduledTasksPage(ctx), hooksPage(ctx), mcpPage(ctx)],
			},
			toolPermissionsPage(ctx),
			advancedPage(ctx),
			{
				name: t('settings.main.documentationName'),
				desc: t('settings.main.documentationDesc'),
				action: () => {
					window.open('https://allenhutchison.github.io/obsidian-gemini/', '_blank');
				},
			},
		];
	}

	/**
	 * Reads from `plugin.settings` by dotted path (`paths.ts`). The one
	 * exception, `toolPolicy.toolPermissions.<tool>`, returns the *effective*
	 * permission — what the dropdown must show under a named preset — rather
	 * than the sparse override map's raw value (design doc §5.2).
	 */
	getControlValue(key: string): unknown {
		const toolMatch = /^toolPolicy\.toolPermissions\.(.+)$/.exec(key);
		if (toolMatch) {
			return this.plugin.toolRegistry.getEffectivePermission(toolMatch[1]);
		}
		return readControlValue(this.plugin.settings, key);
	}

	/**
	 * Writes through the matching `SETTING_WRITERS` entry (longest-prefix
	 * match), falling back to the plain-assignment `writeSettingPath`. Always
	 * persists via `saveSettings()`, then calls `update()` (structural
	 * change) or `refreshDomState()` (predicate-only change) per the writer's
	 * `needsUpdate` result.
	 */
	async setControlValue(key: string, value: unknown): Promise<void> {
		const writer = resolveWriter(key);
		let needsUpdate = false;
		if (writer) {
			const result = await writer(this.plugin, key, value);
			needsUpdate = result.needsUpdate;
		} else if (!writeSettingPath(this.plugin.settings, key, value)) {
			this.plugin.logger.warn(`[Settings] No writer registered for control key '${key}'`);
			return;
		}
		// Rebuild before persisting: a routing change makes `saveSettings()`
		// await a full re-initialization (model lists, RAG, MCP), and the
		// dependent controls — a feature's model dropdown after its provider
		// changes — must not keep showing the previous provider's list for the
		// seconds that takes.
		if (needsUpdate) {
			this.update();
		}
		await this.plugin.saveSettings();
		// Rebuild again after re-initialization so anything it refreshed (a
		// provider's fetched model list, connection state) is reflected.
		if (needsUpdate) {
			this.update();
		} else {
			this.refreshDomState();
		}
	}
}
