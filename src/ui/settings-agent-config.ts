import type ObsidianGemini from '../main';
import { Setting, Notice, debounce } from 'obsidian';
import { createCollapsibleSection } from './settings-helpers';
import { getErrorMessage } from '../utils/error-utils';
import { t } from '../i18n';
import type { SettingsSectionContext } from './settings';

let temperatureDebounceTimer: number | null = null;
let temperatureRunId = 0;
let topPDebounceTimer: number | null = null;
let topPRunId = 0;

/**
 * "Agent Config" advanced section — combines Custom Prompts, API Configuration,
 * Context Management, and Tool Loop Detection into a single collapsible with
 * labeled sub-groups, since they all tune how the agent talks to the model.
 */
export async function renderAgentConfigSettings(
	containerEl: HTMLElement,
	plugin: ObsidianGemini,
	context: SettingsSectionContext
): Promise<void> {
	const sectionEl = createCollapsibleSection(
		plugin,
		containerEl,
		t('settings.agentConfig.sectionTitle'),
		'agent-config',
		{
			description: t('settings.agentConfig.sectionDesc'),
			advanced: true,
		}
	);

	// Debounce saveSettings() for text inputs so typing doesn't trigger the plugin
	// lifecycle on every keystroke. Settings are mutated immediately; only the save is delayed.
	const debouncedSave = debounce(
		async () => {
			try {
				await plugin.saveSettings();
			} catch (error) {
				plugin.logger.error('Failed to save settings:', error);
				new Notice(t('settings.common.saveFailedNotice', { error: getErrorMessage(error) }));
			}
		},
		300,
		true
	);

	// --- Custom Prompts ---
	new Setting(sectionEl).setName(t('settings.agentConfig.customPromptsHeading')).setHeading();

	new Setting(sectionEl)
		.setName(t('settings.agentConfig.systemPromptOverrideName'))
		.setDesc(t('settings.agentConfig.systemPromptOverrideDesc'))
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.allowSystemPromptOverride ?? false).onChange(async (value) => {
				plugin.settings.allowSystemPromptOverride = value;
				await plugin.saveSettings();
			})
		);

	// --- API Configuration ---
	new Setting(sectionEl).setName(t('settings.agentConfig.apiConfigurationHeading')).setHeading();

	new Setting(sectionEl)
		.setName(t('settings.agentConfig.logToFileName'))
		.setDesc(t('settings.agentConfig.logToFileDesc'))
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.fileLogging).onChange(async (value) => {
				plugin.settings.fileLogging = value;
				await plugin.saveSettings();
			})
		);

	// The Interactions API is a Gemini-only transport; hide the toggle entirely
	// on Ollama, which has no equivalent.
	if (plugin.settings.provider === 'gemini') {
		new Setting(sectionEl)
			.setName(t('settings.agentConfig.useInteractionsApiName'))
			.setDesc(t('settings.agentConfig.useInteractionsApiDesc'))
			.addToggle((toggle) =>
				toggle.setValue(plugin.settings.useInteractionsApi).onChange(async (value) => {
					plugin.settings.useInteractionsApi = value;
					await plugin.saveSettings();
				})
			);
	}

	// Only the Gemini provider honours customBaseUrl — the Ollama path has its
	// own ollamaBaseUrl setting and ignores this value. Hide the row entirely
	// on Ollama so users don't type a URL that silently does nothing.
	if (plugin.settings.provider === 'gemini') {
		new Setting(sectionEl)
			.setName(t('settings.agentConfig.customEndpointName'))
			.setDesc(t('settings.agentConfig.customEndpointDesc'))
			.addText((text) => {
				text
					.setPlaceholder('https://my-proxy.example.com')
					.setValue(plugin.settings.customBaseUrl)
					.onChange((value) => {
						plugin.settings.customBaseUrl = value.trim();
						debouncedSave();
					});
				text.inputEl.addEventListener('blur', () => {
					const trimmed = plugin.settings.customBaseUrl.trim();
					if (trimmed === '') return;
					try {
						new URL(trimmed);
					} catch {
						new Notice(t('settings.agentConfig.customEndpointInvalidNotice'));
						plugin.settings.customBaseUrl = '';
						text.setValue('');
						debouncedSave();
					}
				});
				return text;
			});
	}

	new Setting(sectionEl)
		.setName(t('settings.agentConfig.maxRetriesName'))
		.setDesc(t('settings.agentConfig.maxRetriesDesc'))
		.addText((text) =>
			text
				.setPlaceholder(t('settings.agentConfig.maxRetriesPlaceholder'))
				.setValue(plugin.settings.maxRetries.toString())
				.onChange((value) => {
					const parsed = parseInt(value, 10);
					if (!isNaN(parsed) && parsed >= 0) {
						plugin.settings.maxRetries = parsed;
						debouncedSave();
					}
				})
		);

	new Setting(sectionEl)
		.setName(t('settings.agentConfig.initialBackoffName'))
		.setDesc(t('settings.agentConfig.initialBackoffDesc'))
		.addText((text) =>
			text
				.setPlaceholder(t('settings.agentConfig.initialBackoffPlaceholder'))
				.setValue(plugin.settings.initialBackoffDelay.toString())
				.onChange((value) => {
					const parsed = parseInt(value, 10);
					if (!isNaN(parsed) && parsed >= 0) {
						plugin.settings.initialBackoffDelay = parsed;
						debouncedSave();
					}
				})
		);

	await createTemperatureSetting(sectionEl, plugin);
	await createTopPSetting(sectionEl, plugin);

	// --- Context Management ---
	new Setting(sectionEl).setName(t('settings.agentConfig.contextManagementHeading')).setHeading();

	const thresholdSetting = new Setting(sectionEl)
		.setName(t('settings.agentConfig.compactionThresholdName'))
		.setDesc(
			t('settings.agentConfig.compactionThresholdDesc', { percent: plugin.settings.contextCompactionThreshold })
		);

	thresholdSetting.addSlider((slider) =>
		slider
			.setLimits(5, 50, 5)
			.setValue(plugin.settings.contextCompactionThreshold)
			// Dropping setDynamicTooltip() is only safe on Obsidian >= 1.13.0 (where the value shows inline); minAppVersion is 1.11.4, so keep it to preserve the slider value tooltip (#1040).
			// eslint-disable-next-line @typescript-eslint/no-deprecated -- minAppVersion 1.11.4 needs setDynamicTooltip() (#1040)
			.setDynamicTooltip()
			.onChange(async (value) => {
				plugin.settings.contextCompactionThreshold = value;
				thresholdSetting.setDesc(t('settings.agentConfig.compactionThresholdDesc', { percent: value }));
				await plugin.saveSettings();
			})
	);

	// --- Tool Loop Detection ---
	new Setting(sectionEl).setName(t('settings.agentConfig.loopDetectionHeading')).setHeading();

	new Setting(sectionEl)
		.setName(t('settings.agentConfig.loopDetectionName'))
		.setDesc(t('settings.agentConfig.loopDetectionDesc'))
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.loopDetectionEnabled).onChange(async (value) => {
				plugin.settings.loopDetectionEnabled = value;
				await plugin.saveSettings();
				context.redisplay();
			})
		);

	if (plugin.settings.loopDetectionEnabled) {
		new Setting(sectionEl)
			.setName(t('settings.agentConfig.loopThresholdName'))
			.setDesc(t('settings.agentConfig.loopThresholdDesc'))
			.addSlider((slider) =>
				slider
					.setLimits(2, 10, 1)
					.setValue(plugin.settings.loopDetectionThreshold)
					// Dropping setDynamicTooltip() is only safe on Obsidian >= 1.13.0 (where the value shows inline); minAppVersion is 1.11.4, so keep it to preserve the slider value tooltip (#1040).
					// eslint-disable-next-line @typescript-eslint/no-deprecated -- minAppVersion 1.11.4 needs setDynamicTooltip() (#1040)
					.setDynamicTooltip()
					.onChange(async (value) => {
						plugin.settings.loopDetectionThreshold = value;
						await plugin.saveSettings();
					})
			);

		new Setting(sectionEl)
			.setName(t('settings.agentConfig.timeWindowName'))
			.setDesc(t('settings.agentConfig.timeWindowDesc'))
			.addSlider((slider) =>
				slider
					.setLimits(10, 120, 5)
					.setValue(plugin.settings.loopDetectionTimeWindowSeconds)
					// Dropping setDynamicTooltip() is only safe on Obsidian >= 1.13.0 (where the value shows inline); minAppVersion is 1.11.4, so keep it to preserve the slider value tooltip (#1040).
					// eslint-disable-next-line @typescript-eslint/no-deprecated -- minAppVersion 1.11.4 needs setDynamicTooltip() (#1040)
					.setDynamicTooltip()
					.onChange(async (value) => {
						plugin.settings.loopDetectionTimeWindowSeconds = value;
						await plugin.saveSettings();
					})
			);
	}
}

