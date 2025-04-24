import { Setting } from 'obsidian';
import ObsidianGemini from '../../main';
import { ObsidianGeminiSettings } from '../../main';
import { GEMINI_MODELS } from '../models';

export function selectModelSetting(
	containerEl: HTMLElement,
	plugin: ObsidianGemini,
	settingName: keyof Pick<
		ObsidianGeminiSettings,
		{
			[K in keyof ObsidianGeminiSettings]: ObsidianGeminiSettings[K] extends string ? K : never;
		}[keyof ObsidianGeminiSettings]
	>,
	label: string,
	description: string
) {
	const dropdown = new Setting(containerEl)
		.setName(label)
		.setDesc(description)
		.addDropdown((dropdown) => {
			// Add all models from the shared list
			GEMINI_MODELS.forEach((model) => {
				dropdown.addOption(model.value, model.label);
			});

			dropdown.setValue(String((plugin.settings as ObsidianGeminiSettings)[settingName])).onChange(async (value) => {
				(plugin.settings as ObsidianGeminiSettings)[settingName] = value as string;
				await plugin.saveSettings();
			});
			return dropdown;
		});
}
