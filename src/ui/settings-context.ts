import type ObsidianGemini from '../main';
import { Setting } from 'obsidian';

export function renderContextSettings(containerEl: HTMLElement, plugin: ObsidianGemini): void {
	new Setting(containerEl).setName('Context Management').setHeading();

	const thresholdSetting = new Setting(containerEl)
		.setName('Context compaction threshold')
		.setDesc(
			`Automatically summarize older conversation turns when token usage exceeds this percentage of the model context window. Current: ${plugin.settings.contextCompactionThreshold}%`
		);

	thresholdSetting.addSlider((slider) =>
		slider
			.setLimits(5, 50, 5)
			.setValue(plugin.settings.contextCompactionThreshold)
			.setDynamicTooltip()
			.onChange(async (value) => {
				plugin.settings.contextCompactionThreshold = value;
				thresholdSetting.setDesc(
					`Automatically summarize older conversation turns when token usage exceeds this percentage of the model context window. Current: ${value}%`
				);
				await plugin.saveSettings();
			})
	);

	new Setting(containerEl)
		.setName('Show token usage')
		.setDesc('Display estimated token usage in the agent view (for debugging purposes).')
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.showTokenUsage).onChange(async (value) => {
				plugin.settings.showTokenUsage = value;
				await plugin.saveSettings();
			})
		);
}
