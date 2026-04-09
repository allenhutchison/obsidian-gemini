import { Notice, setIcon, setTooltip } from 'obsidian';
import type ObsidianGemini from '../main';
import type { RagIndexStatus, RagProgressInfo, IndexResult, ProgressListener } from './rag-types';
import { getErrorMessage } from '../utils/error-utils';

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
	getDetailedStatus(): any;
	indexVault(): Promise<IndexResult>;
	syncPendingChanges(): Promise<boolean>;
	addProgressListener(listener: ProgressListener): void;
	removeProgressListener(listener: ProgressListener): void;
	cancelIndexing(): void;
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

		this.statusBarItem.addEventListener('click', async () => {
			// Show progress modal if indexing, otherwise show status modal
			if (this.provider.getStatus() === 'indexing') {
				const { RagProgressModal } = await import('../ui/rag-progress-modal');
				const modal = new RagProgressModal(this.plugin.app, this.provider, (result) => {
					new Notice(`RAG Indexing: ${result.indexed} indexed, ${result.skipped} unchanged`);
				});
				modal.open();
			} else {
				const { RagStatusModal } = await import('../ui/rag-status-modal');
				const modal = new RagStatusModal(
					this.plugin.app,
					this.provider.getDetailedStatus(),
					() => {
						// Open settings to RAG section
						// @ts-expect-error - Obsidian's setting API
						this.plugin.app.setting.open();
						// @ts-expect-error - Obsidian's setting API
						this.plugin.app.setting.openTabById('gemini-scribe');
					},
					async () => {
						// Open progress modal and start reindexing
						const { RagProgressModal } = await import('../ui/rag-progress-modal');
						const progressModal = new RagProgressModal(this.plugin.app, this.provider, (result) => {
							new Notice(`RAG Indexing complete: ${result.indexed} indexed, ${result.skipped} unchanged`);
						});
						progressModal.open();

						// Trigger reindex (don't await - modal handles progress)
						this.provider.indexVault().catch((error) => {
							new Notice(`RAG Indexing failed: ${getErrorMessage(error)}`);
						});
					},
					async () => {
						// Sync pending changes immediately
						const synced = await this.provider.syncPendingChanges();
						if (synced) {
							new Notice('RAG Index: Syncing pending changes...');
						}
						return synced;
					}
				);
				modal.open();
			}
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
				this.statusBarItem.style.display = 'none';
				break;
			case 'idle':
				this.statusBarItem.style.display = '';
				setIcon(iconEl, 'database');
				textEl.setText(`${indexedCount}`);
				tooltip = `RAG Index: ${indexedCount} files indexed`;
				break;
			case 'indexing':
				this.statusBarItem.style.display = '';
				this.statusBarItem.addClass('rag-indexing');
				setIcon(iconEl, 'upload-cloud');
				if (indexingProgress.total > 0) {
					const pct = Math.round((indexingProgress.current / indexingProgress.total) * 100);
					textEl.setText(`${pct}%`);
					tooltip = `RAG Index: Uploading ${indexingProgress.current}/${indexingProgress.total}...`;
				} else {
					textEl.setText('...');
					tooltip = 'RAG Index: Indexing...';
				}
				break;
			case 'error':
				this.statusBarItem.style.display = '';
				setIcon(iconEl, 'alert-triangle');
				textEl.setText('');
				tooltip = 'RAG Index: Error - click for details';
				break;
			case 'paused':
				this.statusBarItem.style.display = '';
				setIcon(iconEl, 'pause-circle');
				textEl.setText('');
				tooltip = 'RAG Index: Paused';
				break;
			case 'rate_limited': {
				this.statusBarItem.style.display = '';
				setIcon(iconEl, 'clock');
				const remaining = this.provider.getRateLimitRemainingSeconds();
				textEl.setText(`${remaining}s`);
				tooltip = `RAG Index: Rate limited - waiting ${remaining}s`;
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
