import type { ObsidianGemini } from '../types/plugin';
import { App, PluginSettingTab } from 'obsidian';
import { renderGeneralSettings } from './settings-general';
import { renderUISettings } from './settings-ui';
import { renderAutomationSettings } from './settings-automation';
import { renderAgentConfigSettings } from './settings-agent-config';
import { renderToolSettings } from './settings-tools';
import { renderMCPSettings } from './settings-mcp';
import { renderRAGSettings } from './settings-rag';
import { renderDebugSettings } from './settings-debug';

export type { SettingsSectionContext } from './settings-helpers';
import type { SettingsSectionContext } from './settings-helpers';

export default class ObsidianGeminiSettingTab extends PluginSettingTab {
	plugin: ObsidianGemini;
	private showDeveloperSettings = false;
	private renderToken = 0;

	constructor(app: App, plugin: ObsidianGemini) {
		super(app, plugin);
		this.plugin = plugin;
	}

	// PluginSettingTab.display() must return void; delegate the async rendering
	// to a fire-and-forget helper. The redisplay callback below also calls the
	// void-returning display(), matching the void-typed `redisplay` contract.
	display(): void {
		void this.renderSettings();
	}

	private async renderSettings(): Promise<void> {
		// Each call claims a fresh token; concurrent calls (e.g. Obsidian opening
		// the tab while a redisplay() is mid-await) compare against this and bail
		// out before re-appending into the now-cleared container.
		const token = ++this.renderToken;
		const { containerEl } = this;

		containerEl.empty();

		const context: SettingsSectionContext = {
			// `PluginSettingTab.display()` is deprecated in favor of the declarative
			// `getSettingDefinitions()` (Obsidian 1.13.0). Migrating this settings tree to the
			// new API is a large rework tracked separately and out of scope for #1040; the
			// imperative `display()` override remains the supported pattern meanwhile.
			// eslint-disable-next-line @typescript-eslint/no-deprecated -- display() migration to getSettingDefinitions() is out of scope for #1040
			redisplay: () => this.display(),
			showDeveloperSettings: this.showDeveloperSettings,
			setShowDeveloperSettings: (value: boolean) => {
				this.showDeveloperSettings = value;
			},
		};

		await renderGeneralSettings(containerEl, this.plugin, this.app, context);
		if (token !== this.renderToken) return;
		renderUISettings(containerEl, this.plugin);
		renderAutomationSettings(containerEl, this.plugin, this.app);
		await renderRAGSettings(containerEl, this.plugin, this.app, context);
		if (token !== this.renderToken) return;

		if (this.showDeveloperSettings) {
			await renderToolSettings(containerEl, this.plugin, this.app, context);
			if (token !== this.renderToken) return;
			await renderMCPSettings(containerEl, this.plugin, this.app, context);
			if (token !== this.renderToken) return;
			await renderAgentConfigSettings(containerEl, this.plugin, context);
			if (token !== this.renderToken) return;
			renderDebugSettings(containerEl, this.plugin);
		}
	}
}
