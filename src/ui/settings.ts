import type ObsidianGemini from '../main';
import { App, PluginSettingTab, Setting } from 'obsidian';
import { renderGeneralSettings } from './settings-general';
import { renderUISettings } from './settings-ui';
import { renderContextSettings } from './settings-context';
import { renderApiSettings } from './settings-api';
import { renderToolSettings } from './settings-tools';
import { renderMCPSettings } from './settings-mcp';
import { renderRAGSettings } from './settings-rag';

export interface SettingsSectionContext {
	/** Call to trigger a full re-render of the settings tab */
	redisplay: () => void;
	/** Whether advanced settings are currently visible */
	showDeveloperSettings: boolean;
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
		};

		await renderGeneralSettings(containerEl, this.plugin, this.app);
		if (token !== this.renderToken) return;
		renderUISettings(containerEl, this.plugin);
		renderContextSettings(containerEl, this.plugin);

		// Advanced toggle + debug mode stay here (they control class state)
		this.renderAdvancedToggle(containerEl);

		if (this.showDeveloperSettings) {
			await renderApiSettings(containerEl, this.plugin, context);
			if (token !== this.renderToken) return;
			await renderToolSettings(containerEl, this.plugin, this.app, context);
			if (token !== this.renderToken) return;
			await renderMCPSettings(containerEl, this.plugin, this.app, context);
			if (token !== this.renderToken) return;
			await renderRAGSettings(containerEl, this.plugin, this.app, context);
		}
	}

	private renderAdvancedToggle(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Advanced Settings').setHeading();

		new Setting(containerEl)
			.setName('Debug Mode')
			.setDesc('Enable debug logging to the console. Useful for troubleshooting.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.debugMode).onChange(async (value) => {
					this.plugin.settings.debugMode = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('Show Advanced Settings')
			.setDesc('Reveal advanced settings for power users.')
			.addButton((button) =>
				button
					.setButtonText(this.showDeveloperSettings ? 'Hide Advanced Settings' : 'Show Advanced Settings')
					.setClass(this.showDeveloperSettings ? 'mod-warning' : 'mod-cta')
					.onClick(() => {
						this.showDeveloperSettings = !this.showDeveloperSettings;
						this.display();
					})
			);
	}
}
