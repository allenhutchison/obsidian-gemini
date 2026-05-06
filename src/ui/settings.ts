import type ObsidianGemini from '../main';
import { App, PluginSettingTab } from 'obsidian';
import { renderGeneralSettings } from './settings-general';
import { renderUISettings } from './settings-ui';
import { renderAutomationSettings } from './settings-automation';
import { renderAgentConfigSettings } from './settings-agent-config';
import { renderToolSettings } from './settings-tools';
import { renderMCPSettings } from './settings-mcp';
import { renderRAGSettings } from './settings-rag';
import { renderDebugSettings } from './settings-debug';

export interface SettingsSectionContext {
	/** Call to trigger a full re-render of the settings tab */
	redisplay: () => void;
	/** Whether advanced settings are currently visible */
	showDeveloperSettings: boolean;
	/** Update the show-advanced flag from inside a section (e.g. the toggle in General). */
	setShowDeveloperSettings: (value: boolean) => void;
}

export default class ObsidianGeminiSettingTab extends PluginSettingTab {
	plugin: ObsidianGemini;
	private showDeveloperSettings = false;
	private renderToken = 0;

	constructor(app: App, plugin: ObsidianGemini) {
		super(app, plugin);
		this.plugin = plugin;
	}

	async display(): Promise<void> {
		// Each call claims a fresh token; concurrent calls (e.g. Obsidian opening
		// the tab while a redisplay() is mid-await) compare against this and bail
		// out before re-appending into the now-cleared container.
		const token = ++this.renderToken;
		const { containerEl } = this;

		containerEl.empty();

		const context: SettingsSectionContext = {
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
			await renderAgentConfigSettings(containerEl, this.plugin, context);
			if (token !== this.renderToken) return;
			await renderToolSettings(containerEl, this.plugin, this.app, context);
			if (token !== this.renderToken) return;
			await renderMCPSettings(containerEl, this.plugin, this.app, context);
			if (token !== this.renderToken) return;
			renderDebugSettings(containerEl, this.plugin);
		}
	}
}
