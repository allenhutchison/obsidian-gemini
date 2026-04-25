import { Setting } from 'obsidian';
import type ObsidianGemini from '../main';
import { ObsidianGeminiSettings } from '../main';
import { GEMINI_MODELS } from '../models';

export async function selectModelSetting(
	containerEl: HTMLElement,
	plugin: ObsidianGemini,
	settingName: NonNullable<
		{
			[K in keyof ObsidianGeminiSettings]: ObsidianGeminiSettings[K] extends string ? K : never;
		}[keyof ObsidianGeminiSettings]
	>,
	label: string,
	description: string,
	role: 'text' | 'image' = 'text'
) {
	let availableModels: import('../models').GeminiModel[];

	const manager = plugin.getModelManager?.();
	if (manager) {
		if (role === 'image') {
			availableModels = await manager.getImageGenerationModels();
		} else {
			availableModels = await manager.getAvailableModels();
		}
	} else {
		// Fallback: role-aware filter on the bundled GEMINI_MODELS
		availableModels =
			role === 'image'
				? GEMINI_MODELS.filter((m) => m.supportsImageGeneration)
				: GEMINI_MODELS.filter((m) => !m.supportsImageGeneration);
	}

	plugin.logger.debug(
		`selectModelSetting for ${label} (role=${role}): Found ${availableModels.length} models`,
		availableModels.map((m) => m.value)
	);

	new Setting(containerEl)
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
				(plugin.settings as any)[settingName] = defaultValue;
				dropdown.setValue(defaultValue);
				// Save the corrected setting
				plugin.saveSettings().catch((e) => plugin.logger.error(`Failed to save corrected ${label} setting:`, e));
			} else {
				dropdown.setValue(currentValue);
			}

			dropdown.onChange(async (value) => {
				(plugin.settings as any)[settingName] = value;
				await plugin.saveSettings();
			});
			return dropdown;
		});
}
