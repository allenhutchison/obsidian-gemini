import type ObsidianGemini from '../main';
import { Setting, Notice, debounce } from 'obsidian';
import { getErrorMessage } from '../utils/error-utils';
import type { SettingsSectionContext } from './settings';

let temperatureDebounceTimer: NodeJS.Timeout | null = null;
let temperatureRunId = 0;
let topPDebounceTimer: NodeJS.Timeout | null = null;
let topPRunId = 0;

export async function renderApiSettings(
	containerEl: HTMLElement,
	plugin: ObsidianGemini,
	context: SettingsSectionContext
): Promise<void> {
	// Debounce saveSettings() for text inputs so typing doesn't trigger the plugin
	// lifecycle on every keystroke. Settings are mutated immediately; only the save is delayed.
	// The callback is async + wrapped in try/catch so rejections from saveSettings() don't
	// become unhandled promise rejections.
	const debouncedSave = debounce(
		async () => {
			try {
				await plugin.saveSettings();
			} catch (error) {
				plugin.logger.error('Failed to save settings:', error);
				new Notice(`Failed to save settings: ${getErrorMessage(error)}`);
			}
		},
		300,
		true
	);

	// File Logging
	new Setting(containerEl)
		.setName('Log to file')
		.setDesc(
			'Write log entries to a file in the plugin state folder. ' +
				'Errors and warnings are always logged; debug entries require Debug Mode. ' +
				'Log files are automatically rotated at 1 MB.'
		)
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.fileLogging).onChange(async (value) => {
				plugin.settings.fileLogging = value;
				await plugin.saveSettings();
			})
		);

	// Custom Prompts Advanced Settings
	new Setting(containerEl).setName('Custom Prompts').setHeading();

	new Setting(containerEl)
		.setName('Allow system prompt override')
		.setDesc(
			'WARNING: Allows custom prompts to completely replace the system prompt. This may break expected functionality.'
		)
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.allowSystemPromptOverride ?? false).onChange(async (value) => {
				plugin.settings.allowSystemPromptOverride = value;
				await plugin.saveSettings();
			})
		);

	// API Configuration
	new Setting(containerEl).setName('API Configuration').setHeading();

	new Setting(containerEl)
		.setName('Maximum Retries')
		.setDesc('Maximum number of retries when a model request fails.')
		.addText((text) =>
			text
				.setPlaceholder('e.g., 3')
				.setValue(plugin.settings.maxRetries.toString())
				.onChange((value) => {
					const parsed = parseInt(value, 10);
					if (!isNaN(parsed) && parsed >= 0) {
						plugin.settings.maxRetries = parsed;
						debouncedSave();
					}
				})
		);

	new Setting(containerEl)
		.setName('Initial Backoff Delay (ms)')
		.setDesc('Initial delay in milliseconds before the first retry. Subsequent retries will use exponential backoff.')
		.addText((text) =>
			text
				.setPlaceholder('e.g., 1000')
				.setValue(plugin.settings.initialBackoffDelay.toString())
				.onChange((value) => {
					const parsed = parseInt(value, 10);
					if (!isNaN(parsed) && parsed >= 0) {
						plugin.settings.initialBackoffDelay = parsed;
						debouncedSave();
					}
				})
		);

	// Create temperature setting with dynamic ranges
	await createTemperatureSetting(containerEl, plugin);

	// Create topP setting with dynamic ranges
	await createTopPSetting(containerEl, plugin);

	// Model Discovery Settings
	new Setting(containerEl).setName('Model Discovery').setHeading();

	new Setting(containerEl)
		.setName('Enable dynamic model discovery')
		.setDesc("Automatically discover and update available Gemini models from Google's API")
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.modelDiscovery.enabled).onChange(async (value) => {
				plugin.settings.modelDiscovery.enabled = value;
				await plugin.saveSettings();
				context.redisplay();
			})
		);

	if (plugin.settings.modelDiscovery.enabled) {
		new Setting(containerEl)
			.setName('Auto-update interval (hours)')
			.setDesc('How often to check for new models (0 to disable auto-update)')
			.addSlider((slider) =>
				slider
					.setLimits(0, 168, 1) // 0 to 7 days
					.setValue(plugin.settings.modelDiscovery.autoUpdateInterval)
					.setDynamicTooltip()
					.onChange(async (value) => {
						plugin.settings.modelDiscovery.autoUpdateInterval = value;
						await plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Fallback to static models')
			.setDesc('Use built-in model list when API discovery fails')
			.addToggle((toggle) =>
				toggle.setValue(plugin.settings.modelDiscovery.fallbackToStatic).onChange(async (value) => {
					plugin.settings.modelDiscovery.fallbackToStatic = value;
					await plugin.saveSettings();
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
						const result = await plugin.getModelManager().refreshModels();

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
		await updateDiscoveryStatus(statusSetting, plugin);
	}
}

async function updateDiscoveryStatus(setting: Setting, plugin: ObsidianGemini): Promise<void> {
	try {
		const status = await plugin.getModelManager().getDiscoveryStatus();

		if (!status.enabled) {
			setting.setDesc('Model discovery is disabled');
			return;
		}

		if (status.working) {
			const lastUpdate = status.lastUpdate ? new Date(status.lastUpdate).toLocaleString() : 'Never';
			setting.setDesc(`✓ Working - Last update: ${lastUpdate}`);
		} else {
			setting.setDesc(`✗ Not working - ${status.error || 'Unknown error'}`);
		}
	} catch (error) {
		setting.setDesc(`Error checking status: ${error instanceof Error ? error.message : 'Unknown'}`);
	}
}

async function createTemperatureSetting(containerEl: HTMLElement, plugin: ObsidianGemini): Promise<void> {
	const modelManager = plugin.getModelManager();
	const ranges = await modelManager.getParameterRanges();
	const displayInfo = await modelManager.getParameterDisplayInfo();

	const desc = displayInfo.hasModelData
		? `Controls randomness. Lower values are more deterministic. ${displayInfo.temperature}`
		: 'Controls randomness. Lower values are more deterministic. (Default: 0.7)';

	new Setting(containerEl)
		.setName('Temperature')
		.setDesc(desc)
		.addSlider((slider) =>
			slider
				.setLimits(ranges.temperature.min, ranges.temperature.max, ranges.temperature.step)
				.setValue(plugin.settings.temperature)
				.setDynamicTooltip()
				.onChange(async (value) => {
					// Clear previous timeout
					if (temperatureDebounceTimer) {
						clearTimeout(temperatureDebounceTimer);
					}

					// Set immediate value for responsive UI
					plugin.settings.temperature = value;

					// Capture the run ID upfront so we can discard stale async results.
					const runId = ++temperatureRunId;

					// Debounce validation and saving
					temperatureDebounceTimer = setTimeout(async () => {
						try {
							// Validate the current value against model capabilities. Read from
							// settings rather than the captured `value` so the validation always
							// matches the most recent user input.
							const validation = await modelManager.validateParameters(
								plugin.settings.temperature,
								plugin.settings.topP
							);

							// A newer slider change has superseded this run — discard the
							// stale result instead of clobbering the current slider/value.
							if (runId !== temperatureRunId) {
								return;
							}

							if (!validation.temperature.isValid && validation.temperature.adjustedValue !== undefined) {
								slider.setValue(validation.temperature.adjustedValue);
								plugin.settings.temperature = validation.temperature.adjustedValue;
								if (validation.temperature.warning) {
									new Notice(validation.temperature.warning);
								}
							}

							await plugin.saveSettings();
						} catch (error) {
							// If a newer run has superseded us, drop this stale failure silently —
							// surfacing it would contradict whatever the current run is doing.
							if (runId !== temperatureRunId) {
								return;
							}
							plugin.logger.error('Failed to validate/save temperature setting:', error);
							new Notice('Failed to save temperature setting. See console for details.');
						}
					}, 300);
				})
		);
}

async function createTopPSetting(containerEl: HTMLElement, plugin: ObsidianGemini): Promise<void> {
	const modelManager = plugin.getModelManager();
	const ranges = await modelManager.getParameterRanges();
	const displayInfo = await modelManager.getParameterDisplayInfo();

	const desc = displayInfo.hasModelData
		? `Controls diversity. Lower values are more focused. ${displayInfo.topP}`
		: 'Controls diversity. Lower values are more focused. (Default: 1)';

	new Setting(containerEl)
		.setName('Top P')
		.setDesc(desc)
		.addSlider((slider) =>
			slider
				.setLimits(ranges.topP.min, ranges.topP.max, ranges.topP.step)
				.setValue(plugin.settings.topP)
				.setDynamicTooltip()
				.onChange(async (value) => {
					// Clear previous timeout
					if (topPDebounceTimer) {
						clearTimeout(topPDebounceTimer);
					}

					// Set immediate value for responsive UI
					plugin.settings.topP = value;

					// Capture the run ID upfront so we can discard stale async results.
					const runId = ++topPRunId;

					// Debounce validation and saving
					topPDebounceTimer = setTimeout(async () => {
						try {
							// Validate the current value against model capabilities. Read from
							// settings rather than the captured `value` so the validation always
							// matches the most recent user input.
							const validation = await modelManager.validateParameters(
								plugin.settings.temperature,
								plugin.settings.topP
							);

							// A newer slider change has superseded this run — discard the
							// stale result instead of clobbering the current slider/value.
							if (runId !== topPRunId) {
								return;
							}

							if (!validation.topP.isValid && validation.topP.adjustedValue !== undefined) {
								slider.setValue(validation.topP.adjustedValue);
								plugin.settings.topP = validation.topP.adjustedValue;
								if (validation.topP.warning) {
									new Notice(validation.topP.warning);
								}
							}

							await plugin.saveSettings();
						} catch (error) {
							// If a newer run has superseded us, drop this stale failure silently —
							// surfacing it would contradict whatever the current run is doing.
							if (runId !== topPRunId) {
								return;
							}
							plugin.logger.error('Failed to validate/save topP setting:', error);
							new Notice('Failed to save Top P setting. See console for details.');
						}
					}, 300);
				})
		);
}
