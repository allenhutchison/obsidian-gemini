import type ObsidianGemini from '../main';
import { App, Setting, Notice, debounce } from 'obsidian';
import { getErrorMessage } from '../utils/error-utils';
import { createCollapsibleSection } from './settings-helpers';
import { t } from '../i18n';
import type { SettingsSectionContext } from './settings';

export async function renderRAGSettings(
	outerContainerEl: HTMLElement,
	plugin: ObsidianGemini,
	app: App,
	context: SettingsSectionContext
): Promise<void> {
	const containerEl = createCollapsibleSection(plugin, outerContainerEl, t('settings.rag.sectionTitle'), 'rag', {
		description: t('settings.rag.sectionDesc'),
	});
	// Debounce saveSettings() for text inputs so typing doesn't trigger the plugin
	// lifecycle on every keystroke. Settings are mutated immediately; only the save is delayed.
	const debouncedSave = debounce(
		async () => {
			try {
				await plugin.saveSettings();
			} catch (error) {
				plugin.logger.error('Failed to save RAG settings:', error);
				new Notice(t('settings.common.saveFailedNotice', { error: getErrorMessage(error) }));
			}
		},
		300,
		true
	);

	// Privacy warning
	const privacyWarning = containerEl.createDiv({ cls: 'setting-item' });
	privacyWarning.createEl('div', {
		cls: 'setting-item-description',
		text: t('settings.rag.privacyNotice'),
	});
	privacyWarning.style.marginBottom = '1em';
	privacyWarning.style.color = 'var(--text-warning)';

	new Setting(containerEl)
		.setName(t('settings.rag.enableName'))
		.setDesc(t('settings.rag.enableDesc'))
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.ragIndexing.enabled).onChange(async (value) => {
				if (!value && plugin.settings.ragIndexing.fileSearchStoreName) {
					// Revert toggle immediately - will only change if user confirms
					toggle.setValue(true);

					// Show cleanup modal when disabling
					try {
						const { RagCleanupModal } = await import('./rag-cleanup-modal');
						const modal = new RagCleanupModal(app, (deleteData) => {
							void (async () => {
								const previousEnabled = plugin.settings.ragIndexing.enabled;
								try {
									if (deleteData && plugin.ragIndexing) {
										await plugin.ragIndexing.deleteFileSearchStore();
									}
									plugin.settings.ragIndexing.enabled = false;
									await plugin.saveSettings();
									context.redisplay();
								} catch (error) {
									// Revert the in-memory flag so it can't drift from the persisted
									// value when saveSettings()/deleteFileSearchStore() throws after it
									// was flipped, then surface it and redisplay (mirrors delete-index).
									plugin.settings.ragIndexing.enabled = previousEnabled;
									plugin.logger.error('Failed to disable RAG indexing:', error);
									new Notice(t('settings.rag.deleteIndexFailed', { error: getErrorMessage(error) }));
									context.redisplay();
								}
							})();
						});
						modal.open();
					} catch (error) {
						plugin.logger.error('Failed to load RAG cleanup modal:', error);
						new Notice(t('settings.rag.openCleanupFailed', { error: getErrorMessage(error) }));
						// Toggle was already reverted to `true` above and settings.enabled
						// was never changed, so UI and settings remain consistent.
					}
				} else {
					plugin.settings.ragIndexing.enabled = value;
					await plugin.saveSettings();
					context.redisplay();
				}
			})
		);

	if (plugin.settings.ragIndexing.enabled) {
		// Index status
		const indexCount = plugin.ragIndexing?.getIndexedFileCount() ?? 0;
		const statusText = plugin.settings.ragIndexing.fileSearchStoreName
			? t('settings.rag.filesIndexed', { count: indexCount })
			: t('settings.rag.notYetIndexed');

		new Setting(containerEl)
			.setName(t('settings.rag.indexStatusName'))
			.setDesc(statusText)
			.addButton((button) =>
				button.setButtonText(t('settings.rag.reindexButton')).onClick(async () => {
					if (!plugin.ragIndexing) {
						new Notice(t('settings.rag.serviceNotInitialized'));
						return;
					}

					button.setButtonText(t('settings.rag.indexingButton'));
					button.setDisabled(true);

					try {
						const result = await plugin.ragIndexing.indexVault((progress) => {
							button.setButtonText(`${progress.current}/${progress.total}`);
						});

						new Notice(
							t('settings.rag.indexResult', {
								indexed: result.indexed,
								skipped: result.skipped,
								failed: result.failed,
							})
						);
						context.redisplay();
					} catch (error) {
						new Notice(t('settings.rag.indexingFailed', { error: getErrorMessage(error) }));
					} finally {
						button.setButtonText(t('settings.rag.reindexButton'));
						button.setDisabled(false);
					}
				})
			)
			.addButton((button) =>
				button
					.setButtonText(t('settings.rag.deleteIndexButton'))
					// setDestructive() (the recommended replacement) requires Obsidian 1.13.0, above the current minAppVersion 1.11.4; keep setWarning until the floor is raised (#1040).
					// eslint-disable-next-line @typescript-eslint/no-deprecated
					.setWarning()
					.onClick(async () => {
						if (!plugin.ragIndexing) {
							new Notice(t('settings.rag.serviceNotInitialized'));
							return;
						}

						// Show confirmation modal
						try {
							const { RagCleanupModal } = await import('./rag-cleanup-modal');
							const modal = new RagCleanupModal(app, (deleteData) => {
								void (async () => {
									if (deleteData && plugin.ragIndexing) {
										button.setButtonText(t('settings.rag.deletingButton'));
										button.setDisabled(true);

										try {
											await plugin.ragIndexing.deleteFileSearchStore();
											new Notice(t('settings.rag.indexDeletedNotice'));
											context.redisplay();
										} catch (error) {
											new Notice(t('settings.rag.deleteIndexFailed', { error: getErrorMessage(error) }));
										} finally {
											button.setButtonText(t('settings.rag.deleteIndexButton'));
											button.setDisabled(false);
										}
									}
								})();
							});
							modal.open();
						} catch (error) {
							plugin.logger.error('Failed to load RAG cleanup modal:', error);
							new Notice(t('settings.rag.openDeleteConfirmFailed', { error: getErrorMessage(error) }));
						}
					})
			);

		// Store name display. The Google File Search API assigns the store's
		// resource ID automatically — it cannot be chosen — so this is shown
		// read-only, and only once a store actually exists.
		const currentStoreName = plugin.settings.ragIndexing.fileSearchStoreName;
		const storeNameSetting = new Setting(containerEl)
			.setName(t('settings.rag.storeNameName'))
			.setDesc(currentStoreName ? t('settings.rag.storeNameDescAssigned') : t('settings.rag.storeNameDescPending'));

		if (currentStoreName) {
			storeNameSetting
				.addText((text) => {
					text.inputEl.style.width = '30ch';
					text.setValue(currentStoreName);
					text.setDisabled(true);
				})
				.addButton((button) =>
					button
						.setButtonText(t('settings.rag.copyButton'))
						.setTooltip(t('settings.rag.copyTooltip'))
						.onClick(async () => {
							await navigator.clipboard.writeText(currentStoreName);
							new Notice(t('settings.rag.storeNameCopiedNotice'));
						})
				);
		}

		new Setting(containerEl)
			.setName(t('settings.rag.autoSyncName'))
			.setDesc(t('settings.rag.autoSyncDesc'))
			.addToggle((toggle) =>
				toggle.setValue(plugin.settings.ragIndexing.autoSync).onChange(async (value) => {
					plugin.settings.ragIndexing.autoSync = value;
					await plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName(t('settings.rag.includeAttachmentsName'))
			.setDesc(t('settings.rag.includeAttachmentsDesc'))
			.addToggle((toggle) =>
				toggle.setValue(plugin.settings.ragIndexing.includeAttachments).onChange(async (value) => {
					plugin.settings.ragIndexing.includeAttachments = value;
					await plugin.saveSettings();
					new Notice(t('settings.rag.attachmentSettingChangedNotice'));
				})
			);

		// Build the list of excluded folders including system folders
		const systemFolders = [plugin.settings.historyFolder, plugin.app.vault.configDir];
		const userFolders = plugin.settings.ragIndexing.excludeFolders.filter((f) => !systemFolders.includes(f)); // Remove duplicates with system folders

		new Setting(containerEl)
			.setName(t('settings.rag.excludeFoldersName'))
			.setDesc(t('settings.rag.excludeFoldersDesc', { folders: systemFolders.join(', ') }))
			.addTextArea((text) => {
				text.inputEl.rows = 4;
				text.inputEl.cols = 30;
				text
					.setPlaceholder(t('settings.rag.excludeFoldersPlaceholder'))
					.setValue(userFolders.join('\n'))
					.onChange((value) => {
						// Filter out system folders to prevent confusion
						plugin.settings.ragIndexing.excludeFolders = value
							.split('\n')
							.map((f) => f.trim())
							.filter((f) => f.length > 0 && !systemFolders.includes(f));
						debouncedSave();
					});
			});
	}
}
