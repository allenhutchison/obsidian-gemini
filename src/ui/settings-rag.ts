import type ObsidianGemini from '../main';
import { App, Setting, Notice, debounce } from 'obsidian';
import { getErrorMessage } from '../utils/error-utils';
import { createCollapsibleSection } from './settings-helpers';
import type { SettingsSectionContext } from './settings';

export async function renderRAGSettings(
	outerContainerEl: HTMLElement,
	plugin: ObsidianGemini,
	app: App,
	context: SettingsSectionContext
): Promise<void> {
	const containerEl = createCollapsibleSection(plugin, outerContainerEl, 'Vault Search Index (Experimental)', 'rag');
	// Debounce saveSettings() for text inputs so typing doesn't trigger the plugin
	// lifecycle on every keystroke. Settings are mutated immediately; only the save is delayed.
	// The store-name field uses `pendingStoreNameMessage` to queue a confirmation
	// notice that fires only after the save actually succeeds, so a failed save
	// doesn't surface a misleading success toast.
	let pendingStoreNameMessage: string | null = null;
	const debouncedSave = debounce(
		async () => {
			const messageToShow = pendingStoreNameMessage;
			pendingStoreNameMessage = null;
			try {
				await plugin.saveSettings();
				if (messageToShow) {
					new Notice(messageToShow);
				}
			} catch (error) {
				plugin.logger.error('Failed to save RAG settings:', error);
				new Notice(`Failed to save settings: ${getErrorMessage(error)}`);
			}
		},
		300,
		true
	);

	// Privacy warning
	const privacyWarning = containerEl.createDiv({ cls: 'setting-item' });
	privacyWarning.createEl('div', {
		cls: 'setting-item-description',
		text:
			'⚠️ Privacy Notice: Enabling this feature uploads your vault files to Google Cloud for semantic search. ' +
			'Files are processed and stored by Google. Consider excluding folders with sensitive information.',
	});
	privacyWarning.style.marginBottom = '1em';
	privacyWarning.style.color = 'var(--text-warning)';

	new Setting(containerEl)
		.setName('Enable vault indexing')
		.setDesc('Index your vault files for semantic search using Google File Search.')
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.ragIndexing.enabled).onChange(async (value) => {
				if (!value && plugin.settings.ragIndexing.fileSearchStoreName) {
					// Revert toggle immediately - will only change if user confirms
					toggle.setValue(true);

					// Show cleanup modal when disabling
					try {
						const { RagCleanupModal } = await import('./rag-cleanup-modal');
						const modal = new RagCleanupModal(app, async (deleteData) => {
							if (deleteData && plugin.ragIndexing) {
								await plugin.ragIndexing.deleteFileSearchStore();
							}
							plugin.settings.ragIndexing.enabled = false;
							await plugin.saveSettings();
							context.redisplay();
						});
						modal.open();
					} catch (error) {
						plugin.logger.error('Failed to load RAG cleanup modal:', error);
						new Notice(`Failed to open cleanup dialog: ${getErrorMessage(error)}`);
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
			? `${indexCount} files indexed`
			: 'Not yet indexed';

		new Setting(containerEl)
			.setName('Index status')
			.setDesc(statusText)
			.addButton((button) =>
				button.setButtonText('Reindex Vault').onClick(async () => {
					if (!plugin.ragIndexing) {
						new Notice('RAG indexing service not initialized');
						return;
					}

					button.setButtonText('Indexing...');
					button.setDisabled(true);

					try {
						const result = await plugin.ragIndexing.indexVault((progress) => {
							button.setButtonText(`${progress.current}/${progress.total}`);
						});

						new Notice(`Indexed ${result.indexed} files (${result.skipped} skipped, ${result.failed} failed)`);
						context.redisplay();
					} catch (error) {
						new Notice(`Indexing failed: ${getErrorMessage(error)}`);
					} finally {
						button.setButtonText('Reindex Vault');
						button.setDisabled(false);
					}
				})
			)
			.addButton((button) =>
				button
					.setButtonText('Delete Index')
					.setWarning()
					.onClick(async () => {
						if (!plugin.ragIndexing) {
							new Notice('RAG indexing service not initialized');
							return;
						}

						// Show confirmation modal
						try {
							const { RagCleanupModal } = await import('./rag-cleanup-modal');
							const modal = new RagCleanupModal(app, async (deleteData) => {
								if (deleteData && plugin.ragIndexing) {
									button.setButtonText('Deleting...');
									button.setDisabled(true);

									try {
										await plugin.ragIndexing.deleteFileSearchStore();
										new Notice('Index deleted. Use "Reindex Vault" to rebuild.');
										context.redisplay();
									} catch (error) {
										new Notice(`Failed to delete index: ${getErrorMessage(error)}`);
									} finally {
										button.setButtonText('Delete Index');
										button.setDisabled(false);
									}
								}
							});
							modal.open();
						} catch (error) {
							plugin.logger.error('Failed to load RAG cleanup modal:', error);
							new Notice(`Failed to open delete confirmation: ${getErrorMessage(error)}`);
						}
					})
			);

		// Store name setting
		const currentStoreName = plugin.settings.ragIndexing.fileSearchStoreName;
		const storeNameSetting = new Setting(containerEl)
			.setName('Search index name')
			.setDesc(
				currentStoreName
					? `Current: ${currentStoreName}. To change, disable indexing and delete the store first.`
					: 'Will be auto-generated on first index, or enter a custom name.'
			);

		if (currentStoreName) {
			// Store exists - show read-only with copy button
			storeNameSetting
				.addText((text) => {
					text.inputEl.style.width = '30ch';
					text.setValue(currentStoreName);
					text.setDisabled(true);
				})
				.addButton((button) =>
					button
						.setButtonText('Copy')
						.setTooltip('Copy store name to clipboard')
						.onClick(async () => {
							await navigator.clipboard.writeText(currentStoreName);
							new Notice('Store name copied to clipboard');
						})
				);
		} else {
			// No store yet - allow editing
			storeNameSetting.addText((text) => {
				text.inputEl.style.width = '30ch';
				text
					.setPlaceholder('Auto-generated if empty')
					.setValue('')
					.onChange((value) => {
						const trimmedValue = value.trim();
						const normalizedStoreName = trimmedValue.length > 0 ? trimmedValue : null;
						plugin.settings.ragIndexing.fileSearchStoreName = normalizedStoreName;
						// Queue the confirmation notice for the next save completion. Reusing
						// the section-level debouncedSave keeps all RAG saves on a single 300 ms
						// queue so rapid edits across fields collapse into one saveSettings call.
						pendingStoreNameMessage = normalizedStoreName
							? 'Store name set. Will be used when indexing starts.'
							: 'Store name cleared.';
						debouncedSave();
					});
			});
		}

		new Setting(containerEl)
			.setName('Auto-sync changes')
			.setDesc('Automatically update the index when files are created, modified, or deleted.')
			.addToggle((toggle) =>
				toggle.setValue(plugin.settings.ragIndexing.autoSync).onChange(async (value) => {
					plugin.settings.ragIndexing.autoSync = value;
					await plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('Include attachments')
			.setDesc('Index PDFs and other supported file types in addition to markdown notes. Requires reindexing.')
			.addToggle((toggle) =>
				toggle.setValue(plugin.settings.ragIndexing.includeAttachments).onChange(async (value) => {
					plugin.settings.ragIndexing.includeAttachments = value;
					await plugin.saveSettings();
					new Notice('Attachment setting changed. Reindex vault to apply changes.');
				})
			);

		// Build the list of excluded folders including system folders
		const systemFolders = [plugin.settings.historyFolder, '.obsidian'];
		const userFolders = plugin.settings.ragIndexing.excludeFolders.filter((f) => !systemFolders.includes(f)); // Remove duplicates with system folders

		new Setting(containerEl)
			.setName('Exclude folders')
			.setDesc(`Always excluded: ${systemFolders.join(', ')}. Add additional folders below (one per line).`)
			.addTextArea((text) => {
				text.inputEl.rows = 4;
				text.inputEl.cols = 30;
				text
					.setPlaceholder('Additional folders to exclude...')
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
