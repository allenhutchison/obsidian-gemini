import ObsidianGemini from '../../main';
import { App, PluginSettingTab, Setting } from 'obsidian';
import { FolderSuggest } from './folder-suggest';
import { ApiProvider } from '../api/index';
import { GEMINI_MODELS, getOllamaModels, OllamaModel } from '../models'; // Assuming OllamaModel is exported

export default class ObsidianGeminiSettingTab extends PluginSettingTab {
	plugin: ObsidianGemini;
	private providerSpecificSettingsContainer: HTMLElement;

	constructor(app: App, plugin: ObsidianGemini) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// General Settings (API Key, Provider)
		this.addGeneralSettings(containerEl);

		// Container for provider-specific settings
		this.providerSpecificSettingsContainer = containerEl.createDiv('provider-specific-settings');
		this.updateProviderSpecificSettings();

		// Other settings (Context Depth, Search Grounding, etc.)
		this.addOtherSettings(containerEl);
	}

	private addGeneralSettings(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName('API Key')
			.setDesc('Gemini API Key (Required if using Gemini)')
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
			.addDropdown((dropdown) => {
				dropdown
					.addOption(ApiProvider.GEMINI, 'Google Gemini')
					.addOption(ApiProvider.OLLAMA, 'Ollama (Local)')
					.setValue(this.plugin.settings.apiProvider)
					.onChange(async (value) => {
						this.plugin.settings.apiProvider = value;
						// Reset models when provider changes to avoid mismatches
						this.plugin.settings.chatModelName = '';
						this.plugin.settings.summaryModelName = '';
						this.plugin.settings.completionsModelName = '';
						await this.plugin.saveSettings();
						this.updateProviderSpecificSettings();
						// Also, trigger an update of model versions in main.ts
						await this.plugin.updateModelVersions();
					});
			});
	}

	private async updateProviderSpecificSettings(): Promise<void> {
		const containerEl = this.providerSpecificSettingsContainer;
		containerEl.empty(); // Clear previous provider-specific settings

		const provider = this.plugin.settings.apiProvider;

		if (provider === ApiProvider.OLLAMA) {
			new Setting(containerEl)
				.setName('Ollama Base URL')
				.setDesc('The base URL for your Ollama server (e.g., http://localhost:11434)')
				.addText((text) =>
					text
						.setPlaceholder('http://localhost:11434')
						.setValue(this.plugin.settings.ollamaBaseUrl)
						.onChange(async (value) => {
							this.plugin.settings.ollamaBaseUrl = value;
							await this.plugin.saveSettings();
							// Potentially re-fetch models if URL changes
							this.updateProviderSpecificSettings();
							await this.plugin.updateModelVersions();
						})
				);
		}

		// Model selection settings - common for both but populated differently
		await this.addModelSelectionSetting(containerEl, 'chatModelName', 'Chat Model', 'Model for chat features.');
		await this.addModelSelectionSetting(containerEl, 'summaryModelName', 'Summary Model', 'Model for summarization.');
		await this.addModelSelectionSetting(containerEl, 'completionsModelName', 'Completion Model', 'Model for text completions.');
	}

	private async addModelSelectionSetting(
		containerEl: HTMLElement,
		settingName: 'chatModelName' | 'summaryModelName' | 'completionsModelName',
		name: string,
		desc: string
	): Promise<void> {
		const setting = new Setting(containerEl).setName(name).setDesc(desc);
		const provider = this.plugin.settings.apiProvider;

		let models: Array<{ value: string; label: string }> = [];
		let currentModel = this.plugin.settings[settingName];

		if (provider === ApiProvider.OLLAMA) {
			try {
				const ollamaModels = await getOllamaModels(this.plugin);
				if (ollamaModels && ollamaModels.length > 0) {
					models = ollamaModels.map((m: OllamaModel) => ({ value: m.value, label: m.name }));
				} else {
					setting.controlEl.createEl('p', { text: 'No Ollama models found or error fetching. Check Ollama server and Base URL.', cls: 'setting-item-description gemini-setting-error' });
				}
			} catch (error) {
				console.error("Error fetching Ollama models for settings:", error);
				setting.controlEl.createEl('p', { text: 'Error fetching Ollama models.', cls: 'setting-item-description gemini-setting-error' });
			}
		} else { // Gemini
			models = GEMINI_MODELS.map(m => ({ value: m.value, label: m.label }));
		}

		// If the current model isn't in the new list (e.g. provider changed), try to set a default
		if (models.length > 0 && !models.find(m => m.value === currentModel)) {
			// The getDefaultModelForRole in main.ts will handle provider logic
			// currentModel = await getDefaultModelForRole(settingName.replace('ModelName', '') as ModelRole, this.plugin) || models[0].value;
			// For now, just pick the first available if current is not valid or not set
			currentModel = this.plugin.settings[settingName] || models[0].value;
			if (!models.find(m => m.value === currentModel) && models.length > 0) {
				currentModel = models[0].value; // Fallback to first if still not valid
			}
			this.plugin.settings[settingName] = currentModel; // Update setting immediately
			// await this.plugin.saveSettings(); // Save this change
		}


		setting.addDropdown((dropdown) => {
			models.forEach((model) => {
				dropdown.addOption(model.value, model.label);
			});
			if (models.length > 0) {
				dropdown.setValue(currentModel);
			}
			dropdown.onChange(async (value) => {
				this.plugin.settings[settingName] = value;
				await this.plugin.saveSettings();
			});
		});
	}

	// Placeholder for other settings like Context Depth, Search Grounding, etc.
	// This helps organize the display() method.
	private addOtherSettings(containerEl: HTMLElement): void {
		// This is where the rest of the settings would be added.
		// For brevity in this diff, I'm not copying all of them,
		// but they would be moved into this method or similar.
		// Example:
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
				'Enable the model to use Google search results in its responses. (Gemini only)'
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.searchGrounding).onChange(async (value) => {
					this.plugin.settings.searchGrounding = value;
					await this.plugin.saveSettings();
				})
			);

		// Ensure Search Grounding is only visible for Gemini
		const searchGroundingSetting = containerEl.children[containerEl.children.length -1];
		if (this.plugin.settings.apiProvider !== ApiProvider.GEMINI) {
			searchGroundingSetting.hide();
		}
		const apiKeySetting = containerEl.children[0];
		if (this.plugin.settings.apiProvider === ApiProvider.OLLAMA) {
			apiKeySetting.descEl.setText('API Key (Not required for Ollama)');
		}


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
				new FolderSuggest(this.app, text.inputEl); // FolderSuggest now only takes app and inputEl
				text.setPlaceholder('Example: gemini-scribe/history')
					.setValue(this.plugin.settings.historyFolder)
					.onChange(async (value) => {
						this.plugin.settings.historyFolder = value;
						await this.plugin.saveSettings();
					});
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
			.setDesc(
				'Initial delay in milliseconds before the first retry. Subsequent retries will use exponential backoff.'
			)
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
