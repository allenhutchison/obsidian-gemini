import type ObsidianGemini from '../main';
import { Setting } from 'obsidian';
import { createCollapsibleSection } from './settings-helpers';

export function renderDebugSettings(containerEl: HTMLElement, plugin: ObsidianGemini): void {
	const sectionEl = createCollapsibleSection(plugin, containerEl, 'Debug', 'debug', {
		description: 'Diagnostic toggles for troubleshooting plugin behavior.',
		advanced: true,
	});

	new Setting(sectionEl)
		.setName('Debug Mode')
		.setDesc('Enable debug logging to the console. Useful for troubleshooting.')
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.debugMode).onChange(async (value) => {
				plugin.settings.debugMode = value;
				await plugin.saveSettings();
			})
		);

	new Setting(sectionEl)
		.setName('Show token usage')
		.setDesc('Display estimated token usage in the agent view (for debugging purposes).')
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.showTokenUsage).onChange(async (value) => {
				plugin.settings.showTokenUsage = value;
				await plugin.saveSettings();
			})
		);

	new Setting(sectionEl)
		.setName('Stop on tool error')
		.setDesc(
			'Stop agent execution when a tool call fails. If disabled, the agent will continue executing subsequent tools.'
		)
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.stopOnToolError).onChange(async (value) => {
				plugin.settings.stopOnToolError = value;
				await plugin.saveSettings();
			})
		);
}
