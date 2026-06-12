import type ObsidianGemini from '../main';
import { App, Setting } from 'obsidian';
import { createCollapsibleSection } from './settings-helpers';
import { t } from '../i18n';

export function renderAutomationSettings(containerEl: HTMLElement, plugin: ObsidianGemini, app: App): void {
	const sectionEl = createCollapsibleSection(plugin, containerEl, t('settings.automation.sectionTitle'), 'automation', {
		description: t('settings.automation.sectionDesc'),
	});

	new Setting(sectionEl)
		.setName(t('settings.automation.manageScheduledTasksName'))
		.setDesc(t('settings.automation.manageScheduledTasksDesc'))
		.addButton((button) =>
			button
				.setButtonText(t('settings.automation.openSchedulerButton'))
				.setCta()
				.onClick(async () => {
					const { SchedulerManagementModal } = await import('./scheduler-management-modal');
					new SchedulerManagementModal(app, plugin, 'list').open();
				})
		)
		.addButton((button) =>
			button.setButtonText(t('settings.automation.newTaskButton')).onClick(async () => {
				const { SchedulerManagementModal } = await import('./scheduler-management-modal');
				new SchedulerManagementModal(app, plugin, 'create').open();
			})
		);

	new Setting(sectionEl)
		.setName(t('settings.automation.autoRunCatchUpName'))
		.setDesc(t('settings.automation.autoRunCatchUpDesc'))
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.autoRunCatchUp).onChange(async (value) => {
				plugin.settings.autoRunCatchUp = value;
				await plugin.saveSettings();
			})
		);

	new Setting(sectionEl)
		.setName(t('settings.automation.enableHooksName'))
		.setDesc(t('settings.automation.enableHooksDesc'))
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.hooksEnabled).onChange(async (value) => {
				plugin.settings.hooksEnabled = value;
				await plugin.saveSettings();
			})
		);

	new Setting(sectionEl)
		.setName(t('settings.automation.manageHooksName'))
		.setDesc(t('settings.automation.manageHooksDesc'))
		.addButton((button) =>
			button
				.setButtonText(t('settings.automation.openHookManagerButton'))
				.setCta()
				.onClick(async () => {
					const { HookManagementModal } = await import('./hook-management-modal');
					new HookManagementModal(app, plugin, 'list').open();
				})
		)
		.addButton((button) =>
			button.setButtonText(t('settings.automation.newHookButton')).onClick(async () => {
				const { HookManagementModal } = await import('./hook-management-modal');
				new HookManagementModal(app, plugin, 'create').open();
			})
		);
}
