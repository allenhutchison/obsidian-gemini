import { App, Modal, Notice, Setting, setIcon } from 'obsidian';
import type { RagIndexStatus, FailedFileEntry } from '../services/rag-types';
import { getRawErrorMessage } from '../utils/error-utils';
import { formatRelativeTime } from '../utils/format-relative-time';
import { t } from '../i18n';

/**
 * Detailed status information for the modal
 */
export interface RagDetailedStatus {
	status: RagIndexStatus;
	indexedCount: number;
	failedCount: number;
	pendingCount: number;
	storeName: string | null;
	lastSync: number | null;
	indexedFiles: Array<{ path: string; lastIndexed: number }>;
	failedFiles: FailedFileEntry[];
}

type TabId = 'overview' | 'files' | 'failures';

/**
 * Modal showing detailed RAG indexing status with tabs
 */
export class RagStatusModal extends Modal {
	private statusInfo: RagDetailedStatus;
	private onOpenSettings: () => void;
	private onReindex: () => void | Promise<void>;
	private onSyncNow: () => Promise<boolean>;

	private activeTab: TabId = 'overview';
	private searchQuery: string = '';
	private showAllFiles: boolean = false;
	private readonly MAX_FILES_INITIAL = 200;
	private debounceTimer: number | null = null;

	constructor(
		app: App,
		statusInfo: RagDetailedStatus,
		onOpenSettings: () => void,
		onReindex: () => void | Promise<void>,
		onSyncNow: () => Promise<boolean>
	) {
		super(app);
		this.statusInfo = statusInfo;
		this.onOpenSettings = onOpenSettings;
		this.onReindex = onReindex;
		this.onSyncNow = onSyncNow;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('rag-status-modal');
		this.modalEl.addClass('mod-rag-status-modal');

		// Header with icon
		const headerEl = contentEl.createDiv({ cls: 'rag-status-header' });
		const iconEl = headerEl.createSpan({ cls: 'rag-status-header-icon' });
		this.setStatusIcon(iconEl);
		headerEl.createEl('h2', { text: t('ragStatus.title') });

		// Tabs
		this.renderTabs(contentEl);

		// Tab content container
		const contentContainer = contentEl.createDiv({ cls: 'rag-status-content' });
		this.renderTabContent(contentContainer);
	}

