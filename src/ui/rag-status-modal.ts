import { App, Modal, Notice, Setting, setIcon } from 'obsidian';
import type { RagIndexStatus, FailedFileEntry } from '../services/rag-indexing';

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
	private onReindex: () => void;
	private onSyncNow: () => Promise<boolean>;

	private activeTab: TabId = 'overview';
	private searchQuery: string = '';
	private showAllFiles: boolean = false;
	private readonly MAX_FILES_INITIAL = 200;
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		app: App,
		statusInfo: RagDetailedStatus,
		onOpenSettings: () => void,
		onReindex: () => void,
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

		// Header with icon
		const headerEl = contentEl.createDiv({ cls: 'rag-status-header' });
		const iconEl = headerEl.createSpan({ cls: 'rag-status-header-icon' });
		this.setStatusIcon(iconEl);
		headerEl.createEl('h2', { text: 'RAG Index Status' });

		// Tabs
		this.renderTabs(contentEl);

		// Tab content container
		const contentContainer = contentEl.createDiv({ cls: 'rag-status-content' });
		this.renderTabContent(contentContainer);
	}

	onClose() {
		// Clear any pending debounce timer to prevent updates after modal is closed
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
	}

	private renderTabs(container: HTMLElement): void {
		const tabsEl = container.createDiv({ cls: 'rag-status-tabs' });

		// Overview tab
		this.createTab(tabsEl, 'overview', 'Overview');

		// Files tab with count
		this.createTab(tabsEl, 'files', `Files (${this.statusInfo.indexedCount.toLocaleString()})`);

		// Failures tab with count (only show if there are failures)
		if (this.statusInfo.failedCount > 0) {
			this.createTab(tabsEl, 'failures', `Failures (${this.statusInfo.failedCount})`);
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
		statusRow.createSpan({ cls: 'rag-status-label', text: 'Status' });
		const statusValue = statusRow.createSpan({ cls: 'rag-status-value' });
		statusValue.setText(this.getStatusText());
		statusValue.addClass(this.getStatusClass());

		// Files indexed row
		const filesRow = infoEl.createDiv({ cls: 'rag-status-row' });
		filesRow.createSpan({ cls: 'rag-status-label', text: 'Files indexed' });
		filesRow.createSpan({ cls: 'rag-status-value', text: this.statusInfo.indexedCount.toLocaleString() });

		// Pending changes row
		const pendingRow = infoEl.createDiv({ cls: 'rag-status-row' });
		pendingRow.createSpan({ cls: 'rag-status-label', text: 'Pending' });
		pendingRow.createSpan({
			cls: 'rag-status-value',
			text: `${this.statusInfo.pendingCount} change${this.statusInfo.pendingCount !== 1 ? 's' : ''}`,
		});

		// Failures row (if any)
		if (this.statusInfo.failedCount > 0) {
			const failedRow = infoEl.createDiv({ cls: 'rag-status-row' });
			failedRow.createSpan({ cls: 'rag-status-label', text: 'Failed' });
			const failedValue = failedRow.createSpan({ cls: 'rag-status-value rag-status-error' });
			failedValue.setText(`${this.statusInfo.failedCount} file${this.statusInfo.failedCount !== 1 ? 's' : ''}`);
		}

		// Last sync row
		if (this.statusInfo.lastSync) {
			const syncRow = infoEl.createDiv({ cls: 'rag-status-row' });
			syncRow.createSpan({ cls: 'rag-status-label', text: 'Last sync' });
			syncRow.createSpan({
				cls: 'rag-status-value',
				text: this.formatDate(this.statusInfo.lastSync),
			});
		}

		// Store name row
		if (this.statusInfo.storeName) {
			const storeRow = infoEl.createDiv({ cls: 'rag-status-row' });
			storeRow.createSpan({ cls: 'rag-status-label', text: 'Store' });
			const storeValue = storeRow.createSpan({ cls: 'rag-status-value rag-status-store' });
			storeValue.setText(this.statusInfo.storeName);
		}

		// Actions
		const isIndexing = this.statusInfo.status === 'indexing';
		const hasPending = this.statusInfo.pendingCount > 0;

		new Setting(container)
			.addButton((btn) =>
				btn
					.setButtonText('Sync Now')
					.setDisabled(isIndexing || !hasPending)
					.setTooltip(hasPending ? 'Process pending changes now' : 'No pending changes')
					.onClick(async () => {
						btn.setDisabled(true);
						btn.setButtonText('Syncing...');
						try {
							await this.onSyncNow();
							this.close();
						} catch (error) {
							const message = error instanceof Error ? error.message : String(error);
							new Notice(`Sync failed: ${message}`);
							btn.setButtonText('Sync Now');
							btn.setDisabled(false);
						}
					})
			)
			.addButton((btn) =>
				btn
					.setButtonText('Reindex All')
					.setDisabled(isIndexing)
					.onClick(() => {
						this.close();
						this.onReindex();
					})
			)
			.addButton((btn) =>
				btn
					.setButtonText('Settings')
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
				placeholder: 'Search files...',
				value: this.searchQuery,
			},
		});

		searchInput.addEventListener('input', (e) => {
			if (this.debounceTimer) {
				clearTimeout(this.debounceTimer);
			}
			this.debounceTimer = setTimeout(() => {
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
				text: 'No files indexed yet',
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
				text: 'No files match your search',
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
			timeEl.setText(this.formatDate(file.lastIndexed));
		}

		// Show "load more" button if there are more files
		if (!this.showAllFiles && totalFiles > this.MAX_FILES_INITIAL) {
			const moreButton = container.createDiv({ cls: 'rag-status-show-more' });
			moreButton.setText(`Show all ${totalFiles.toLocaleString()} files`);
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
				text: 'No failures recorded',
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
			timeEl.setText(this.formatDate(failure.timestamp));

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
			this.createTab(tabsEl, 'overview', 'Overview');

			// Files tab with count
			this.createTab(tabsEl, 'files', `Files (${this.statusInfo.indexedCount.toLocaleString()})`);

			// Failures tab with count
			if (this.statusInfo.failedCount > 0) {
				this.createTab(tabsEl, 'failures', `Failures (${this.statusInfo.failedCount})`);
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
				return 'Ready';
			case 'indexing':
				return 'Indexing...';
			case 'error':
				return 'Error';
			case 'paused':
				return 'Paused';
			case 'disabled':
				return 'Disabled';
			case 'rate_limited':
				return 'Rate Limited';
			default:
				return 'Unknown';
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

	private formatDate(timestamp: number): string {
		const date = new Date(timestamp);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMs / 3600000);
		const diffDays = Math.floor(diffMs / 86400000);

		if (diffMins < 1) {
			return 'Just now';
		} else if (diffMins < 60) {
			return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
		} else if (diffHours < 24) {
			return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
		} else if (diffDays < 7) {
			return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
		} else {
			return date.toLocaleDateString();
		}
	}
}
