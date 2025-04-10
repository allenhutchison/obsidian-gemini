import ObsidianGemini from '../../main';
import { App, PluginSettingTab, Setting } from 'obsidian';
import { selectModelSetting } from './settings-helpers';
import { FolderSuggest } from './folder-suggest';
import { DEFAULT_PROMPTS } from '../prompts';

export default class ObsidianGeminiSettingTab extends PluginSettingTab {
	plugin: ObsidianGemini;

	constructor(app: App, plugin: ObsidianGemini) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('API Key')
			.setDesc('Gemini API Key')
			.addText((text) =>
				text
					.setPlaceholder('Enter your API Key')
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value;
						await this.plugin.saveSettings();
					})
			);

		selectModelSetting(
			containerEl,
			this.plugin,
			'chatModelName',
			'Chat Model',
			'The Gemini Model used in the chat interface.'
		);
		selectModelSetting(
			containerEl,
			this.plugin,
			'summaryModelName',
			'Summary Model',
			'The Gemini Model used for summarization.'
		);
		selectModelSetting(
			containerEl,
			this.plugin,
			'completionsModelName',
			'Completion Model',
			'The Gemini Model used for completions.'
		);

		new Setting(containerEl)
			.setName('Context Depth')
			.setDesc(
				'Set to true to send the context of the current file to the model, and adjust the depth of links followed for the context.'
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption('0', '0')
					.addOption('1', '1')
					.addOption('2', '2')
					.addOption('3', '3')
					.addOption('4', '4')
					.setValue(this.plugin.settings.maxContextDepth.toString())
					.onChange(async (value) => {
						this.plugin.settings.maxContextDepth = parseInt(value);
						await this.plugin.saveSettings();
					})
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.sendContext).onChange(async (value) => {
					this.plugin.settings.sendContext = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('Search Grounding')
			.setDesc(
				'Enable the model to use Google search results in its responses, and the threshold for how likely it is to trigger.'
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption('0.1', '0.1')
					.addOption('0.2', '0.2')
					.addOption('0.3', '0.3')
					.addOption('0.4', '0.4')
					.addOption('0.5', '0.5')
					.addOption('0.6', '0.6')
					.addOption('0.7', '0.7')
					.addOption('0.8', '0.8')
					.addOption('0.9', '0.9')
					.setValue(this.plugin.settings.searchGroundingThreshold.toString())
					.onChange(async (value) => {
						this.plugin.settings.searchGroundingThreshold = parseFloat(value);
						await this.plugin.saveSettings();
					})
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.searchGrounding).onChange(async (value) => {
					this.plugin.settings.searchGrounding = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('Summary Frontmatter Key')
			.setDesc('Key to use for frontmatter summarization.')
			.addText((text) =>
				text
					.setPlaceholder('Enter your key')
					.setValue(this.plugin.settings.summaryFrontmatterKey)
					.onChange(async (value) => {
						this.plugin.settings.summaryFrontmatterKey = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Your name.')
			.setDesc('This will be used in the system instructions for the model.')
			.addText((text) =>
				text
					.setPlaceholder('Enter your name')
					.setValue(this.plugin.settings.userName)
					.onChange(async (value) => {
						this.plugin.settings.userName = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Rewrite Files')
			.setDesc('Whether to allow the model to rewrite files during chat.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.rewriteFiles).onChange(async (value) => {
					this.plugin.settings.rewriteFiles = value;
					await this.plugin.saveSettings();
				})
			);

		// Prompt Settings Section
		new Setting(containerEl).setName('Prompt Settings').setHeading();

		new Setting(containerEl)
			.setName('Prompt Mode')
			.setDesc('Select prompt mode')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('default', 'Default Prompts')
					.addOption('custom', 'Custom Prompts')
					.setValue(this.plugin.settings.promptMode || 'default')
					.onChange(async (value) => {
						this.plugin.settings.promptMode = value;
						await this.plugin.saveSettings();
						this.display();
					})
			);

		// If custom mode is enabled, show the text areas
		if (this.plugin.settings.promptMode === 'custom') {
			containerEl.createEl('h4', { text: 'Custom Prompts' });
			containerEl.createEl('p', {
				text: 'Edit the prompts below. If a field is left empty, the default prompt will be used.',
			});

			// Add Reset to Defaults button
			new Setting(containerEl)
				.setName('Reset to Default Prompts')
				.setDesc('Reset all custom prompts to their default values')
				.addButton((button) => {
					button
						.setButtonText('Reset')
						.setCta()
						.onClick(async () => {
							this.plugin.settings.customSystemPrompt = DEFAULT_PROMPTS.system;
							this.plugin.settings.customCompletionPrompt = DEFAULT_PROMPTS.completion;
							this.plugin.settings.customGeneralPrompt = DEFAULT_PROMPTS.general;
							this.plugin.settings.customSummaryPrompt = DEFAULT_PROMPTS.summary;
							this.plugin.settings.customRewritePrompt = DEFAULT_PROMPTS.rewrite;
							this.plugin.settings.customDatePrompt = DEFAULT_PROMPTS.date;
							this.plugin.settings.customTimePrompt = DEFAULT_PROMPTS.time;
							this.plugin.settings.customContextPrompt = DEFAULT_PROMPTS.context;
							await this.plugin.saveSettings();
							this.display();
						});
				});

			// Helper function to create a TextArea setting for a prompt
			const createPromptTextArea = (
				settingName: keyof ObsidianGemini['settings'],
				label: string,
				defaultPrompt: string
			) => {
				new Setting(containerEl)
					.setName(label)
					.setDesc(`Variables: ${getPromptVariablesHint(settingName)}`)
					.addTextArea((text) => {
						text.inputEl.rows = 6;
						text.inputEl.style.width = '100%';
						text
							.setValue((this.plugin.settings[settingName] as string) || defaultPrompt)
							.setPlaceholder(defaultPrompt)
							.onChange(async (value) => {
								(this.plugin.settings as any)[settingName] = value.trim() ? value : '';
								await this.plugin.saveSettings();
							});
					});
			};

			// Helper function to get variable hints for each prompt type
			const getPromptVariablesHint = (settingName: keyof ObsidianGemini['settings']): string => {
				switch (settingName) {
					case 'customSystemPrompt':
						return '{{userName}}, {{language}}';
					case 'customCompletionPrompt':
						return '{{contentBeforeCursor}}, {{contentAfterCursor}}';
					case 'customGeneralPrompt':
						return '{{userMessage}}';
					case 'customSummaryPrompt':
						return '{{content}}';
					case 'customRewritePrompt':
						return '{{userMessage}}';
					case 'customDatePrompt':
						return '{{date}}';
					case 'customTimePrompt':
						return '{{time}}';
					case 'customContextPrompt':
						return '{{file_label}}, {{file_name}}, {{wikilink}}, {{file_contents}}';
					default:
						return 'No variables';
				}
			};

			// Calls to createPromptTextArea remain unchanged
			createPromptTextArea('customSystemPrompt', 'System Prompt', DEFAULT_PROMPTS.system);
			createPromptTextArea('customCompletionPrompt', 'Completion Prompt', DEFAULT_PROMPTS.completion);
			createPromptTextArea('customGeneralPrompt', 'General Prompt', DEFAULT_PROMPTS.general);
			createPromptTextArea('customSummaryPrompt', 'Summary Prompt', DEFAULT_PROMPTS.summary);
			createPromptTextArea('customRewritePrompt', 'Rewrite Prompt', DEFAULT_PROMPTS.rewrite);
			createPromptTextArea('customDatePrompt', 'Date Prompt', DEFAULT_PROMPTS.date);
			createPromptTextArea('customTimePrompt', 'Time Prompt', DEFAULT_PROMPTS.time);
			createPromptTextArea('customContextPrompt', 'Context Prompt', DEFAULT_PROMPTS.context);
		}

		// Chat History
		new Setting(containerEl).setName('Chat History').setHeading();

		new Setting(containerEl)
			.setName('Enable Chat History')
			.setDesc(
				'Store chat history as a json file in your vault. This will allow you to view past conversations between sessions.'
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.chatHistory).onChange(async (value) => {
					this.plugin.settings.chatHistory = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('History Folder')
			.setDesc('The folder where history file will be stored.')
			.addText((text) => {
				const folderSuggest = new FolderSuggest(this.app, text.inputEl, async (folder) => {
					this.plugin.settings.historyFolder = folder;
					await this.plugin.saveSettings();
				});
				text.setValue(this.plugin.settings.historyFolder);
			});

		// UI Settings
		new Setting(containerEl).setName('UI Settings').setHeading();

		new Setting(containerEl)
			.setName('Show Model Picker')
			.setDesc('Show the model picker in the chat interface.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.showModelPicker).onChange(async (value) => {
					this.plugin.settings.showModelPicker = value;
					await this.plugin.saveSettings();
				})
			);
	}
}
