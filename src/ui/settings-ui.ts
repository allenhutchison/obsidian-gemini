import type ObsidianGemini from '../main';
import { Setting } from 'obsidian';
import { createCollapsibleSection } from './settings-helpers';

export function renderUISettings(containerEl: HTMLElement, plugin: ObsidianGemini): void {
	const sectionEl = createCollapsibleSection(plugin, containerEl, 'UI Settings', 'ui');

	new Setting(sectionEl)
		.setName('Enable Streaming')
		.setDesc('Stream AI responses word-by-word as they are generated for a more interactive chat experience.')
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.streamingEnabled).onChange(async (value) => {
				plugin.settings.streamingEnabled = value;
				await plugin.saveSettings();
			})
		);

	new Setting(sectionEl)
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

	new Setting(sectionEl)
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

	new Setting(sectionEl)
		.setName('Auto-run missed scheduled tasks on startup')
		.setDesc(
			'When enabled, tasks that were missed while Obsidian was closed (and have "Run if missed" set) are submitted automatically on startup without showing the approval modal.'
		)
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.autoRunCatchUp).onChange(async (value) => {
				plugin.settings.autoRunCatchUp = value;
				await plugin.saveSettings();
			})
		);
}
