import { Setting } from 'obsidian';
import ObsidianGemini from '../main';
import { ObsidianGeminiSettings } from '../main';

export function selectModelSetting(
	containerEl: HTMLElement,
	plugin: ObsidianGemini,
	settingName: keyof Pick<
		ObsidianGeminiSettings,
		{
			[K in keyof ObsidianGeminiSettings]: ObsidianGeminiSettings[K] extends string
				? K
				: never;
		}[keyof ObsidianGeminiSettings]
	>,
	label: string,
	description: string
) {
	new Setting(containerEl)
		.setName(label)
		.setDesc(description)
		.addDropdown((dropdown) =>
			dropdown
				.addOption('gemini-1.5-flash', 'gemini-1.5-flash')
				.addOption('gemini-2.0-flash-exp', 'gemini-2.0-flash-exp')
				.addOption('gemini-1.5-pro', 'gemini-1.5-pro')
				.addOption('gemini-1.5-flash-8b', 'gemini-1.5-flash-8b')
				.setValue(
					String((plugin.settings as ObsidianGeminiSettings)[settingName])
				)
				.onChange(async (value) => {
					(plugin.settings as ObsidianGeminiSettings)[settingName] =
						value as string;
					await plugin.saveSettings();
				})
		);
}