	onClose() {
		// Clear any pending debounce timer to prevent updates after modal is closed
		if (this.debounceTimer) {
			window.clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
	}

	private renderTabs(container: HTMLElement): void {
		const tabsEl = container.createDiv({ cls: 'rag-status-tabs' });

		// Overview tab
		this.createTab(tabsEl, 'overview', t('ragStatus.tabOverview'));

		// Files tab with count
		this.createTab(tabsEl, 'files', t('ragStatus.tabFiles', { count: this.statusInfo.indexedCount.toLocaleString() }));

		// Failures tab with count (only show if there are failures)
		if (this.statusInfo.failedCount > 0) {
			this.createTab(tabsEl, 'failures', t('ragStatus.tabFailures', { count: this.statusInfo.failedCount }));
		}
	}

	private createTab(container: HTMLElement, tabId: TabId, label: string): void {
		const tab = container.createDiv({
			cls: `rag-status-tab ${this.activeTab === tabId ? 'rag-status-tab-active' : ''}`,
			text: label,
		});
		tab.addEventListener('click', () => {
			this.activeTab = tabId;
			this.showAllFiles = false;
			this.searchQuery = '';
			this.refresh();
		});
	}

	private renderTabContent(container: HTMLElement): void {
		container.empty();

		switch (this.activeTab) {
			case 'overview':
				this.renderOverviewTab(container);
				break;
			case 'files':
				this.renderFilesTab(container);
				break;
			case 'failures':
				this.renderFailuresTab(container);
				break;
		}
	}

	private renderOverviewTab(container: HTMLElement): void {
		const infoEl = container.createDiv({ cls: 'rag-status-info' });

		// Status row
		const statusRow = infoEl.createDiv({ cls: 'rag-status-row' });
		statusRow.createSpan({ cls: 'rag-status-label', text: t('ragStatus.statusLabel') });
		const statusValue = statusRow.createSpan({ cls: 'rag-status-value' });
		statusValue.setText(this.getStatusText());
		statusValue.addClass(this.getStatusClass());

		// Files indexed row
		const filesRow = infoEl.createDiv({ cls: 'rag-status-row' });
		filesRow.createSpan({ cls: 'rag-status-label', text: t('ragStatus.filesIndexedLabel') });
		filesRow.createSpan({ cls: 'rag-status-value', text: this.statusInfo.indexedCount.toLocaleString() });

		// Pending changes row
		const pendingRow = infoEl.createDiv({ cls: 'rag-status-row' });
		pendingRow.createSpan({ cls: 'rag-status-label', text: t('ragStatus.pendingLabel') });
		pendingRow.createSpan({
			cls: 'rag-status-value',
			text:
				this.statusInfo.pendingCount === 1
					? t('ragStatus.changeSingular', { count: this.statusInfo.pendingCount })
					: t('ragStatus.changePlural', { count: this.statusInfo.pendingCount }),
		});

		// Failures row (if any)
		if (this.statusInfo.failedCount > 0) {
			const failedRow = infoEl.createDiv({ cls: 'rag-status-row' });
			failedRow.createSpan({ cls: 'rag-status-label', text: t('ragStatus.failedLabel') });
			const failedValue = failedRow.createSpan({ cls: 'rag-status-value rag-status-error' });
			failedValue.setText(
				this.statusInfo.failedCount === 1
					? t('ragStatus.fileSingular', { count: this.statusInfo.failedCount })
					: t('ragStatus.filePlural', { count: this.statusInfo.failedCount })
			);
		}

		// Last sync row
		if (this.statusInfo.lastSync) {
			const syncRow = infoEl.createDiv({ cls: 'rag-status-row' });
			syncRow.createSpan({ cls: 'rag-status-label', text: t('ragStatus.lastSyncLabel') });
			syncRow.createSpan({
				cls: 'rag-status-value',
				text: formatRelativeTime(this.statusInfo.lastSync),
			});
		}

		// Store name row
		if (this.statusInfo.storeName) {
			const storeRow = infoEl.createDiv({ cls: 'rag-status-row' });
			storeRow.createSpan({ cls: 'rag-status-label', text: t('ragStatus.storeLabel') });
			const storeValue = storeRow.createSpan({ cls: 'rag-status-value rag-status-store' });
			storeValue.setText(this.statusInfo.storeName);
		}

		// Actions
		const isIndexing = this.statusInfo.status === 'indexing';
		const hasPending = this.statusInfo.pendingCount > 0;

		new Setting(container)
			.addButton((btn) =>
				btn
					.setButtonText(t('ragStatus.syncNowButton'))
					.setDisabled(isIndexing || !hasPending)
					.setTooltip(hasPending ? t('ragStatus.syncTooltipPending') : t('ragStatus.syncTooltipNone'))
					.onClick(async () => {
						btn.setDisabled(true);
						btn.setButtonText(t('ragStatus.syncing'));
						try {
							await this.onSyncNow();
							this.close();
						} catch (error) {
							const message = getRawErrorMessage(error);
							new Notice(t('ragStatus.syncFailed', { message }));
							btn.setButtonText(t('ragStatus.syncNowButton'));
							btn.setDisabled(false);
						}
					})
			)
			.addButton((btn) =>
				btn
					.setButtonText(t('ragStatus.reindexButton'))
					.setDisabled(isIndexing)
					.onClick(() => {
						this.close();
						void this.onReindex();
					})
			)
			.addButton((btn) =>
				btn
					.setButtonText(t('ragStatus.settingsButton'))
					.setCta()
					.onClick(() => {
						this.close();
						this.onOpenSettings();
					})
			);
	}

	private renderFilesTab(container: HTMLElement): void {
		// Search input
		const searchContainer = container.createDiv({ cls: 'rag-status-search-container' });
		const searchInput = searchContainer.createEl('input', {
			cls: 'rag-status-search',
			attr: {
				type: 'text',
				placeholder: t('ragStatus.searchPlaceholder'),
				value: this.searchQuery,
			},
		});

		searchInput.addEventListener('input', (e) => {
			if (this.debounceTimer) {
				window.clearTimeout(this.debounceTimer);
			}
			this.debounceTimer = window.setTimeout(() => {
				this.searchQuery = (e.target as HTMLInputElement).value;
				this.renderFileList(listContainer);
			}, 150);
		});

		// File list container
		const listContainer = container.createDiv({ cls: 'rag-status-file-list' });
		this.renderFileList(listContainer);
	}

	private renderFileList(container: HTMLElement): void {
		container.empty();

		if (this.statusInfo.indexedFiles.length === 0) {
			container.createDiv({
				cls: 'rag-status-empty',
				text: t('ragStatus.noFilesIndexed'),
			});
			return;
		}

		// Filter files by search query
		let filteredFiles = this.statusInfo.indexedFiles;
		if (this.searchQuery) {
			const query = this.searchQuery.toLowerCase();
			filteredFiles = filteredFiles.filter((f) => f.path.toLowerCase().includes(query));
		}

		if (filteredFiles.length === 0) {
			container.createDiv({
				cls: 'rag-status-empty',
				text: t('ragStatus.noSearchMatches'),
			});
			return;
		}

		// Limit display unless "show all" is enabled
		const totalFiles = filteredFiles.length;
		const displayFiles = this.showAllFiles ? filteredFiles : filteredFiles.slice(0, this.MAX_FILES_INITIAL);

		// Render file items
		for (const file of displayFiles) {
			const item = container.createDiv({ cls: 'rag-status-file-item' });

			const pathEl = item.createSpan({ cls: 'rag-status-file-path' });
			pathEl.setText(file.path);
			pathEl.setAttribute('title', file.path);

			const timeEl = item.createSpan({ cls: 'rag-status-file-time' });
			timeEl.setText(formatRelativeTime(file.lastIndexed));
		}

		// Show "load more" button if there are more files
		if (!this.showAllFiles && totalFiles > this.MAX_FILES_INITIAL) {
			const moreButton = container.createDiv({ cls: 'rag-status-show-more' });
			moreButton.setText(t('ragStatus.showAllFiles', { count: totalFiles.toLocaleString() }));
			moreButton.addEventListener('click', () => {
				this.showAllFiles = true;
				this.renderFileList(container);
			});
		}
	}

	private renderFailuresTab(container: HTMLElement): void {
		if (this.statusInfo.failedFiles.length === 0) {
			container.createDiv({
				cls: 'rag-status-empty',
				text: t('ragStatus.noFailures'),
			});
			return;
		}

		const listContainer = container.createDiv({ cls: 'rag-status-failure-list' });

		for (const failure of this.statusInfo.failedFiles) {
			const item = listContainer.createDiv({ cls: 'rag-status-failure-item' });

			const headerRow = item.createDiv({ cls: 'rag-status-failure-header' });
			const iconEl = headerRow.createSpan({ cls: 'rag-status-failure-icon' });
			setIcon(iconEl, 'x-circle');

			const pathEl = headerRow.createSpan({ cls: 'rag-status-failure-path' });
			pathEl.setText(failure.path);
			pathEl.setAttribute('title', failure.path);

			const timeEl = headerRow.createSpan({ cls: 'rag-status-failure-time' });
			timeEl.setText(formatRelativeTime(failure.timestamp));

			const errorEl = item.createDiv({ cls: 'rag-status-failure-error' });
			errorEl.setText(failure.error);
		}
	}

	private refresh(): void {
		const { contentEl } = this;
		const contentContainer = contentEl.querySelector('.rag-status-content');
		const tabsContainer = contentEl.querySelector('.rag-status-tabs');

		if (tabsContainer) {
			tabsContainer.remove();
		}

		// Re-render tabs
		const header = contentEl.querySelector('.rag-status-header');
		if (header) {
			const tabsEl = contentEl.createDiv({ cls: 'rag-status-tabs' });
			header.insertAdjacentElement('afterend', tabsEl);

			// Overview tab
			this.createTab(tabsEl, 'overview', t('ragStatus.tabOverview'));

			// Files tab with count
			this.createTab(
				tabsEl,
				'files',
				t('ragStatus.tabFiles', { count: this.statusInfo.indexedCount.toLocaleString() })
			);

			// Failures tab with count
			if (this.statusInfo.failedCount > 0) {
				this.createTab(tabsEl, 'failures', t('ragStatus.tabFailures', { count: this.statusInfo.failedCount }));
			}
		}

		if (contentContainer) {
			this.renderTabContent(contentContainer as HTMLElement);
		}
	}

	private setStatusIcon(el: HTMLElement): void {
		switch (this.statusInfo.status) {
			case 'idle':
				setIcon(el, 'database');
				break;
			case 'indexing':
				setIcon(el, 'upload-cloud');
				break;
			case 'error':
				setIcon(el, 'alert-triangle');
				break;
			case 'paused':
				setIcon(el, 'pause-circle');
				break;
			case 'rate_limited':
				setIcon(el, 'clock');
				break;
			default:
				setIcon(el, 'database');
		}
	}

	private getStatusText(): string {
		switch (this.statusInfo.status) {
			case 'idle':
				return t('ragStatus.statusReady');
			case 'indexing':
				return t('ragStatus.statusIndexing');
			case 'error':
				return t('ragStatus.statusError');
			case 'paused':
				return t('ragStatus.statusPaused');
			case 'disabled':
				return t('ragStatus.statusDisabled');
			case 'rate_limited':
				return t('ragStatus.statusRateLimited');
			default:
				return t('ragStatus.statusUnknown');
		}
	}

	private getStatusClass(): string {
		switch (this.statusInfo.status) {
			case 'idle':
				return 'rag-status-ready';
			case 'indexing':
				return 'rag-status-indexing';
			case 'error':
				return 'rag-status-error';
			case 'paused':
				return 'rag-status-paused';
			case 'rate_limited':
				return 'rag-status-rate-limited';
			default:
				return '';
		}
	}
}
