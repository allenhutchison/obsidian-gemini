import { App, PluginSettingTab, Setting } from 'obsidian';
import ObsidianGemini from './main'; // Import your main plugin class

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
                    console.log("Key changed");
                    this.plugin.settings.apiKey = value;
                    await this.plugin.saveSettings();
                }));
        
        new Setting(containerEl)
            .setName('Preferred Model')
            .setDesc('The Gemini Model you would prefer to use.')
            .addDropdown(dropdown => dropdown
                .addOption('gemini-1.5-flash', 'gemini-1.5-flash')
                .addOption('gemini-1.5-pro', 'gemini-1.5-pro')
                .addOption('gemini-1.5-flash-8b', 'gemini-1.5-flash-8b')
            .setValue(this.plugin.settings.modelName)
            .onChange(async (value) => {
                console.log("Model changed: ", value);
                this.plugin.settings.modelName = value;
                await this.plugin.saveSettings();
            }));
            
        new Setting(containerEl)
            .setName('Summary Frontmatter Key')
            .setDesc('Key to use for frontmatter summarization.')
            .addText(text => text
                .setPlaceholder('Enter your key')
                .setValue(this.plugin.settings.summaryFrontmatterKey)
                .onChange(async (value) => {
                    console.log("Frontmatter Key changed");
                    this.plugin.settings.summaryFrontmatterKey = value;
                    await this.plugin.saveSettings();
                }));
        
        new Setting(containerEl)
            .setName('Your name for use in system prompt')
            .setDesc('Your name for use in system prompt')
            .addText(text => text
                .setPlaceholder('Enter your name')
                .setValue(this.plugin.settings.userName)
                .onChange(async (value) => {
                    console.log("User name changed");
                    this.plugin.settings.userName = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('System Prompt')
            .setDesc('Your system prompt. This text will be set as the system prompt for all Gemini requests')
            .addTextArea(text => {text
                .setPlaceholder('Enter your system prompt')
                .setValue(this.plugin.settings.systemPrompt)
                .onChange(async (value) => {
                    console.log("System prompt changed");
                    this.plugin.settings.systemPrompt = value;
                    await this.plugin.saveSettings();
                })
            text.inputEl.rows = 5;
            text.inputEl.cols = 50;
            });
        
        new Setting(containerEl)
            .setName('Summarization Prompt')
            .setDesc('Your summirization prompt. This prompt will be used along with the content of the active page in summarization tasks.')
            .addTextArea(text => {text
                .setPlaceholder('Enter your summarization prompt')
                .setValue(this.plugin.settings.summaryPrompt)
                .onChange(async (value) => {
                    this.plugin.settings.summaryPrompt = value;
                    await this.plugin.saveSettings();
                })
            text.inputEl.rows = 5;
            text.inputEl.cols = 50;
            });
        
        new Setting(containerEl)
            .setName('Rewrite Prompt')
            .setDesc(`
                Your rewrite prompt. This prompt will be used along with the content of the active page in rewrite tasks.`)
            .addTextArea(text => {text
                .setPlaceholder('Enter your rewrite prompt')
                .setValue(this.plugin.settings.rewritePrompt)
                .onChange(async (value) => {
                    this.plugin.settings.rewritePrompt = value;
                    await this.plugin.saveSettings();
                })
            text.inputEl.rows = 5;
            text.inputEl.cols = 50;
            });
    }
}