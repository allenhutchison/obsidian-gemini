import { App, Modal, Setting, setIcon } from 'obsidian';
import type { RagProgressInfo, ProgressListener } from '../services/rag-indexing';

/**
 * Modal showing live progress during RAG indexing operations
 */
export class RagProgressModal extends Modal {
	private ragService: {
		addProgressListener: (listener: ProgressListener) => void;
		removeProgressListener: (listener: ProgressListener) => void;
		getProgressInfo: () => RagProgressInfo;
		cancelIndexing: () => void;
	};
	private onComplete?: (result: { indexed: number; skipped: number; failed: number }) => void;
	private progressListener: ProgressListener;
	private progressInfo: RagProgressInfo;

	// UI elements for live updates
	private progressBarFill: HTMLElement | null = null;
	private progressText: HTMLElement | null = null;
	private currentFileEl: HTMLElement | null = null;
	private elapsedTimeEl: HTMLElement | null = null;
	private estimatedTimeEl: HTMLElement | null = null;
	private indexedCountEl: HTMLElement | null = null;
	private skippedCountEl: HTMLElement | null = null;
	private failedCountEl: HTMLElement | null = null;
	private cancelBtn: HTMLButtonElement | null = null;
	private backgroundBtn: HTMLButtonElement | null = null;
	private timerInterval: ReturnType<typeof setInterval> | null = null;

	constructor(
		app: App,
		ragService: {
			addProgressListener: (listener: ProgressListener) => void;
			removeProgressListener: (listener: ProgressListener) => void;
			getProgressInfo: () => RagProgressInfo;
			cancelIndexing: () => void;
		},
		onComplete?: (result: { indexed: number; skipped: number; failed: number }) => void
	) {
		super(app);
		this.ragService = ragService;
		this.onComplete = onComplete;
		this.progressInfo = ragService.getProgressInfo();

		// Create listener for progress updates
		this.progressListener = (progress: RagProgressInfo) => {
			this.progressInfo = progress;
			this.updateUI();

			// Check if complete
			if (progress.status !== 'indexing') {
				this.handleComplete();
			}
		};
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('rag-progress-modal');

		// Subscribe to progress updates
		this.ragService.addProgressListener(this.progressListener);

		// Header with icon
		const headerEl = contentEl.createDiv({ cls: 'rag-progress-header' });
		const iconEl = headerEl.createSpan({ cls: 'rag-progress-header-icon' });
		setIcon(iconEl, 'upload-cloud');
		headerEl.createEl('h2', { text: 'Indexing Vault' });

		// Progress bar container
		const progressContainer = contentEl.createDiv({ cls: 'rag-progress-bar-container' });
		const progressBar = progressContainer.createDiv({ cls: 'rag-progress-bar' });
		this.progressBarFill = progressBar.createDiv({ cls: 'rag-progress-bar-fill' });
		this.progressText = progressContainer.createDiv({ cls: 'rag-progress-text' });

		// Current file section
		const currentFileSection = contentEl.createDiv({ cls: 'rag-progress-section' });
		currentFileSection.createDiv({ cls: 'rag-progress-label', text: 'Currently processing:' });
		this.currentFileEl = currentFileSection.createDiv({ cls: 'rag-progress-current-file' });

		// Time section
		const timeSection = contentEl.createDiv({ cls: 'rag-progress-time-section' });
		const elapsedContainer = timeSection.createSpan({ cls: 'rag-progress-time-item' });
		elapsedContainer.createSpan({ text: 'Elapsed: ' });
		this.elapsedTimeEl = elapsedContainer.createSpan({ cls: 'rag-progress-time-value' });

		timeSection.createSpan({ cls: 'rag-progress-time-separator', text: ' | ' });

		const estimatedContainer = timeSection.createSpan({ cls: 'rag-progress-time-item' });
		estimatedContainer.createSpan({ text: 'Estimated: ' });
		this.estimatedTimeEl = estimatedContainer.createSpan({ cls: 'rag-progress-time-value' });

		// Stats section
		const statsSection = contentEl.createDiv({ cls: 'rag-progress-stats' });

		const indexedRow = statsSection.createDiv({ cls: 'rag-progress-stat-row' });
		const indexedIcon = indexedRow.createSpan({ cls: 'rag-progress-stat-icon rag-stat-success' });
		setIcon(indexedIcon, 'check');
		this.indexedCountEl = indexedRow.createSpan({ cls: 'rag-progress-stat-value' });

		const skippedRow = statsSection.createDiv({ cls: 'rag-progress-stat-row' });
		const skippedIcon = skippedRow.createSpan({ cls: 'rag-progress-stat-icon rag-stat-warning' });
		setIcon(skippedIcon, 'minus');
		this.skippedCountEl = skippedRow.createSpan({ cls: 'rag-progress-stat-value' });

		const failedRow = statsSection.createDiv({ cls: 'rag-progress-stat-row' });
		const failedIcon = failedRow.createSpan({ cls: 'rag-progress-stat-icon rag-stat-error' });
		setIcon(failedIcon, 'x');
		this.failedCountEl = failedRow.createSpan({ cls: 'rag-progress-stat-value' });

		// Action buttons
		const buttonSetting = new Setting(contentEl);
		buttonSetting.addButton((btn) => {
			this.backgroundBtn = btn.buttonEl;
			btn.setButtonText('Run in Background').onClick(() => {
				this.close();
			});
		});
		buttonSetting.addButton((btn) => {
			this.cancelBtn = btn.buttonEl;
			btn
				.setButtonText('Cancel')
				.setWarning()
				.onClick(() => {
					this.ragService.cancelIndexing();
					btn.setDisabled(true);
					btn.setButtonText('Cancelling...');
				});
		});

		// Start timer for elapsed time updates
		this.timerInterval = setInterval(() => {
			this.updateTimeDisplay();
		}, 1000);

		// Initial UI update
		this.updateUI();
	}

