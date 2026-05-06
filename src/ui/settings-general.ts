import type ObsidianGemini from '../main';
import { App, Notice, Setting, SecretComponent, debounce } from 'obsidian';
import { createAlwaysOpenSection, selectModelSetting } from './settings-helpers';
import { FolderSuggest } from './folder-suggest';
import { getErrorMessage } from '../utils/error-utils';
import type { SettingsSectionContext } from './settings';

export async function renderGeneralSettings(
	containerEl: HTMLElement,
	plugin: ObsidianGemini,
	app: App,
	context: SettingsSectionContext
): Promise<void> {
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

	const generalEl = createAlwaysOpenSection(
		containerEl,
		'General',
		'Set up your provider, API key, and the models the plugin uses. Required for the plugin to work.'
	);
	await renderGeneralSection(generalEl, plugin, app, context, debouncedSave);
}

/**
 * Render the contents of the "General" section. Extracted so provider-specific
 * fields can be re-rendered (on Provider change / Refresh model list) without
 * tearing down the surrounding settings tab.
 */
async function renderGeneralSection(
	sectionEl: HTMLElement,
	plugin: ObsidianGemini,
	app: App,
	context: SettingsSectionContext,
	debouncedSave: () => void
): Promise<void> {
	new Setting(sectionEl)
		.setName('Documentation')
		.setDesc('View the complete plugin documentation and guides')
		.addButton((button) =>
			button.setButtonText('View Documentation').onClick(() => {
				window.open('https://allenhutchison.github.io/obsidian-gemini/', '_blank');
			})
		);

	new Setting(sectionEl)
		.setName('Provider')
		.setDesc(
			'Choose the model provider. Gemini uses the Google cloud API. Ollama runs models locally on your machine; install from https://ollama.com and pull a model with `ollama pull <name>`.'
		)
		.addDropdown((dropdown) =>
			dropdown
				.addOption('gemini', 'Google Gemini (cloud)')
				.addOption('ollama', 'Ollama (local)')
				.setValue(plugin.settings.provider)
				.onChange(async (value) => {
					plugin.settings.provider = value as 'gemini' | 'ollama';
					await plugin.saveSettings();
					// Re-render only the General section so provider-specific fields show/hide
					// without tearing down sections rendered later in the settings tab.
					sectionEl.empty();
					await renderGeneralSection(sectionEl, plugin, app, context, debouncedSave);
				})
		);

	if (plugin.settings.provider === 'ollama') {
		new Setting(sectionEl)
			.setName('Ollama Base URL')
			.setDesc('HTTP endpoint of your local Ollama daemon. Default is http://localhost:11434.')
			.addText((text) =>
				text
					.setPlaceholder('http://localhost:11434')
					.setValue(plugin.settings.ollamaBaseUrl)
					.onChange((value) => {
						plugin.settings.ollamaBaseUrl = value.trim() || 'http://localhost:11434';
						debouncedSave();
					})
			);

		new Setting(sectionEl)
			.setName('Refresh model list')
			.setDesc('Re-query the Ollama daemon for available models.')
			.addButton((button) =>
				button.setButtonText('Refresh').onClick(async () => {
					try {
						const manager = plugin.getModelManager();
						manager.getOllamaModelsService().invalidate();
						const models = await manager.getAvailableModels({ forceRefresh: true });
						new Notice(`Found ${models.length} Ollama model${models.length === 1 ? '' : 's'}.`);
						sectionEl.empty();
						await renderGeneralSection(sectionEl, plugin, app, context, debouncedSave);
					} catch (error) {
						new Notice(`Failed to refresh: ${getErrorMessage(error)}`);
					}
				})
			);

		new Setting(sectionEl)
			.setName('Local-only feature notice')
			.setDesc(
				'Google Search, URL Context (web fetch), Deep Research, image generation, and RAG indexing are unavailable when using Ollama. They rely on Gemini built-in services.'
			);
	} else {
		new Setting(sectionEl)
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
	}

	await selectModelSetting(
		sectionEl,
		plugin,
		'chatModelName',
		'Chat Model',
		'Model used for agent chat sessions, selection rewriting, and web search tools.'
	);
	await selectModelSetting(
		sectionEl,
		plugin,
		'summaryModelName',
		'Summary Model',
		'Model used for the "Summarize Active File" command that adds summaries to frontmatter.'
	);
	await selectModelSetting(
		sectionEl,
		plugin,
		'completionsModelName',
		'Completion Model',
		'Model used for IDE-style inline completions as you type in notes.'
	);
	if (plugin.settings.provider === 'gemini') {
		await selectModelSetting(
			sectionEl,
			plugin,
			'imageModelName',
			'Image Model',
			'Model used for image generation.',
			'image'
		);
	}

	new Setting(sectionEl)
		.setName('Plugin State Folder')
		.setDesc(
			'Folder where plugin data is stored. Agent sessions live under Agent-Sessions/, custom prompts under Prompts/, hooks under Hooks/, scheduled task state under Scheduled-Tasks/.'
		)
		.addText((text) => {
			new FolderSuggest(app, text.inputEl, (folder) => {
				plugin.settings.historyFolder = folder;
				debouncedSave();
			});
			text.setValue(plugin.settings.historyFolder);
		});

	new Setting(sectionEl)
		.setName('Show Advanced Settings')
		.setDesc(
			'Reveal advanced sections (Custom Prompts, API Configuration, Tool Permissions, Tool Loop Detection, MCP Servers, Debug) for power users.'
		)
		.addToggle((toggle) =>
			toggle.setValue(context.showDeveloperSettings).onChange((value) => {
				context.setShowDeveloperSettings(value);
				context.redisplay();
			})
		);
}