async function createTemperatureSetting(containerEl: HTMLElement, plugin: ObsidianGemini): Promise<void> {
	const modelManager = plugin.getModelManager();
	const ranges = await modelManager.getParameterRanges();
	const displayInfo = await modelManager.getParameterDisplayInfo();

	const desc = displayInfo.hasModelData
		? t('settings.agentConfig.temperatureDescWithInfo', { info: displayInfo.temperature })
		: t('settings.agentConfig.temperatureDescDefault');

	new Setting(containerEl)
		.setName(t('settings.agentConfig.temperatureName'))
		.setDesc(desc)
		.addSlider((slider) =>
			slider
				.setLimits(ranges.temperature.min, ranges.temperature.max, ranges.temperature.step)
				.setValue(plugin.settings.temperature)
				// Dropping setDynamicTooltip() is only safe on Obsidian >= 1.13.0 (where the value shows inline); minAppVersion is 1.11.4, so keep it to preserve the slider value tooltip (#1040).
				// eslint-disable-next-line @typescript-eslint/no-deprecated -- minAppVersion 1.11.4 needs setDynamicTooltip() (#1040)
				.setDynamicTooltip()
				.onChange(async (value) => {
					if (temperatureDebounceTimer) {
						window.clearTimeout(temperatureDebounceTimer);
					}

					plugin.settings.temperature = value;

					const runId = ++temperatureRunId;

					temperatureDebounceTimer = window.setTimeout(() => {
						void (async () => {
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
								new Notice(t('settings.agentConfig.temperatureSaveFailedNotice'));
							}
						})();
					}, 300);
				})
		);
}

