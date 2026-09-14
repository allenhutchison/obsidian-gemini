import { Notice } from 'obsidian';
import type { SettingDefinitionPage, SettingDefinitionRender } from 'obsidian';
import { getErrorMessage } from '../../utils/error-utils';
import { t } from '../../i18n';
import type { SettingsContext } from './context';
import type { SettingWriter } from './writer-types';

/**
 * Vault search index settings sub-page (settings-redesign design doc
 * §5.4/§5.5). Ex-`settings-rag.ts`, rebuilt as declarative definitions; the
 * preset/custom-shaped imperative logic (the enable-toggle confirmation flow,
 * the exclude-folders textarea round-trip) moves into `RAG_WRITERS`, which
 * WP2 registers alongside its own `SETTING_WRITERS` (design doc §5.2/§10.2).
 */
export function vaultIndexPage(ctx: SettingsContext): SettingDefinitionPage {
	const { plugin } = ctx;

	return {
		type: 'page',
		name: t('settings.main.vaultSearchIndexName'),
		displayValue: () => {
			if (!plugin.settings.ragIndexing.enabled) return t('settings.rag.summaryOff');
			const count = plugin.ragIndexing?.getIndexedFileCount() ?? 0;
			return t('settings.rag.summaryOn', { count });
		},
		items: [
			{
				name: t('settings.rag.privacyNoticeName'),
				desc: t('settings.rag.privacyNotice'),
			},
			{
				name: t('settings.rag.enableName'),
				desc: t('settings.rag.enableDesc'),
				control: { type: 'toggle', key: 'ragIndexing.enabled' },
			},
			statusRow(ctx),
			indexNameRow(ctx),
			{
				type: 'group',
				heading: t('settings.rag.whatGetsIndexedHeading'),
				visible: () => plugin.settings.ragIndexing.enabled,
				items: [
					{
						name: t('settings.rag.autoSyncName'),
						desc: t('settings.rag.autoSyncDesc'),
						control: { type: 'toggle', key: 'ragIndexing.autoSync' },
					},
					{
						name: t('settings.rag.includeAttachmentsName'),
						desc: t('settings.rag.includeAttachmentsDesc'),
						control: { type: 'toggle', key: 'ragIndexing.includeAttachments' },
					},
					{
						name: t('settings.rag.excludeFoldersName'),
						desc: t('settings.rag.excludeFoldersDesc', { folders: systemFolders(ctx).join(', ') }),
						control: {
							type: 'textarea',
							key: 'ragIndexing.excludeFolders',
							placeholder: t('settings.rag.excludeFoldersPlaceholder'),
							rows: 4,
						},
					},
				],
			},
		],
	};
}

function systemFolders(ctx: SettingsContext): string[] {
	return [ctx.plugin.settings.historyFolder, ctx.plugin.app.vault.configDir];
}

function statusRow(ctx: SettingsContext): SettingDefinitionRender {
	const { plugin, app } = ctx;
	return {
		name: t('settings.rag.statusName'),
		visible: () => plugin.settings.ragIndexing.enabled,
		render: (setting) => {
			const hasStore = !!plugin.settings.ragIndexing.fileSearchStoreName;
			const indexCount = plugin.ragIndexing?.getIndexedFileCount() ?? 0;
			setting.setName(t('settings.rag.statusName'));
			setting.setDesc(
				hasStore ? t('settings.rag.filesIndexed', { count: indexCount }) : t('settings.rag.notYetIndexed')
			);

			setting.addButton((button) => {
				button.setButtonText(t('settings.rag.reindexButton')).onClick(async () => {
					const ragIndexing = plugin.ragIndexing;
					if (!ragIndexing) {
						new Notice(t('settings.rag.serviceNotInitialized'));
						return;
					}
					button.setButtonText(t('settings.rag.indexingButton'));
					button.setDisabled(true);
					try {
						const result = await ragIndexing.indexVault((progress) => {
							button.setButtonText(`${progress.current}/${progress.total}`);
						});
						new Notice(
							t('settings.rag.indexResult', {
								indexed: result.indexed,
								skipped: result.skipped,
								failed: result.failed,
							})
						);
						ctx.tab.update();
					} catch (error) {
						new Notice(t('settings.rag.indexingFailed', { error: getErrorMessage(error) }));
					} finally {
						button.setButtonText(t('settings.rag.reindexButton'));
						button.setDisabled(false);
					}
				});
			});

			setting.addButton((button) => {
				button
					.setButtonText(t('settings.rag.deleteIndexButton'))
					.setDestructive()
					.onClick(async () => {
						const ragIndexing = plugin.ragIndexing;
						if (!ragIndexing) {
							new Notice(t('settings.rag.serviceNotInitialized'));
							return;
						}
						try {
							const { RagCleanupModal } = await import('../rag-cleanup-modal');
							const modal = new RagCleanupModal(app, (deleteData) => {
								void (async () => {
									if (!deleteData) return;
									button.setButtonText(t('settings.rag.deletingButton'));
									button.setDisabled(true);
									try {
										await ragIndexing.deleteFileSearchStore();
										new Notice(t('settings.rag.indexDeletedNotice'));
										ctx.tab.update();
									} catch (error) {
										new Notice(t('settings.rag.deleteIndexFailed', { error: getErrorMessage(error) }));
									} finally {
										button.setButtonText(t('settings.rag.deleteIndexButton'));
										button.setDisabled(false);
									}
								})();
							});
							modal.open();
						} catch (error) {
							plugin.logger.error('Failed to load RAG cleanup modal:', error);
							new Notice(t('settings.rag.openDeleteConfirmFailed', { error: getErrorMessage(error) }));
						}
					});
			});
		},
	};
}

