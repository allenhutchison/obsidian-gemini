import type ObsidianGemini from '../main';
import { App, Notice, Setting, SecretComponent, debounce } from 'obsidian';
import { createAlwaysOpenSection, selectModelSetting } from './settings-helpers';
import { FolderSuggest } from './folder-suggest';
import { getErrorMessage } from '../utils/error-utils';
import { t } from '../i18n';
import type { SettingsSectionContext } from './settings';

export async function renderGeneralSettings(
	containerEl: HTMLElement,
	plugin: ObsidianGemini,
	app: App,
	context: SettingsSectionContext
): Promise<void> {
	// Debounce saveSettings() to avoid re-running the plugin lifecycle on every keystroke
	// in text inputs. In-memory settings are mutated immediately so the UI stays responsive.
	// The callback is async + wrapped in try/catch so rejections from saveSettings() don't
	// become unhandled promise rejections.
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

	const generalEl = createAlwaysOpenSection(
		containerEl,
		t('settings.general.sectionTitle'),
		t('settings.general.sectionDesc')
	);
	await renderGeneralSection(generalEl, plugin, app, context, debouncedSave);
}

/**
 * Render the contents of the "General" section. Extracted so provider-specific
 * fields can be re-rendered (on Provider change / Refresh model list) without
 * tearing down the surrounding settings tab.
 */
