import { Notice, Setting, setIcon } from 'obsidian';
import type { RagDetailedStatus } from '../../services/rag-types';
import { formatRelativeTime } from '../../utils/format-relative-time';
import { t } from '../../i18n';

/**
 * Shared, presenter-style rendering for the RAG-status panel.
 *
 * Both {@link RagStatusModal} (the standalone command-palette modal) and the "RAG"
 * tab of `BackgroundTasksModal` render the same overview rows, Sync/Reindex button
 * gating, indexed-file list, failures list, and status→label / status→css maps.
 * Keeping two parallel copies meant every copy change or new status state had to be
 * mirrored by hand. These helpers are the single source of truth; each modal keeps
 * only its own tab shell, search-box wiring, and data acquisition and delegates the
 * content rendering here.
 *
 * The behavioral differences between the two surfaces are parameterized through the
 * options objects rather than branched inside the helpers:
 *   - the post-sync follow-up (close the modal vs re-render the tab),
 *   - the sync-failure error formatter,
 *   - whether indexed-file rows are clickable (open the file) or plain.
 */

/** Map a RAG status value to its localized display label. */
export function ragStatusText(status: string): string {
	const map: Record<string, string> = {
		idle: t('ragStatus.statusReady'),
		indexing: t('ragStatus.statusIndexing'),
		error: t('ragStatus.statusError'),
		paused: t('ragStatus.statusPaused'),
		disabled: t('ragStatus.statusDisabled'),
		rate_limited: t('ragStatus.statusRateLimited'),
	};
	return map[status] ?? t('ragStatus.statusUnknown');
}

/** Map a RAG status value to its CSS state class (empty string for states with no color). */
export function ragStatusClass(status: string): string {
	const map: Record<string, string> = {
		idle: 'rag-status-ready',
		indexing: 'rag-status-indexing',
		error: 'rag-status-error',
		paused: 'rag-status-paused',
		rate_limited: 'rag-status-rate-limited',
	};
	return map[status] ?? '';
}

/** Callbacks wiring the overview action buttons to a specific host modal. */
export interface RagOverviewCallbacks {
	/** Perform the "Sync now" action. The helper owns the button's disabled/label state. */
	onSyncNow: () => Promise<unknown>;
	/** Called after a successful sync — e.g. close the modal, or re-render the tab. */
	onSyncSuccess: () => void;
	/** Format the message shown in the sync-failure notice. */
	formatSyncError: (error: unknown) => string;
	/** Perform the "Reindex" action. Owns its own modal close + follow-up flow. */
	onReindex: () => void;
	/** Open plugin settings. Owns its own modal close. */
	onOpenSettings: () => void;
}

/**
 * Render the overview tab: status / files-indexed / pending / failures / last-sync /
 * store rows, then the Sync-Now / Reindex / Settings action buttons with their gating
 * (`isIndexing` disables Reindex and Sync; Sync also requires pending changes).
 */
export function renderRagOverview(container: HTMLElement, status: RagDetailedStatus, cb: RagOverviewCallbacks): void {
	const infoEl = container.createDiv({ cls: 'rag-status-info' });

	// Status row
	const statusRow = infoEl.createDiv({ cls: 'rag-status-row' });
	statusRow.createSpan({ cls: 'rag-status-label', text: t('ragStatus.statusLabel') });
	statusRow.createSpan({
		cls: `rag-status-value ${ragStatusClass(status.status)}`.trim(),
		text: ragStatusText(status.status),
	});

	// Files indexed row
	const filesRow = infoEl.createDiv({ cls: 'rag-status-row' });
	filesRow.createSpan({ cls: 'rag-status-label', text: t('ragStatus.filesIndexedLabel') });
	filesRow.createSpan({ cls: 'rag-status-value', text: status.indexedCount.toLocaleString() });

	// Pending changes row
	const pendingRow = infoEl.createDiv({ cls: 'rag-status-row' });
	pendingRow.createSpan({ cls: 'rag-status-label', text: t('ragStatus.pendingLabel') });
	pendingRow.createSpan({
		cls: 'rag-status-value',
		text:
			status.pendingCount === 1
				? t('ragStatus.changeSingular', { count: status.pendingCount })
				: t('ragStatus.changePlural', { count: status.pendingCount }),
	});

	// Failures row (if any)
	if (status.failedCount > 0) {
		const failedRow = infoEl.createDiv({ cls: 'rag-status-row' });
		failedRow.createSpan({ cls: 'rag-status-label', text: t('ragStatus.failedLabel') });
		failedRow.createSpan({
			cls: 'rag-status-value rag-status-error',
			text:
				status.failedCount === 1
					? t('ragStatus.fileSingular', { count: status.failedCount })
					: t('ragStatus.filePlural', { count: status.failedCount }),
		});
	}

	// Last sync row
	if (status.lastSync) {
		const syncRow = infoEl.createDiv({ cls: 'rag-status-row' });
		syncRow.createSpan({ cls: 'rag-status-label', text: t('ragStatus.lastSyncLabel') });
		syncRow.createSpan({ cls: 'rag-status-value', text: formatRelativeTime(status.lastSync) });
	}

	// Store name row
	if (status.storeName) {
		const storeRow = infoEl.createDiv({ cls: 'rag-status-row' });
		storeRow.createSpan({ cls: 'rag-status-label', text: t('ragStatus.storeLabel') });
		storeRow.createSpan({ cls: 'rag-status-value rag-status-store', text: status.storeName });
	}

	// Action buttons
	const isIndexing = status.status === 'indexing';
	const hasPending = status.pendingCount > 0;

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
						await cb.onSyncNow();
						btn.setButtonText(t('ragStatus.syncNowButton'));
						cb.onSyncSuccess();
					} catch (error) {
						new Notice(t('ragStatus.syncFailed', { message: cb.formatSyncError(error) }));
						btn.setButtonText(t('ragStatus.syncNowButton'));
						btn.setDisabled(false);
					}
				})
		)
		.addButton((btn) =>
			btn
				.setButtonText(t('ragStatus.reindexButton'))
				.setDisabled(isIndexing)
				.onClick(() => cb.onReindex())
		)
		.addButton((btn) =>
			btn
				.setButtonText(t('ragStatus.settingsButton'))
				.setCta()
				.onClick(() => cb.onOpenSettings())
		);
}

