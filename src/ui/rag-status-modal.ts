import { App, Modal, Setting, setIcon } from 'obsidian';
import type { RagIndexStatus } from '../services/rag-indexing';

export interface RagStatusInfo {
	status: RagIndexStatus;
	indexedCount: number;
	storeName: string | null;
	lastSync: number | null;
	progress?: { current: number; total: number };
}

/**
 * Modal showing RAG indexing status and providing access to settings
 */
export class RagStatusModal extends Modal {
	private statusInfo: RagStatusInfo;
	private onOpenSettings: () => void;
	private onReindex: () => void;

	constructor(
		app: App,
		statusInfo: RagStatusInfo,
		onOpenSettings: () => void,
		onReindex: () => void
	) {
		super(app);
		this.statusInfo = statusInfo;
		this.onOpenSettings = onOpenSettings;
		this.onReindex = onReindex;
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

		// Status info
		const infoEl = contentEl.createDiv({ cls: 'rag-status-info' });

		// Status row
		const statusRow = infoEl.createDiv({ cls: 'rag-status-row' });
		statusRow.createSpan({ cls: 'rag-status-label', text: 'Status' });
		const statusValue = statusRow.createSpan({ cls: 'rag-status-value' });
		statusValue.setText(this.getStatusText());
		statusValue.addClass(this.getStatusClass());

		// Files indexed row
		const filesRow = infoEl.createDiv({ cls: 'rag-status-row' });
		filesRow.createSpan({ cls: 'rag-status-label', text: 'Files indexed' });
		filesRow.createSpan({ cls: 'rag-status-value', text: `${this.statusInfo.indexedCount}` });

		// Progress row (only during indexing)
		if (this.statusInfo.status === 'indexing' && this.statusInfo.progress) {
			const progressRow = infoEl.createDiv({ cls: 'rag-status-row' });
			progressRow.createSpan({ cls: 'rag-status-label', text: 'Progress' });
			const pct = Math.round((this.statusInfo.progress.current / this.statusInfo.progress.total) * 100);
			progressRow.createSpan({
				cls: 'rag-status-value',
				text: `${this.statusInfo.progress.current}/${this.statusInfo.progress.total} (${pct}%)`
			});
		}

		// Last sync row
		if (this.statusInfo.lastSync) {
			const syncRow = infoEl.createDiv({ cls: 'rag-status-row' });
			syncRow.createSpan({ cls: 'rag-status-label', text: 'Last sync' });
			syncRow.createSpan({
				cls: 'rag-status-value',
				text: this.formatDate(this.statusInfo.lastSync)
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
		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText('Reindex Vault')
					.setDisabled(this.statusInfo.status === 'indexing')
					.onClick(() => {
						this.close();
						this.onReindex();
					})
			)
			.addButton((btn) =>
				btn
					.setButtonText('Open Settings')
					.setCta()
					.onClick(() => {
						this.close();
						this.onOpenSettings();
					})
			);
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