async function renderGeneralSection(
	sectionEl: HTMLElement,
	plugin: ObsidianGemini,
	app: App,
	context: SettingsSectionContext,
	debouncedSave: () => void
): Promise<void> {
	new Setting(sectionEl)
		.setName(t('settings.general.documentationName'))
		.setDesc(t('settings.general.documentationDesc'))
		.addButton((button) =>
			button.setButtonText(t('settings.general.viewDocumentationButton')).onClick(() => {
				window.open('https://allenhutchison.github.io/obsidian-gemini/', '_blank');
			})
		);

	new Setting(sectionEl)
		.setName(t('settings.general.providerName'))
		.setDesc(t('settings.general.providerDesc'))
		.addDropdown((dropdown) =>
			dropdown
				.addOption('gemini', t('settings.general.providerOptionGemini'))
				.addOption('ollama', t('settings.general.providerOptionOllama'))
				.setValue(plugin.settings.provider)
				.onChange(async (value) => {
					plugin.settings.provider = value as 'gemini' | 'ollama';
					await plugin.saveSettings();
					// Re-render only the General section so provider-specific fields show/hide
					// without tearing down sections rendered later in the settings tab.
					sectionEl.empty();
					await renderGeneralSection(sectionEl, plugin, app, context, debouncedSave);
				})
		);

	if (plugin.settings.provider === 'ollama') {
		new Setting(sectionEl)
			.setName(t('settings.general.ollamaBaseUrlName'))
			.setDesc(t('settings.general.ollamaBaseUrlDesc'))
			.addText((text) =>
				text
					.setPlaceholder('http://localhost:11434')
					.setValue(plugin.settings.ollamaBaseUrl)
					.onChange((value) => {
						plugin.settings.ollamaBaseUrl = value.trim() || 'http://localhost:11434';
						debouncedSave();
					})
			);

		new Setting(sectionEl)
			.setName(t('settings.general.refreshModelListName'))
			.setDesc(t('settings.general.refreshModelListOllamaDesc'))
			.addButton((button) =>
				button.setButtonText(t('settings.general.refreshButton')).onClick(async () => {
					try {
						const manager = plugin.getModelManager();
						manager.getOllamaModelsService().invalidate();
						const models = await manager.getAvailableModels({ forceRefresh: true });
						new Notice(
							models.length === 1
								? t('settings.general.ollamaModelsFoundSingular', { count: models.length })
								: t('settings.general.ollamaModelsFound', { count: models.length })
						);
						sectionEl.empty();
						await renderGeneralSection(sectionEl, plugin, app, context, debouncedSave);
					} catch (error) {
						new Notice(t('settings.general.refreshFailedNotice', { error: getErrorMessage(error) }));
					}
				})
			);

		new Setting(sectionEl)
			.setName(t('settings.general.localOnlyNoticeName'))
			.setDesc(t('settings.general.localOnlyNoticeDesc'));
	} else {
		new Setting(sectionEl)
			.setName(t('settings.general.apiKeyName'))
			.setDesc(t('settings.general.apiKeyDesc'))
			.addComponent((el) =>
				new SecretComponent(app, el).setValue(plugin.settings.apiKeySecretName).onChange(async (secretName) => {
					plugin.settings.apiKeySecretName = secretName;
					await plugin.saveSettings();
				})
			);

		new Setting(sectionEl)
			.setName(t('settings.general.refreshModelListName'))
			.setDesc(t('settings.general.refreshModelListGeminiDesc'))
			.addButton((button) =>
				button.setButtonText(t('settings.general.refreshButton')).onClick(async () => {
					await refreshGeminiModelList(plugin, async () => {
						sectionEl.empty();
						await renderGeneralSection(sectionEl, plugin, app, context, debouncedSave);
					});
				})
			);
	}

	await selectModelSetting(
		sectionEl,
		plugin,
		'chatModelName',
		t('settings.general.chatModelName'),
		t('settings.general.chatModelDesc')
	);
	await selectModelSetting(
		sectionEl,
		plugin,
		'summaryModelName',
		t('settings.general.summaryModelName'),
		t('settings.general.summaryModelDesc')
	);
	await selectModelSetting(
		sectionEl,
		plugin,
		'completionsModelName',
		t('settings.general.completionModelName'),
		t('settings.general.completionModelDesc')
	);
	if (plugin.settings.provider === 'gemini') {
		await selectModelSetting(
			sectionEl,
			plugin,
			'imageModelName',
			t('settings.general.imageModelName'),
			t('settings.general.imageModelDesc'),
			'image'
		);
	}

	new Setting(sectionEl)
		.setName(t('settings.general.stateFolderName'))
		.setDesc(t('settings.general.stateFolderDesc'))
		.addText((text) => {
			new FolderSuggest(app, text.inputEl, (folder) => {
				plugin.settings.historyFolder = folder;
				debouncedSave();
			});
			text.setValue(plugin.settings.historyFolder);
		});

	new Setting(sectionEl)
		.setName(t('settings.general.showAdvancedName'))
		.setDesc(t('settings.general.showAdvancedDesc'))
		.addToggle((toggle) =>
			toggle.setValue(context.showDeveloperSettings).onChange((value) => {
				context.setShowDeveloperSettings(value);
				context.redisplay();
			})
		);
}

/**
 * Trigger a Gemini model-list refresh and surface the outcome via `Notice`.
 * Shared between the settings button and the command-palette entry so both
 * paths report the same skip/error/success messages.
 */
export async function refreshGeminiModelList(
	plugin: ObsidianGemini,
	onSuccess?: () => void | Promise<void>
): Promise<void> {
	try {
		const result = await plugin.getModelManager().refreshRemoteModels();
		if (result.fetched) {
			new Notice(
				result.modelCount === 1
					? t('settings.general.modelListUpdatedSingular', { count: result.modelCount })
					: t('settings.general.modelListUpdated', { count: result.modelCount })
			);
			if (onSuccess) await onSuccess();
			return;
		}
		const reasonMessage =
			result.skippedReason === 'offline'
				? t('settings.general.refreshSkippedOffline')
				: t('settings.general.refreshSkippedNotGemini');
		new Notice(reasonMessage);
	} catch (error) {
		plugin.logger.error('Failed to refresh Gemini model list:', error);
		new Notice(t('settings.general.refreshModelListFailed', { error: getErrorMessage(error) }));
	}
}
