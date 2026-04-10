import type ObsidianGemini from '../main';
import { App, Setting, SettingGroup } from 'obsidian';
import {
	ToolPermission,
	ToolClassification,
	PolicyPreset,
	PRESET_LABELS,
	PERMISSION_LABELS,
	CLASSIFICATION_LABELS,
	PRESET_PERMISSIONS,
	DEFAULT_TOOL_POLICY,
} from '../types/tool-policy';
import type { SettingsSectionContext } from './settings';

export async function renderToolSettings(
	containerEl: HTMLElement,
	plugin: ObsidianGemini,
	app: App,
	context: SettingsSectionContext
): Promise<void> {
	// Tool Execution Settings
	new Setting(containerEl).setName('Tool Execution').setHeading();

	new Setting(containerEl)
		.setName('Stop on tool error')
		.setDesc(
			'Stop agent execution when a tool call fails. If disabled, the agent will continue executing subsequent tools.'
		)
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.stopOnToolError).onChange(async (value) => {
				plugin.settings.stopOnToolError = value;
				await plugin.saveSettings();
			})
		);

	// Tool Permissions Settings
	new Setting(containerEl).setName('Tool Permissions').setHeading();

	await createToolPermissionsSettings(containerEl, plugin, app, context);

	// Tool Loop Detection Settings
	new Setting(containerEl).setName('Tool Loop Detection').setHeading();

	new Setting(containerEl)
		.setName('Enable loop detection')
		.setDesc('Prevent the AI from repeatedly calling the same tool with identical parameters')
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.loopDetectionEnabled).onChange(async (value) => {
				plugin.settings.loopDetectionEnabled = value;
				await plugin.saveSettings();
				context.redisplay();
			})
		);

	if (plugin.settings.loopDetectionEnabled) {
		new Setting(containerEl)
			.setName('Loop threshold')
			.setDesc('Number of identical tool calls before considering it a loop (default: 3)')
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

		new Setting(containerEl)
			.setName('Time window (seconds)')
			.setDesc('Time window to check for repeated calls (default: 30 seconds)')
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

async function createToolPermissionsSettings(
	containerEl: HTMLElement,
	plugin: ObsidianGemini,
	app: App,
	context: SettingsSectionContext
): Promise<void> {
	// Normalize toolPolicy onto the real settings object so handlers can safely write to it
	plugin.settings.toolPolicy = {
		activePreset: plugin.settings.toolPolicy?.activePreset ?? DEFAULT_TOOL_POLICY.activePreset,
		toolPermissions: { ...(plugin.settings.toolPolicy?.toolPermissions ?? {}) },
	};
	const policy = plugin.settings.toolPolicy;
	const allTools = plugin.toolRegistry?.getAllTools() ?? [];

	// If no tools are registered yet, show a message
	if (allTools.length === 0) {
		new Setting(containerEl)
			.setName('No tools registered')
			.setDesc('Tool permissions will appear here once tools are loaded.');
		return;
	}

	// --- Preset dropdown ---
	new Setting(containerEl)
		.setName('Permission preset')
		.setDesc('Choose a preset that determines default permissions for all tools.')
		.addDropdown((dropdown) => {
			for (const preset of Object.values(PolicyPreset)) {
				dropdown.addOption(preset, PRESET_LABELS[preset]);
			}
			dropdown.setValue(policy.activePreset);
			dropdown.onChange(async (value) => {
				const preset = value as PolicyPreset;

				// YOLO requires confirmation
				if (preset === PolicyPreset.YOLO) {
					let confirmed = false;
					try {
						confirmed = await showYoloConfirmation(app);
					} catch (error) {
						plugin.logger.error('Failed to load YOLO confirmation modal', error);
					}
					if (!confirmed) {
						dropdown.setValue(policy.activePreset);
						return;
					}
				}

				if (preset === PolicyPreset.CUSTOM) {
					// Materialize current effective permissions before changing preset
					const materializedPermissions = Object.fromEntries(
						allTools.map((t) => [t.name, plugin.toolRegistry!.getEffectivePermission(t.name)])
					);
					plugin.settings.toolPolicy.toolPermissions = materializedPermissions;
					plugin.settings.toolPolicy.activePreset = PolicyPreset.CUSTOM;
				} else {
					plugin.settings.toolPolicy.activePreset = preset;
					// Clear per-tool overrides when switching to a named preset
					plugin.settings.toolPolicy.toolPermissions = {};
				}
				await plugin.saveSettings();
				context.redisplay();
			});
		});

	// --- Per-tool dropdowns grouped by classification ---
	const classificationOrder: ToolClassification[] = [
		ToolClassification.READ,
		ToolClassification.WRITE,
		ToolClassification.DESTRUCTIVE,
		ToolClassification.EXTERNAL,
	];

	for (const classification of classificationOrder) {
		const toolsInGroup = allTools
			.filter((t) => t.classification === classification)
			.sort((a, b) => a.name.localeCompare(b.name));

		if (toolsInGroup.length === 0) continue;

		const group = new SettingGroup(containerEl).setHeading(CLASSIFICATION_LABELS[classification]);

		for (const tool of toolsInGroup) {
			group.addSetting((setting) => {
				const displayName = tool.displayName || tool.name;
				setting.setName(displayName);

				// toolRegistry is guaranteed non-null — allTools is sourced from it above
				const effectivePermission = plugin.toolRegistry!.getEffectivePermission(tool.name);

				setting.addDropdown((dropdown) => {
					for (const perm of Object.values(ToolPermission)) {
						dropdown.addOption(perm, PERMISSION_LABELS[perm]);
					}
					dropdown.setValue(effectivePermission);
					dropdown.onChange(async (value) => {
						const newPerm = value as ToolPermission;
						const presetDefault = PRESET_PERMISSIONS[policy.activePreset][tool.classification];

						if (newPerm === presetDefault) {
							// Remove override — matches preset default
							delete plugin.settings.toolPolicy.toolPermissions[tool.name];
						} else {
							// Switching to Custom — materialize all current permissions first
							if (policy.activePreset !== PolicyPreset.CUSTOM) {
								plugin.settings.toolPolicy.toolPermissions = Object.fromEntries(
									allTools.map((t) => [t.name, plugin.toolRegistry!.getEffectivePermission(t.name)])
								);
								plugin.settings.toolPolicy.activePreset = PolicyPreset.CUSTOM;
							}
							// Apply the user's change
							plugin.settings.toolPolicy.toolPermissions[tool.name] = newPerm;
						}

						await plugin.saveSettings();
						context.redisplay();
					});
				});
			});
		}
	}
}

async function showYoloConfirmation(app: App): Promise<boolean> {
	const { YoloConfirmationModal } = await import('./yolo-confirmation-modal');
	return new Promise((resolve) => {
		const modal = new YoloConfirmationModal(app, (confirmed: boolean) => {
			resolve(confirmed);
		});
		modal.open();
	});
}
