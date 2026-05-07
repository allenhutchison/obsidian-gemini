import type ObsidianGemini from '../main';
import { Setting, Notice, debounce } from 'obsidian';
import { createCollapsibleSection } from './settings-helpers';
import { getErrorMessage } from '../utils/error-utils';
import type { SettingsSectionContext } from './settings';

let temperatureDebounceTimer: NodeJS.Timeout | null = null;
let temperatureRunId = 0;
let topPDebounceTimer: NodeJS.Timeout | null = null;
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
	const sectionEl = createCollapsibleSection(plugin, containerEl, 'Agent Config', 'agent-config', {
		description:
			'Tune how the agent talks to the model: custom prompts, retry/generation parameters, conversation summarization, and loop guards.',
		advanced: true,
	});

	// Debounce saveSettings() for text inputs so typing doesn't trigger the plugin
	// lifecycle on every keystroke. Settings are mutated immediately; only the save is delayed.
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

	// --- Custom Prompts ---
	new Setting(sectionEl).setName('Custom Prompts').setHeading();

	new Setting(sectionEl)
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

	// --- API Configuration ---
	new Setting(sectionEl).setName('API Configuration').setHeading();

	new Setting(sectionEl)
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

	new Setting(sectionEl)
		.setName('Custom API endpoint')
		.setDesc(
			'Override the default Google API base URL (e.g. for a corporate proxy or local gateway). Leave blank to use the official endpoint.'
		)
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
					new Notice('Custom API endpoint is not a valid URL — clearing.');
					plugin.settings.customBaseUrl = '';
					text.setValue('');
					debouncedSave();
				}
			});
			return text;
		});

	new Setting(sectionEl)
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

	new Setting(sectionEl)
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

	await createTemperatureSetting(sectionEl, plugin);
	await createTopPSetting(sectionEl, plugin);

	// --- Context Management ---
	new Setting(sectionEl).setName('Context Management').setHeading();

	const thresholdSetting = new Setting(sectionEl)
		.setName('Context compaction threshold')
		.setDesc(
			`Automatically summarize older conversation turns when token usage exceeds this percentage of the model context window. Current: ${plugin.settings.contextCompactionThreshold}%`
		);

	thresholdSetting.addSlider((slider) =>
		slider
			.setLimits(5, 50, 5)
			.setValue(plugin.settings.contextCompactionThreshold)
			.setDynamicTooltip()
			.onChange(async (value) => {
				plugin.settings.contextCompactionThreshold = value;
				thresholdSetting.setDesc(
					`Automatically summarize older conversation turns when token usage exceeds this percentage of the model context window. Current: ${value}%`
				);
				await plugin.saveSettings();
			})
	);

	// --- Tool Loop Detection ---
	new Setting(sectionEl).setName('Tool Loop Detection').setHeading();

	new Setting(sectionEl)
		.setName('Enable loop detection')
		.setDesc('Prevent the AI from repeatedly calling the same tool with identical parameters.')
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.loopDetectionEnabled).onChange(async (value) => {
				plugin.settings.loopDetectionEnabled = value;
				await plugin.saveSettings();
				context.redisplay();
			})
		);

	if (plugin.settings.loopDetectionEnabled) {
		new Setting(sectionEl)
			.setName('Loop threshold')
			.setDesc('Number of identical tool calls before considering it a loop (default: 3).')
			.addSlider((slider) =>
				slider
					.setLimits(2, 10, 1)
					.setValue(plugin.settings.loopDetectionThreshold)
					.setDynamicTooltip()
					.onChange(async (value) => {
						plugin.settings.loopDetectionThreshold = value;
						await plugin.saveSettings();
					})
			);

		new Setting(sectionEl)
			.setName('Time window (seconds)')
			.setDesc('Time window to check for repeated calls (default: 30 seconds).')
			.addSlider((slider) =>
				slider
					.setLimits(10, 120, 5)
					.setValue(plugin.settings.loopDetectionTimeWindowSeconds)
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
					if (temperatureDebounceTimer) {
						clearTimeout(temperatureDebounceTimer);
					}

					plugin.settings.temperature = value;

					const runId = ++temperatureRunId;

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
					if (topPDebounceTimer) {
						clearTimeout(topPDebounceTimer);
					}

					plugin.settings.topP = value;

					const runId = ++topPRunId;

					topPDebounceTimer = setTimeout(async () => {
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
							new Notice('Failed to save Top P setting. See console for details.');
						}
					}, 300);
				})
		);
}