async function createTopPSetting(containerEl: HTMLElement, plugin: ObsidianGemini): Promise<void> {
	const modelManager = plugin.getModelManager();
	const ranges = await modelManager.getParameterRanges();
	const displayInfo = await modelManager.getParameterDisplayInfo();

	const desc = displayInfo.hasModelData
		? t('settings.agentConfig.topPDescWithInfo', { info: displayInfo.topP })
		: t('settings.agentConfig.topPDescDefault');

	new Setting(containerEl)
		.setName(t('settings.agentConfig.topPName'))
		.setDesc(desc)
		.addSlider((slider) =>
			slider
				.setLimits(ranges.topP.min, ranges.topP.max, ranges.topP.step)
				.setValue(plugin.settings.topP)
				// Dropping setDynamicTooltip() is only safe on Obsidian >= 1.13.0 (where the value shows inline); minAppVersion is 1.11.4, so keep it to preserve the slider value tooltip (#1040).
				// eslint-disable-next-line @typescript-eslint/no-deprecated -- minAppVersion 1.11.4 needs setDynamicTooltip() (#1040)
				.setDynamicTooltip()
				.onChange(async (value) => {
					if (topPDebounceTimer) {
						window.clearTimeout(topPDebounceTimer);
					}

					plugin.settings.topP = value;

					const runId = ++topPRunId;

					topPDebounceTimer = window.setTimeout(() => {
						void (async () => {
							try {
								const validation = await modelManager.validateParameters(
									plugin.settings.temperature,
									plugin.settings.topP
								);

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
								if (runId !== topPRunId) {
									return;
								}
								plugin.logger.error('Failed to validate/save topP setting:', error);
								new Notice(t('settings.agentConfig.topPSaveFailedNotice'));
							}
						})();
					}, 300);
				})
		);
}
