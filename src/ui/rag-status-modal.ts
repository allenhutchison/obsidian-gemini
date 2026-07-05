import { App, Modal, setIcon } from 'obsidian';
import type { RagDetailedStatus } from '../services/rag-types';
import { getRawErrorMessage } from '../utils/error-utils';
import { renderRagOverview, renderRagFileList, renderRagFailures } from './components/rag-status-panel';
import { t } from '../i18n';

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
		renderRagOverview(container, this.statusInfo, {
			onSyncNow: () => this.onSyncNow(),
			onSyncSuccess: () => this.close(),
			formatSyncError: (error) => getRawErrorMessage(error),
			onReindex: () => {
				this.close();
				void this.onReindex();
			},
			onOpenSettings: () => {
				this.close();
				this.onOpenSettings();
			},
		});
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

		// File list container
		const listContainer = container.createDiv({ cls: 'rag-status-file-list' });
		const renderList = () =>
			renderRagFileList(listContainer, this.statusInfo, {
				searchQuery: this.searchQuery,
				showAll: this.showAllFiles,
				maxInitial: this.MAX_FILES_INITIAL,
				onShowAll: () => {
					this.showAllFiles = true;
					renderList();
				},
			});
		renderList();

		searchInput.addEventListener('input', (e) => {
			if (this.debounceTimer) {
				window.clearTimeout(this.debounceTimer);
			}
			this.debounceTimer = window.setTimeout(() => {
				this.searchQuery = (e.target as HTMLInputElement).value;
				renderList();
			}, 150);
		});
	}

	private renderFailuresTab(container: HTMLElement): void {
		renderRagFailures(container, this.statusInfo);
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
}