/** Options controlling the indexed-file list rendering. */
export interface RagFileListOptions {
	/** Current search filter applied to file paths (case-insensitive substring). */
	searchQuery: string;
	/** Whether the full list is shown (vs capped at `maxInitial`). */
	showAll: boolean;
	/** How many files to show before the "show all" affordance. */
	maxInitial: number;
	/** Reveal the full list — the host flips its own `showAll` state and re-renders. */
	onShowAll: () => void;
	/**
	 * When provided, each file row is a clickable button that invokes this with the
	 * file's path (used by the Background Tasks modal to open the note). When omitted,
	 * rows are plain, non-interactive divs (the standalone status modal).
	 */
	onOpenFile?: (path: string) => void;
}

/**
 * Render the indexed-file list into `container` (which is emptied first): empty and
 * no-search-match states, path/last-indexed rows, and the "show all N files" affordance.
 */
export function renderRagFileList(container: HTMLElement, status: RagDetailedStatus, opts: RagFileListOptions): void {
	container.empty();

	if (status.indexedFiles.length === 0) {
		container.createDiv({ cls: 'rag-status-empty', text: t('ragStatus.noFilesIndexed') });
		return;
	}

	let filtered = status.indexedFiles;
	if (opts.searchQuery) {
		const query = opts.searchQuery.toLowerCase();
		filtered = filtered.filter((f) => f.path.toLowerCase().includes(query));
	}

	if (filtered.length === 0) {
		container.createDiv({ cls: 'rag-status-empty', text: t('ragStatus.noSearchMatches') });
		return;
	}

	const total = filtered.length;
	const display = opts.showAll ? filtered : filtered.slice(0, opts.maxInitial);

	for (const file of display) {
		let item: HTMLElement;
		const onOpenFile = opts.onOpenFile;
		if (onOpenFile) {
			item = container.createEl('button', {
				cls: 'rag-status-file-item rag-status-file-item--clickable',
				attr: { type: 'button', 'aria-label': t('backgroundTasks.openFileAria', { path: file.path }) },
			});
			item.addEventListener('click', () => onOpenFile(file.path));
		} else {
			item = container.createDiv({ cls: 'rag-status-file-item' });
		}
		const pathEl = item.createSpan({ cls: 'rag-status-file-path' });
		pathEl.setText(file.path);
		pathEl.setAttribute('title', file.path);
		item.createSpan({ cls: 'rag-status-file-time', text: formatRelativeTime(file.lastIndexed) });
	}

	if (!opts.showAll && total > opts.maxInitial) {
		const more = container.createDiv({ cls: 'rag-status-show-more' });
		more.setText(t('ragStatus.showAllFiles', { count: total.toLocaleString() }));
		more.addEventListener('click', () => opts.onShowAll());
	}
}

/**
 * Render the failures tab: an empty-state message, or one row per failed file with its
 * path, timestamp, and error text.
 */
export function renderRagFailures(container: HTMLElement, status: RagDetailedStatus): void {
	if (status.failedFiles.length === 0) {
		container.createDiv({ cls: 'rag-status-empty', text: t('ragStatus.noFailures') });
		return;
	}

	const listContainer = container.createDiv({ cls: 'rag-status-failure-list' });
	for (const failure of status.failedFiles) {
		const item = listContainer.createDiv({ cls: 'rag-status-failure-item' });

		const headerRow = item.createDiv({ cls: 'rag-status-failure-header' });
		const iconEl = headerRow.createSpan({ cls: 'rag-status-failure-icon' });
		setIcon(iconEl, 'x-circle');

		const pathEl = headerRow.createSpan({ cls: 'rag-status-failure-path' });
		pathEl.setText(failure.path);
		pathEl.setAttribute('title', failure.path);

		headerRow.createSpan({ cls: 'rag-status-failure-time', text: formatRelativeTime(failure.timestamp) });

		item.createDiv({ cls: 'rag-status-failure-error', text: failure.error });
	}
}