function indexNameRow(ctx: SettingsContext): SettingDefinitionRender {
	const { plugin } = ctx;
	return {
		name: t('settings.rag.storeNameName'),
		visible: () => plugin.settings.ragIndexing.enabled,
		render: (setting) => {
			const storeName = plugin.settings.ragIndexing.fileSearchStoreName;
			setting.setName(t('settings.rag.storeNameName'));
			setting.setDesc(storeName ? t('settings.rag.storeNameDescAssigned') : t('settings.rag.storeNameDescPending'));
			if (!storeName) return;

			setting.addText((text) => {
				text.setValue(storeName);
				text.setDisabled(true);
			});
			setting.addButton((button) => {
				button
					.setButtonText(t('settings.rag.copyButton'))
					.setTooltip(t('settings.rag.copyTooltip'))
					.onClick(async () => {
						await navigator.clipboard.writeText(storeName);
						new Notice(t('settings.rag.storeNameCopiedNotice'));
					});
			});
		},
	};
}

/**
 * Writers for `ragIndexing.*` paths that need more than a plain assignment
 * (settings-redesign design doc §5.2). WP2 merges these into its own
 * `SETTING_WRITERS` map alongside the longest-prefix matching rule.
 */
export const RAG_WRITERS: Record<string, SettingWriter> = {
	'ragIndexing.enabled': async (plugin, _key, value) => {
		if (value === true) {
			plugin.settings.ragIndexing.enabled = true;
			return { needsUpdate: true };
		}
		if (!plugin.settings.ragIndexing.fileSearchStoreName) {
			plugin.settings.ragIndexing.enabled = false;
			return { needsUpdate: true };
		}
		// An existing store: ask whether to delete the remote data before
		// disabling. The promise resolves only when the user picks one of the
		// modal's two buttons — closing without choosing leaves the write
		// pending, i.e. rejected, exactly like the pre-redesign toggle revert.
		const deleteData = await new Promise<boolean>((resolve) => {
			void (async () => {
				try {
					const { RagCleanupModal } = await import('../rag-cleanup-modal');
					new RagCleanupModal(plugin.app, resolve).open();
				} catch (error) {
					plugin.logger.error('Failed to load RAG cleanup modal:', error);
					// The modal itself failed to load; nothing was confirmed, so
					// leave ragIndexing.enabled untouched and never resolve here —
					// the write stays rejected rather than silently disabling.
				}
			})();
		});

		try {
			if (deleteData && plugin.ragIndexing) {
				await plugin.ragIndexing.deleteFileSearchStore();
			}
			plugin.settings.ragIndexing.enabled = false;
			return { needsUpdate: true };
		} catch (error) {
			plugin.logger.error('Failed to disable RAG indexing:', error);
			return { needsUpdate: true };
		}
	},

	'ragIndexing.excludeFolders': async (plugin, _key, value) => {
		if (typeof value !== 'string') return { needsUpdate: false };
		const systemFoldersList = [plugin.settings.historyFolder, plugin.app.vault.configDir];
		plugin.settings.ragIndexing.excludeFolders = value
			.split('\n')
			.map((f) => f.trim())
			.filter((f) => f.length > 0 && !systemFoldersList.includes(f));
		return { needsUpdate: false };
	},
};
