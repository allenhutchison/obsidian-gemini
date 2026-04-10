import ObsidianGemini from '../main';
import { Setting } from 'obsidian';

export function renderUISettings(containerEl: HTMLElement, plugin: InstanceType<typeof ObsidianGemini>): void {
	new Setting(containerEl).setName('UI Settings').setHeading();

	new Setting(containerEl)
		.setName('Enable Streaming')
		.setDesc('Stream AI responses word-by-word as they are generated for a more interactive chat experience.')
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.streamingEnabled).onChange(async (value) => {
				plugin.settings.streamingEnabled = value;
				await plugin.saveSettings();
			})
		);

	new Setting(containerEl)
		.setName('Always show diff view for file writes')
		.setDesc(
			'Automatically open a diff view when the agent proposes file changes, instead of requiring a button click.'
		)
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.alwaysShowDiffView).onChange(async (value) => {
				plugin.settings.alwaysShowDiffView = value;
				await plugin.saveSettings();
			})
		);

	new Setting(containerEl)
		.setName('Log tool execution to session history')
		.setDesc(
			'Append a summary of each tool execution to the session history file for auditing. Requires plugin reload to take effect.'
		)
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.logToolExecution).onChange(async (value) => {
				plugin.settings.logToolExecution = value;
				await plugin.saveSettings();
			})
		);
}
