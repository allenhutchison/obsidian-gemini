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

	plugin.logger.debug(
		`selectModelSetting for ${label} (role=${role}): Found ${availableModels.length} models`,
		availableModels.map((m) => m.value)
	);

	const dropdown = new Setting(containerEl)
		.setName(label)
		.setDesc(description)
		.addDropdown((dropdown) => {
			// Add all models from the available list
			availableModels.forEach((model) => {
				dropdown.addOption(model.value, model.label);
			});

			// Get current setting value
			const currentValue = String((plugin.settings as ObsidianGeminiSettings)[settingName]);

			// Check if current value exists in available models
			const valueExists = availableModels.some((m) => m.value === currentValue);

			// If value doesn't exist in options, use first available model
			if (!valueExists && availableModels.length > 0) {
				const defaultValue = availableModels[0].value;
				plugin.logger.warn(
					`${label}: Current value "${currentValue}" not found in available models. Defaulting to "${defaultValue}"`
				);
				(plugin.settings as ObsidianGeminiSettings)[settingName] = defaultValue;
				dropdown.setValue(defaultValue);
				// Save the corrected setting
				plugin.saveSettings().catch((e) => plugin.logger.error(`Failed to save corrected ${label} setting:`, e));
			} else {
				dropdown.setValue(currentValue);
			}

			dropdown.onChange(async (value) => {
				(plugin.settings as ObsidianGeminiSettings)[settingName] = value as string;
				await plugin.saveSettings();
			});
			return dropdown;
		});
}
