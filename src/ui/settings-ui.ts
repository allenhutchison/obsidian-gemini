import type ObsidianGemini from '../main';
import { Setting, ToggleComponent, debounce, Notice } from 'obsidian';
import { createCollapsibleSection } from './settings-helpers';
import { getErrorMessage } from '../utils/error-utils';

export function renderUISettings(containerEl: HTMLElement, plugin: ObsidianGemini): void {
	const sectionEl = createCollapsibleSection(plugin, containerEl, 'User Experience', 'ui', {
		description:
			'Streaming, diff view, scheduler catch-up, and personalization options that affect how you interact with the plugin.',
	});

	const debouncedSave = debounce(
		async () => {
			try {
				await plugin.saveSettings();
			} catch (error) {
				plugin.logger.error('Failed to save settings:', error);
				new Notice(`Failed to save settings: ${getErrorMessage(error)}`);
			}
		},
		300,
		true
	);

	new Setting(sectionEl)
		.setName('Your Name')
		.setDesc('Your name used in system instructions so the AI can address you personally in conversations.')
		.addText((text) =>
			text
				.setPlaceholder('Enter your name')
				.setValue(plugin.settings.userName)
				.onChange((value) => {
					plugin.settings.userName = value;
					debouncedSave();
				})
		);

	new Setting(sectionEl)
		.setName('Summary Frontmatter Key')
		.setDesc('Frontmatter property name where summaries are stored when using "Summarize Active File" command.')
		.addText((text) =>
			text
				.setPlaceholder('summary')
				.setValue(plugin.settings.summaryFrontmatterKey)
				.onChange((value) => {
					plugin.settings.summaryFrontmatterKey = value;
					debouncedSave();
				})
		);

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

	// Hold a reference to the dependent "Log tool execution" toggle so we can
	// flip its disabled state when Session History is toggled off — there's
	// nowhere to log to when sessions aren't being persisted.
	let logToolExecutionToggle: ToggleComponent | null = null;

	new Setting(sectionEl)
		.setName('Enable Session History')
		.setDesc(
			'Persist agent chat sessions as markdown files in your vault. Sessions are saved under Agent-Sessions/ with auto-generated titles.'
		)
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.chatHistory).onChange(async (value) => {
				plugin.settings.chatHistory = value;
				await plugin.saveSettings();
				logToolExecutionToggle?.setDisabled(!value);
			})
		);

	new Setting(sectionEl)
		.setName('Log tool execution to session history')
		.setDesc(
			'Append a summary of each tool execution to the session history file for auditing. Requires Session History to be enabled. Requires plugin reload to take effect.'
		)
		.addToggle((toggle) => {
			toggle
				.setValue(plugin.settings.logToolExecution)
				.setDisabled(!plugin.settings.chatHistory)
				.onChange(async (value) => {
					plugin.settings.logToolExecution = value;
					await plugin.saveSettings();
				});
			logToolExecutionToggle = toggle;
		});
}
