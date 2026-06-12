import type ObsidianGemini from '../main';
import { Setting } from 'obsidian';
import { createCollapsibleSection } from './settings-helpers';
import { t } from '../i18n';

export function renderDebugSettings(containerEl: HTMLElement, plugin: ObsidianGemini): void {
	const sectionEl = createCollapsibleSection(plugin, containerEl, t('settings.debug.sectionTitle'), 'debug', {
		description: t('settings.debug.sectionDesc'),
		advanced: true,
	});

	new Setting(sectionEl)
		.setName(t('settings.debug.debugModeName'))
		.setDesc(t('settings.debug.debugModeDesc'))
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.debugMode).onChange(async (value) => {
				plugin.settings.debugMode = value;
				await plugin.saveSettings();
			})
		);

	new Setting(sectionEl)
		.setName(t('settings.debug.showTokenUsageName'))
		.setDesc(t('settings.debug.showTokenUsageDesc'))
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.showTokenUsage).onChange(async (value) => {
				plugin.settings.showTokenUsage = value;
				await plugin.saveSettings();
			})
		);

	new Setting(sectionEl)
		.setName(t('settings.debug.stopOnToolErrorName'))
		.setDesc(t('settings.debug.stopOnToolErrorDesc'))
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.stopOnToolError).onChange(async (value) => {
				plugin.settings.stopOnToolError = value;
				await plugin.saveSettings();
			})
		);
}
