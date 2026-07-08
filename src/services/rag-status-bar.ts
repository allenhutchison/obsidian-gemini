import { App, Notice, setIcon, setTooltip } from 'obsidian';
import type { ObsidianGemini } from '../types/plugin';
import type { RagIndexStatus, RagProgressInfo, IndexResult, ProgressListener, RagDetailedStatus } from './rag-types';
import { getErrorMessage } from '../utils/error-utils';
import { openPluginSettingsTab } from '../utils/obsidian-settings';
import { t } from '../i18n';

/**
 * Interface for the status bar to query service state without direct coupling.
 */
export interface RagStatusProvider {
	getStatus(): RagIndexStatus;
	getIndexedFileCount(): number;
	getIndexingProgress(): { current: number; total: number };
	getProgressInfo(): RagProgressInfo;
	isPaused(): boolean;
	getRateLimitRemainingSeconds(): number;
	getDetailedStatus(): RagDetailedStatus;
	indexVault(): Promise<IndexResult>;
	syncPendingChanges(): Promise<boolean>;
	addProgressListener(listener: ProgressListener): void;
	removeProgressListener(listener: ProgressListener): void;
	cancelIndexing(): void;
}

/**
 * Open the RAG status modal, wiring up the shared open-settings / reindex / sync-now
 * callbacks. Shared by the status-bar click handler and the "RAG status" command so the
 * modal is constructed in exactly one place.
 */
export async function openRagStatusModal(app: App, provider: RagStatusProvider, pluginId: string): Promise<void> {
	const { RagStatusModal } = await import('../ui/rag-status-modal');
	const modal = new RagStatusModal(
		app,
		provider.getDetailedStatus(),
		() => {
			// Open settings to the RAG section
			openPluginSettingsTab(app, pluginId);
		},
		async () => {
			// Open progress modal and start reindexing
			const { RagProgressModal } = await import('../ui/rag-progress-modal');
			const progressModal = new RagProgressModal(app, provider, (result) => {
				new Notice(t('notice.rag.indexingComplete', { indexed: result.indexed, skipped: result.skipped }));
			});
			progressModal.open();

			// Trigger reindex (don't await - modal handles progress)
			provider.indexVault().catch((error) => {
				new Notice(t('notice.rag.indexingFailed', { error: getErrorMessage(error) }));
			});
		},
		async () => {
			// Sync pending changes immediately
			const synced = await provider.syncPendingChanges();
			if (synced) {
				new Notice(t('notice.rag.syncingPending'));
			}
			return synced;
		}
	);
	modal.open();
}

/**
 * Manages the status bar indicator for the RAG indexing service.
 */
export class RagStatusBar {
	private plugin: ObsidianGemini;
	private provider: RagStatusProvider;
	private statusBarItem: HTMLElement | null = null;

	constructor(plugin: ObsidianGemini, provider: RagStatusProvider) {
		this.plugin = plugin;
		this.provider = provider;
	}

	/**
	 * Setup the status bar indicator
	 */
	setup(): void {
		if (this.statusBarItem) return;

		this.statusBarItem = this.plugin.addStatusBarItem();
		this.statusBarItem.addClass('rag-status-bar');

		// Create icon container
		const iconEl = this.statusBarItem.createSpan({ cls: 'rag-status-icon' });
		setIcon(iconEl, 'database');

		// Create text element for file count
		this.statusBarItem.createSpan({ cls: 'rag-status-text' });

		this.statusBarItem.addEventListener('click', () => {
			void (async () => {
				try {
					// Show progress modal if indexing, otherwise show status modal
					if (this.provider.getStatus() === 'indexing') {
						const { RagProgressModal } = await import('../ui/rag-progress-modal');
						const modal = new RagProgressModal(this.plugin.app, this.provider, (result) => {
							new Notice(t('notice.rag.indexingSummary', { indexed: result.indexed, skipped: result.skipped }));
						});
						modal.open();
					} else {
						await openRagStatusModal(this.plugin.app, this.provider, this.plugin.manifest.id);
					}
				} catch (error) {
					this.plugin.logger.error('RAG Indexing: Failed to open status UI', error);
					new Notice(t('notice.rag.uiError', { error: getErrorMessage(error) }));
				}
			})();
		});
	}

	/**
	 * Update the status bar display
	 */
	update(): void {
		if (!this.statusBarItem) return;

		const iconEl = this.statusBarItem.querySelector('.rag-status-icon') as HTMLElement;
		const textEl = this.statusBarItem.querySelector('.rag-status-text') as HTMLElement;

		if (!iconEl || !textEl) return;

		// Remove animation class by default
		this.statusBarItem.removeClass('rag-indexing');

		const status = this.provider.getStatus();
		const indexedCount = this.provider.getIndexedFileCount();
		const indexingProgress = this.provider.getIndexingProgress();
		let tooltip = '';

		switch (status) {
			case 'disabled':
				this.statusBarItem.hide();
				break;
			case 'idle':
				this.statusBarItem.show();
				setIcon(iconEl, 'database');
				textEl.setText(`${indexedCount}`);
				tooltip = t('statusbar.rag.indexed', { count: indexedCount });
				break;
			case 'indexing':
				this.statusBarItem.show();
				this.statusBarItem.addClass('rag-indexing');
				setIcon(iconEl, 'upload-cloud');
				if (indexingProgress.total > 0) {
					const pct = Math.round((indexingProgress.current / indexingProgress.total) * 100);
					textEl.setText(`${pct}%`);
					tooltip = t('statusbar.rag.uploading', { current: indexingProgress.current, total: indexingProgress.total });
				} else {
					textEl.setText('...');
					tooltip = t('statusbar.rag.indexing');
				}
				break;
			case 'error':
				this.statusBarItem.show();
				setIcon(iconEl, 'alert-triangle');
				textEl.setText('');
				tooltip = t('statusbar.rag.error');
				break;
			case 'paused':
				this.statusBarItem.show();
				setIcon(iconEl, 'pause-circle');
				textEl.setText('');
				tooltip = t('statusbar.rag.paused');
				break;
			case 'rate_limited': {
				this.statusBarItem.show();
				setIcon(iconEl, 'clock');
				const remaining = this.provider.getRateLimitRemainingSeconds();
				textEl.setText(`${remaining}s`);
				tooltip = t('statusbar.rag.rateLimited', { seconds: remaining });
				break;
			}
		}

		if (tooltip) {
			setTooltip(this.statusBarItem, tooltip, { placement: 'top' });
		}
	}

	/**
	 * Cleanup resources
	 */
	destroy(): void {
		if (this.statusBarItem) {
			this.statusBarItem.remove();
			this.statusBarItem = null;
		}
	}
}
