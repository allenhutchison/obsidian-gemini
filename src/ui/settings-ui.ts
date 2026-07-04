import type ObsidianGemini from '../main';
import { Setting, ToggleComponent, debounce, Notice } from 'obsidian';
import { createCollapsibleSection } from './settings-helpers';
import { getErrorMessage } from '../utils/error-utils';
import { t } from '../i18n';

export function renderUISettings(containerEl: HTMLElement, plugin: ObsidianGemini): void {
	const sectionEl = createCollapsibleSection(plugin, containerEl, t('settings.ui.sectionTitle'), 'ui', {
		description: t('settings.ui.sectionDesc'),
	});

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

	new Setting(sectionEl)
		.setName(t('settings.ui.userNameName'))
		.setDesc(t('settings.ui.userNameDesc'))
		.addText((text) =>
			text
				.setPlaceholder(t('settings.ui.userNamePlaceholder'))
				.setValue(plugin.settings.userName)
				.onChange((value) => {
					plugin.settings.userName = value;
					debouncedSave();
				})
		);

	new Setting(sectionEl)
		.setName(t('settings.ui.summaryFrontmatterKeyName'))
		.setDesc(t('settings.ui.summaryFrontmatterKeyDesc'))
		.addText((text) =>
			text
				// eslint-disable-next-line obsidianmd/ui/sentence-case -- default frontmatter key (lowercase), shown verbatim
				.setPlaceholder('summary')
				.setValue(plugin.settings.summaryFrontmatterKey)
				.onChange((value) => {
					plugin.settings.summaryFrontmatterKey = value;
					debouncedSave();
				})
		);

	new Setting(sectionEl)
		.setName(t('settings.ui.enableStreamingName'))
		.setDesc(t('settings.ui.enableStreamingDesc'))
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.streamingEnabled).onChange(async (value) => {
				plugin.settings.streamingEnabled = value;
				await plugin.saveSettings();
			})
		);

	new Setting(sectionEl)
		.setName(t('settings.ui.alwaysShowDiffViewName'))
		.setDesc(t('settings.ui.alwaysShowDiffViewDesc'))
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.alwaysShowDiffView).onChange(async (value) => {
				plugin.settings.alwaysShowDiffView = value;
				await plugin.saveSettings();
			})
		);

	// Hold a reference to the dependent "Log tool execution" toggle so we can
	// flip its disabled state when Session History is toggled off — there's
	// nowhere to log to when sessions aren't being persisted.
	let logToolExecutionToggle: ToggleComponent | null = null;

	new Setting(sectionEl)
		.setName(t('settings.ui.sessionHistoryName'))
		.setDesc(t('settings.ui.sessionHistoryDesc'))
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.chatHistory).onChange(async (value) => {
				plugin.settings.chatHistory = value;
				await plugin.saveSettings();
				logToolExecutionToggle?.setDisabled(!value);
			})
		);

	new Setting(sectionEl)
		.setName(t('settings.ui.logToolExecutionName'))
		.setDesc(t('settings.ui.logToolExecutionDesc'))
		.addToggle((toggle) => {
			toggle
				.setValue(plugin.settings.logToolExecution)
				.setDisabled(!plugin.settings.chatHistory)
				.onChange(async (value) => {
					plugin.settings.logToolExecution = value;
					await plugin.saveSettings();
				});
			logToolExecutionToggle = toggle;
		});
}
