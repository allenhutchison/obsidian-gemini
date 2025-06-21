import ObsidianGemini from '../../main';
import { App, PluginSettingTab, Setting } from 'obsidian';
import { selectModelSetting } from './settings-helpers';
import { FolderSuggest } from './folder-suggest';
import { ApiProvider } from '../api/index';

export default class ObsidianGeminiSettingTab extends PluginSettingTab {
	plugin: ObsidianGemini;

	constructor(app: App, plugin: ObsidianGemini) {
		super(app, plugin);
		this.plugin = plugin;
	}

	private async updateDiscoveryStatus(setting: Setting): Promise<void> {
		try {
			const status = await this.plugin.getModelManager().getDiscoveryStatus();
			
			if (!status.enabled) {
				setting.setDesc('Model discovery is disabled');
				return;
			}

			if (status.working) {
				const lastUpdate = status.lastUpdate 
					? new Date(status.lastUpdate).toLocaleString()
					: 'Never';
				setting.setDesc(`✓ Working - Last update: ${lastUpdate}`);
			} else {
				setting.setDesc(`✗ Not working - ${status.error || 'Unknown error'}`);
			}
		} catch (error) {
			setting.setDesc(`Error checking status: ${error instanceof Error ? error.message : 'Unknown'}`);
		}
	}

	async display(): Promise<void> {
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

		new Setting(containerEl)
			.setName('API Provider')
			.setDesc('Select which AI provider to use')
			.addDropdown((dropdown) =>
				dropdown
					.addOption(ApiProvider.GEMINI, 'Google Gemini (New SDK)')
					//.addOption(ApiProvider.OLLAMA, 'Ollama (Local)')
					.setValue(this.plugin.settings.apiProvider)
					.onChange(async (value) => {
						this.plugin.settings.apiProvider = value;
						await this.plugin.saveSettings();
					})
			);

		await selectModelSetting(
			containerEl,
			this.plugin,
			'chatModelName',
			'Chat Model',
			'The Gemini Model used in the chat interface.'
		);
		await selectModelSetting(
			containerEl,
			this.plugin,
			'summaryModelName',
			'Summary Model',
			'The Gemini Model used for summarization.'
		);
		await selectModelSetting(
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
			.setDesc('Enable the model to use Google search results in its responses.')
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

		// Custom Prompts Settings
		new Setting(containerEl).setName('Custom Prompts').setHeading();

		new Setting(containerEl)
			.setName('Enable custom prompts')
			.setDesc('Allow notes to specify custom AI instructions via frontmatter')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableCustomPrompts ?? true)
				.onChange(async (value) => {
					this.plugin.settings.enableCustomPrompts = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Allow system prompt override')
			.setDesc('WARNING: Allows custom prompts to completely replace the system prompt. This may break expected functionality.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.allowSystemPromptOverride ?? false)
				.onChange(async (value) => {
					this.plugin.settings.allowSystemPromptOverride = value;
					await this.plugin.saveSettings();
				}));

		// Add button to open prompts folder
		new Setting(containerEl)
			.setName('Manage prompts')
			.setDesc('Open the prompts folder to create or edit prompt templates')
			.addButton(button => button
				.setButtonText('Open prompts folder')
				.onClick(async () => {
					const promptsDir = this.plugin.promptManager.getPromptsDirectory();
					await this.plugin.promptManager.ensurePromptsDirectory();
					// Open folder in system file manager
					(this.app as any).showInFolder(promptsDir);
				}));

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

		new Setting(containerEl)
			.setName('Enable Streaming')
			.setDesc('Enable streaming responses in the chat interface for a more interactive experience.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.streamingEnabled).onChange(async (value) => {
					this.plugin.settings.streamingEnabled = value;
					await this.plugin.saveSettings();
				})
			);

		// Model Discovery Settings
		new Setting(containerEl).setName('Model Discovery').setHeading();

		new Setting(containerEl)
			.setName('Enable dynamic model discovery')
			.setDesc('Automatically discover and update available Gemini models from Google\'s API')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.modelDiscovery.enabled).onChange(async (value) => {
					this.plugin.settings.modelDiscovery.enabled = value;
					await this.plugin.saveSettings();
					this.display(); // Refresh to show/hide dependent settings
				})
			);

		if (this.plugin.settings.modelDiscovery.enabled) {
			new Setting(containerEl)
				.setName('Auto-update interval (hours)')
				.setDesc('How often to check for new models (0 to disable auto-update)')
				.addSlider((slider) =>
					slider
						.setLimits(0, 168, 1) // 0 to 7 days
						.setValue(this.plugin.settings.modelDiscovery.autoUpdateInterval)
						.setDynamicTooltip()
						.onChange(async (value) => {
							this.plugin.settings.modelDiscovery.autoUpdateInterval = value;
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName('Fallback to static models')
				.setDesc('Use built-in model list when API discovery fails')
				.addToggle((toggle) =>
					toggle.setValue(this.plugin.settings.modelDiscovery.fallbackToStatic).onChange(async (value) => {
						this.plugin.settings.modelDiscovery.fallbackToStatic = value;
						await this.plugin.saveSettings();
					})
				);

			// Discovery Status and Controls
			const statusSetting = new Setting(containerEl)
				.setName('Discovery status')
				.setDesc('Current status of model discovery');

			// Add refresh button and status display
			statusSetting.addButton((button) =>
				button
					.setButtonText('Refresh models')
					.setTooltip('Manually refresh the model list from Google API')
					.onClick(async () => {
						button.setButtonText('Refreshing...');
						button.setDisabled(true);
						
						try {
							const result = await this.plugin.getModelManager().refreshModels();
							
							if (result.success) {
								button.setButtonText('✓ Refreshed');
								// Show results
								const statusText = `Found ${result.modelsFound} models${result.changes ? ' (changes detected)' : ''}`;
								statusSetting.setDesc(`Last refresh: ${new Date().toLocaleTimeString()} - ${statusText}`);
							} else {
								button.setButtonText('✗ Failed');
								statusSetting.setDesc(`Refresh failed: ${result.error || 'Unknown error'}`);
							}
						} catch (error) {
							button.setButtonText('✗ Error');
							statusSetting.setDesc(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
						}
						
						setTimeout(() => {
							button.setButtonText('Refresh models');
							button.setDisabled(false);
						}, 2000);
					})
			);

			// Show current status
			this.updateDiscoveryStatus(statusSetting);
		}

		// Developer Settings
		new Setting(containerEl).setName('Developer Settings').setHeading();

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
			.setName('Maximum Retries')
			.setDesc('Maximum number of retries when a model request fails.')
			.addText((text) =>
				text
					.setPlaceholder('e.g., 3')
					.setValue(this.plugin.settings.maxRetries.toString())
					.onChange(async (value) => {
						this.plugin.settings.maxRetries = parseInt(value);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Initial Backoff Delay (ms)')
			.setDesc('Initial delay in milliseconds before the first retry. Subsequent retries will use exponential backoff.')
			.addText((text) =>
				text
					.setPlaceholder('e.g., 1000')
					.setValue(this.plugin.settings.initialBackoffDelay.toString())
					.onChange(async (value) => {
						this.plugin.settings.initialBackoffDelay = parseInt(value);
						await this.plugin.saveSettings();
					})
			);
	}
}
