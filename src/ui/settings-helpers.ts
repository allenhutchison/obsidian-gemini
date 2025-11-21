import { Setting } from 'obsidian';
import ObsidianGemini from '../main';
import { ObsidianGeminiSettings } from '../main';
import { GEMINI_MODELS } from '../models';

export async function selectModelSetting(
	containerEl: HTMLElement,
	plugin: InstanceType<typeof ObsidianGemini>,
	settingName: keyof Pick<
		ObsidianGeminiSettings,
		{
			[K in keyof ObsidianGeminiSettings]: ObsidianGeminiSettings[K] extends string ? K : never;
		}[keyof ObsidianGeminiSettings]
	>,
	label: string,
	description: string,
	role: 'text' | 'image' = 'text'
) {
	// Get available models (dynamic if enabled, static otherwise)
	let availableModels: import('../models').GeminiModel[];

	if (plugin.settings.modelDiscovery?.enabled && plugin.getModelManager) {
		if (role === 'image') {
			availableModels = await plugin.getModelManager().getImageGenerationModels();
		} else {
			availableModels = await plugin.getModelManager().getAvailableModels();
		}
	} else {
		// Fallback to static models, but we should still filter them by role if possible
		// However, GEMINI_MODELS contains everything.
		// Ideally we should use ModelManager to filter static models too.
		if (plugin.getModelManager) {
			if (role === 'image') {
				availableModels = await plugin.getModelManager().getImageGenerationModels();
			} else {
				availableModels = await plugin.getModelManager().getAvailableModels();
			}
		} else {
			// Fallback if ModelManager not available (unlikely)
			availableModels = GEMINI_MODELS;
		}
	}

	console.log(`selectModelSetting for ${label} (role=${role}): Found ${availableModels.length} models`, availableModels.map(m => m.value));

	const dropdown = new Setting(containerEl)
		.setName(label)
		.setDesc(description)
		.addDropdown((dropdown) => {
			// Add all models from the available list
			availableModels.forEach((model) => {
				dropdown.addOption(model.value, model.label);
			});

			dropdown.setValue(String((plugin.settings as ObsidianGeminiSettings)[settingName])).onChange(async (value) => {
				(plugin.settings as ObsidianGeminiSettings)[settingName] = value as string;
				await plugin.saveSettings();
			});
			return dropdown;
		});
}
