import type ObsidianGemini from '../main';
import { App, Setting } from 'obsidian';
import { createCollapsibleSection } from './settings-helpers';

export function renderAutomationSettings(containerEl: HTMLElement, plugin: ObsidianGemini, app: App): void {
	const sectionEl = createCollapsibleSection(plugin, containerEl, 'Automation', 'automation', {
		description:
			'Run AI agent tasks automatically — on a schedule, or in response to vault events (file created/modified/deleted/renamed).',
	});

	new Setting(sectionEl)
		.setName('Manage scheduled tasks')
		.setDesc(
			'Create, edit, enable/disable, and delete scheduled AI tasks. Tasks run automatically in the background while Obsidian is open.'
		)
		.addButton((button) =>
			button
				.setButtonText('Open Scheduler')
				.setCta()
				.onClick(async () => {
					const { SchedulerManagementModal } = await import('./scheduler-management-modal');
					new SchedulerManagementModal(app, plugin, 'list').open();
				})
		)
		.addButton((button) =>
			button.setButtonText('New task').onClick(async () => {
				const { SchedulerManagementModal } = await import('./scheduler-management-modal');
				new SchedulerManagementModal(app, plugin, 'create').open();
			})
		);

	new Setting(sectionEl)
		.setName('Enable lifecycle hooks')
		.setDesc(
			'Subscribe to vault events and run AI agent tasks in response. Off by default — vault events fire continuously, and a broadly-scoped hook can drain API quota quickly.'
		)
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.hooksEnabled).onChange(async (value) => {
				plugin.settings.hooksEnabled = value;
				await plugin.saveSettings();
			})
		);

	new Setting(sectionEl)
		.setName('Manage lifecycle hooks')
		.setDesc(
			'Create, edit, enable/disable, and delete hooks. Each hook fires when a matching vault event occurs and runs as a headless agent session.'
		)
		.addButton((button) =>
			button
				.setButtonText('Open Hook Manager')
				.setCta()
				.onClick(async () => {
					const { HookManagementModal } = await import('./hook-management-modal');
					new HookManagementModal(app, plugin, 'list').open();
				})
		)
		.addButton((button) =>
			button.setButtonText('New hook').onClick(async () => {
				const { HookManagementModal } = await import('./hook-management-modal');
				new HookManagementModal(app, plugin, 'create').open();
			})
		);
}
