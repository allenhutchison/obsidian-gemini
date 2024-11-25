import ObsidianGemini from '../main';
import { App, PluginSettingTab, Setting } from 'obsidian';
import { selectModelSetting } from './settings-helpers';

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
            .addText(text => text
                .setPlaceholder('Enter your API Key')
                .setValue(this.plugin.settings.apiKey)
                .onChange(async (value) => {
                    this.plugin.settings.apiKey = value;
                    await this.plugin.saveSettings();
                }));
        
        selectModelSetting(containerEl, this.plugin, 'chatModelName', 
                           'Chat Model', 
                           'The Gemini Model used in the chat interface.');
        selectModelSetting(containerEl, this.plugin, 'summaryModelName', 
                           'Summary Model', 
                           'The Gemini Model used for summarization.');
        selectModelSetting(containerEl, this.plugin, 'completionModelName', 
                            'Completion Model', 
                            'The Gemini Model used for completions.');

        new Setting(containerEl)
            .setName('Context Depth')
            .setDesc("Set to true to send the context of the current file to the model, and adjust the depth of links followed for the context.")
            .addDropdown(dropdown => dropdown
                .addOption('0', '0')
                .addOption('1', '1')
                .addOption('2', '2')
                .addOption('3', '3')
                .addOption('4', '4')
            .setValue(this.plugin.settings.maxContextDepth.toString())
            .onChange(async (value) => {
                this.plugin.settings.maxContextDepth = parseInt(value);
                await this.plugin.saveSettings();
            }))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.sendContext)
                .onChange(async (value) => {
                    this.plugin.settings.sendContext = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Search Grounding')
            .setDesc('Enable the model to use Google search results in its responses, and the threshold for how likely it is to trigger.')
            .addDropdown(dropdown => dropdown
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
                }))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.searchGrounding)
                .onChange(async (value) => {
                    this.plugin.settings.searchGrounding = value;
                    await this.plugin.saveSettings();
                }));            

        new Setting(containerEl)
            .setName('Summary Frontmatter Key')
            .setDesc('Key to use for frontmatter summarization.')
            .addText(text => text
                .setPlaceholder('Enter your key')
                .setValue(this.plugin.settings.summaryFrontmatterKey)
                .onChange(async (value) => {
                    this.plugin.settings.summaryFrontmatterKey = value;
                    await this.plugin.saveSettings();
                }));
        
        new Setting(containerEl)
            .setName('Your name.')
            .setDesc('This will be used in the system instructions for the model.')
            .addText(text => text
                .setPlaceholder('Enter your name')
                .setValue(this.plugin.settings.userName)
                .onChange(async (value) => {
                    this.plugin.settings.userName = value;
                    await this.plugin.saveSettings();
                }));
    
        new Setting(containerEl)
            .setName('Rewrite Files')
            .setDesc('Whether to allow the model to rewrite files during chat.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.rewriteFiles)
                .onChange(async (value) => {
                    this.plugin.settings.rewriteFiles = value;
                    await this.plugin.saveSettings();
                }));

    }
}