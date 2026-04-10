import type ObsidianGemini from '../main';
import { App, Notice, Setting, SecretComponent, debounce } from 'obsidian';
import { selectModelSetting } from './settings-helpers';
import { FolderSuggest } from './folder-suggest';
import { getErrorMessage } from '../utils/error-utils';

export async function renderGeneralSettings(containerEl: HTMLElement, plugin: ObsidianGemini, app: App): Promise<void> {
	// Debounce saveSettings() to avoid re-running the plugin lifecycle on every keystroke
	// in text inputs. In-memory settings are mutated immediately so the UI stays responsive.
	// The callback is async + wrapped in try/catch so rejections from saveSettings() don't
	// become unhandled promise rejections.
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

	// Documentation button at the top
	new Setting(containerEl)
		.setName('Documentation')
		.setDesc('View the complete plugin documentation and guides')
		.addButton((button) =>
			button.setButtonText('View Documentation').onClick(() => {
				window.open('https://github.com/allenhutchison/obsidian-gemini/tree/master/docs', '_blank');
			})
		);

	new Setting(containerEl)
		.setName('API Key')
		.setDesc(
			'Link your Google Gemini API key. Click "Link..." and Obsidian will ask for a Secret Name (this is just a label — use any name like "gemini-api") and a Secret Value (paste your API key here). Get a key free at https://aistudio.google.com/apikey'
		)
		.addComponent((el) =>
			new SecretComponent(app, el).setValue(plugin.settings.apiKeySecretName).onChange(async (secretName) => {
				plugin.settings.apiKeySecretName = secretName;
				await plugin.saveSettings();
			})
		);

	// Add note about model version filtering
	new Setting(containerEl)
		.setName('Model Versions')
		.setDesc(
			'ℹ️ Only Gemini 2.5+ models are shown. Older model versions have been deprecated by Google and are no longer supported.'
		)
		.addButton((button) =>
			button.setButtonText('Learn More').onClick(() => {
				window.open('https://ai.google.dev/gemini-api/docs/models/gemini');
			})
		);

	await selectModelSetting(
		containerEl,
		plugin,
		'chatModelName',
		'Chat Model',
		'Model used for agent chat sessions, selection rewriting, and web search tools.'
	);
	await selectModelSetting(
		containerEl,
		plugin,
		'summaryModelName',
		'Summary Model',
		'Model used for the "Summarize Active File" command that adds summaries to frontmatter.'
	);
	await selectModelSetting(
		containerEl,
		plugin,
		'completionsModelName',
		'Completion Model',
		'Model used for IDE-style inline completions as you type in notes.'
	);
	await selectModelSetting(
		containerEl,
		plugin,
		'imageModelName',
		'Image Model',
		'Model used for image generation.',
		'image'
	);

	new Setting(containerEl)
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

	new Setting(containerEl)
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

	// Plugin State Folder
	new Setting(containerEl)
		.setName('Plugin State Folder')
		.setDesc(
			'Folder where plugin data is stored. Agent sessions are saved in Agent-Sessions/, custom prompts in Prompts/.'
		)
		.addText((text) => {
			new FolderSuggest(app, text.inputEl, (folder) => {
				plugin.settings.historyFolder = folder;
				debouncedSave();
			});
			text.setValue(plugin.settings.historyFolder);
		});

	// Session History
	new Setting(containerEl).setName('Session History').setHeading();

	new Setting(containerEl)
		.setName('Enable Session History')
		.setDesc(
			'Store agent session history as markdown files in your vault. Sessions are automatically saved in the Agent-Sessions subfolder with auto-generated titles based on conversation content.'
		)
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.chatHistory).onChange(async (value) => {
				plugin.settings.chatHistory = value;
				await plugin.saveSettings();
			})
		);
}
