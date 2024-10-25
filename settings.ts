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
    }
}