	onClose() {
		// Unsubscribe from progress updates
		this.ragService.removeProgressListener(this.progressListener);

		// Clear timer
		if (this.timerInterval) {
			clearInterval(this.timerInterval);
			this.timerInterval = null;
		}
	}

	private updateUI(): void {
		const { progressInfo } = this;
		const total = progressInfo.totalCount || 1;
		const current = progressInfo.indexedCount + progressInfo.skippedCount + progressInfo.failedCount;
		const percentage = Math.round((current / total) * 100);

		// Update progress bar
		if (this.progressBarFill) {
			this.progressBarFill.style.width = `${percentage}%`;
		}
		if (this.progressText) {
			this.progressText.setText(`${percentage}% (${current} / ${total})`);
		}

		// Update current file
		if (this.currentFileEl) {
			if (progressInfo.currentFile) {
				this.currentFileEl.setText(progressInfo.currentFile);
				this.currentFileEl.style.display = '';
			} else if (progressInfo.status === 'indexing') {
				this.currentFileEl.setText('Scanning vault...');
				this.currentFileEl.style.display = '';
			} else {
				this.currentFileEl.style.display = 'none';
			}
		}

		// Update stats
		if (this.indexedCountEl) {
			this.indexedCountEl.setText(`${progressInfo.indexedCount} files indexed`);
		}
		if (this.skippedCountEl) {
			this.skippedCountEl.setText(`${progressInfo.skippedCount} files skipped (unchanged)`);
		}
		if (this.failedCountEl) {
			if (progressInfo.failedCount > 0) {
				this.failedCountEl.setText(`${progressInfo.failedCount} files failed`);
				this.failedCountEl.parentElement?.classList.remove('rag-stat-hidden');
			} else {
				this.failedCountEl.parentElement?.classList.add('rag-stat-hidden');
			}
		}

		// Update time display
		this.updateTimeDisplay();
	}

	private updateTimeDisplay(): void {
		const { progressInfo } = this;

		// Elapsed time
		if (this.elapsedTimeEl && progressInfo.startTime) {
			const elapsed = Date.now() - progressInfo.startTime;
			this.elapsedTimeEl.setText(this.formatDuration(elapsed));
		}

		// Estimated time remaining
		if (this.estimatedTimeEl && progressInfo.startTime && progressInfo.totalCount > 0) {
			const current = progressInfo.indexedCount + progressInfo.skippedCount + progressInfo.failedCount;
			if (current > 0) {
				const elapsed = Date.now() - progressInfo.startTime;
				const rate = current / elapsed;
				const remaining = (progressInfo.totalCount - current) / rate;
				this.estimatedTimeEl.setText(`${this.formatDuration(remaining)} remaining`);
			} else {
				this.estimatedTimeEl.setText('Calculating...');
			}
		}
	}

	private formatDuration(ms: number): string {
		const totalSeconds = Math.floor(ms / 1000);
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = totalSeconds % 60;

		if (hours > 0) {
			return `${hours}h ${minutes}m ${seconds}s`;
		} else if (minutes > 0) {
			return `${minutes}m ${seconds}s`;
		} else {
			return `${seconds}s`;
		}
	}

	private handleComplete(): void {
		// Clear timer
		if (this.timerInterval) {
			clearInterval(this.timerInterval);
			this.timerInterval = null;
		}

		// Update progress bar to 100%
		if (this.progressBarFill) {
			this.progressBarFill.style.width = '100%';
		}
		const total = this.progressInfo.indexedCount + this.progressInfo.skippedCount + this.progressInfo.failedCount;
		if (this.progressText) {
			this.progressText.setText(`100% (${total} / ${total})`);
		}

		// Update header
		const headerEl = this.contentEl.querySelector('.rag-progress-header h2');
		const iconEl = this.contentEl.querySelector('.rag-progress-header-icon');
		if (headerEl) {
			headerEl.setText(this.progressInfo.status === 'error' ? 'Indexing Failed' : 'Indexing Complete');
		}
		if (iconEl) {
			setIcon(iconEl as HTMLElement, this.progressInfo.status === 'error' ? 'alert-triangle' : 'check-circle');
		}

		// Hide current file section
		const currentFileSection = this.contentEl.querySelector('.rag-progress-section');
		if (currentFileSection) {
			(currentFileSection as HTMLElement).style.display = 'none';
		}

		// Update buttons
		if (this.cancelBtn) {
			this.cancelBtn.style.display = 'none';
		}
		if (this.backgroundBtn) {
			this.backgroundBtn.setText('Close');
		}

		// Callback
		this.onComplete?.({
			indexed: this.progressInfo.indexedCount,
			skipped: this.progressInfo.skippedCount,
			failed: this.progressInfo.failedCount,
		});
	}
}
