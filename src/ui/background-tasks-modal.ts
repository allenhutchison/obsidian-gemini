import { App, Modal, Notice, Setting, setIcon } from 'obsidian';
import type ObsidianGemini from '../main';
import type { BackgroundTask } from '../services/background-task-manager';
import type { RagDetailedStatus } from './rag-status-modal';
import type { ProgressListener } from '../services/rag-types';
import type { RagIndexingService } from '../services/rag-indexing';
import { getErrorMessage } from '../utils/error-utils';

type ModalTab = 'tasks' | 'rag';
type RagInnerTab = 'overview' | 'files' | 'failures';

/**
 * Unified "Gemini Activity" modal with two top-level tabs:
 *   - Background Tasks — running + recent tasks (live-updates via AgentEventBus)
 *   - RAG             — indexing status, progress, and controls (live-updates via ProgressListener)
 *
 * Default tab: Background Tasks when any task is running, otherwise RAG (if enabled).
 * When RAG is disabled and no tasks are running the status bar is hidden, so this
 * modal is never opened in that state.
 *
 * Command-palette entry for the standalone RagStatusModal is unchanged.
 */
export class BackgroundTasksModal extends Modal {
	private plugin: ObsidianGemini;
	private activeTab: ModalTab;

	// Background Tasks tab state
	private taskUnsubscribers: Array<() => void> = [];

	// RAG tab state
	private ragProgressListener: ProgressListener | null = null;
	private ragInnerTab: RagInnerTab = 'overview';
	private ragSearchQuery = '';
	private ragShowAllFiles = false;
	private ragDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	private ragFileScrollTop = 0;
	private readonly RAG_MAX_FILES_INITIAL = 200;

	constructor(app: App, plugin: ObsidianGemini, defaultTab?: ModalTab) {
		super(app);
		this.plugin = plugin;

		if (defaultTab) {
			this.activeTab = defaultTab;
		} else {
			const hasRunningTasks = (plugin.backgroundTaskManager?.runningCount ?? 0) > 0;
			const ragEnabled = plugin.ragIndexing !== null;
			this.activeTab = hasRunningTasks || !ragEnabled ? 'tasks' : 'rag';
		}
	}

	onOpen(): void {
		this.renderShell();

		// --- Background Tasks live-updates ---
		const bus = this.plugin.agentEventBus;
		if (bus) {
			const refreshTasks = async () => {
				if (this.activeTab === 'tasks') this.renderTabContent();
			};
			this.taskUnsubscribers.push(
				bus.on('backgroundTaskStarted', refreshTasks),
				bus.on('backgroundTaskComplete', refreshTasks),
				bus.on('backgroundTaskFailed', refreshTasks)
			);
		}

		// --- RAG live-updates ---
		if (this.plugin.ragIndexing) {
			this.ragProgressListener = () => {
				if (this.activeTab !== 'rag') return;
				// Don't wipe the Files tab while the search box has focus — the
				// debounce timer may still hold a reference to the old list container.
				const active = document.activeElement;
				if (this.ragInnerTab === 'files' && active instanceof HTMLElement && active.hasClass('rag-status-search'))
					return;
				this.renderTabContent();
			};
			this.plugin.ragIndexing.addProgressListener(this.ragProgressListener);
		}
	}

	onClose(): void {
		this.taskUnsubscribers.forEach((unsub) => unsub());
		this.taskUnsubscribers = [];

		if (this.ragProgressListener && this.plugin.ragIndexing) {
			this.plugin.ragIndexing.removeProgressListener(this.ragProgressListener);
			this.ragProgressListener = null;
		}

		if (this.ragDebounceTimer) {
			clearTimeout(this.ragDebounceTimer);
			this.ragDebounceTimer = null;
		}

		this.contentEl.empty();
	}

	// ---------------------------------------------------------------------------
	// Shell (tab bar + content slot)
	// ---------------------------------------------------------------------------

	private renderShell(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('gemini-activity-modal');

		// Outer tab bar
		const tabBar = contentEl.createDiv({ cls: 'gemini-activity-tab-bar' });
		this.renderTabBar(tabBar);

		// Content slot — re-populated by renderTabContent()
		contentEl.createDiv({ cls: 'gemini-activity-content' });
		this.renderTabContent();
	}

	private renderTabBar(tabBar: HTMLElement): void {
		tabBar.empty();

		const tabs: Array<{ id: ModalTab; label: string; icon: string }> = [
			{ id: 'tasks', label: 'Background Tasks', icon: 'loader' },
			{ id: 'rag', label: 'RAG', icon: 'database' },
		];

		for (const { id, label, icon } of tabs) {
			const tab = tabBar.createDiv({
				cls: `gemini-activity-tab${this.activeTab === id ? ' gemini-activity-tab--active' : ''}`,
				attr: { role: 'tab', tabindex: '0', 'aria-selected': String(this.activeTab === id) },
			});
			const iconEl = tab.createSpan({ cls: 'gemini-activity-tab-icon' });
			setIcon(iconEl, icon);
			tab.createSpan({ cls: 'gemini-activity-tab-label', text: label });

			const activate = () => {
				if (this.activeTab === id) return;
				this.activeTab = id;
				// Reset RAG inner state when switching to the RAG tab
				if (id === 'rag') {
					this.ragInnerTab = 'overview';
					this.ragSearchQuery = '';
					this.ragShowAllFiles = false;
				}
				// Update tab bar active styles without full shell re-render
				tabBar.querySelectorAll('.gemini-activity-tab').forEach((el) => {
					el.removeClass('gemini-activity-tab--active');
					el.setAttribute('aria-selected', 'false');
				});
				tab.addClass('gemini-activity-tab--active');
				tab.setAttribute('aria-selected', 'true');
				this.renderTabContent();
			};

			tab.addEventListener('click', activate);
			tab.addEventListener('keydown', (e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					activate();
				}
			});
		}
	}

	private renderTabContent(): void {
		const slot = this.contentEl.querySelector<HTMLElement>('.gemini-activity-content');
		if (!slot) return;
		slot.empty();

		if (this.activeTab === 'tasks') {
			this.renderTasksTab(slot);
		} else {
			this.renderRagTab(slot);
		}
	}

	// ---------------------------------------------------------------------------
	// Background Tasks tab
	// ---------------------------------------------------------------------------

	private renderTasksTab(container: HTMLElement): void {
		const manager = this.plugin.backgroundTaskManager;
		if (!manager) {
			container.createEl('p', { text: 'Background task manager not available.' });
			return;
		}

		const active = manager.getActiveTasks();
		const recent = manager.getRecentTasks();

		if (active.length === 0 && recent.length === 0) {
			container.createEl('p', {
				text: 'No background tasks yet. Long-running operations like deep research and image generation will appear here.',
				cls: 'gemini-bg-tasks-empty',
			});
			return;
		}

		if (active.length > 0) {
			const label = active.length > 10 ? `Running (${active.length})` : 'Running';
			container.createEl('h3', { text: label });
			const scrollWrap = container.createDiv({ cls: 'gemini-bg-tasks-scroll' });
			const list = scrollWrap.createEl('ul', { cls: 'gemini-bg-tasks-list' });
			for (const task of active.slice(0, 10)) {
				this.renderTaskItem(list, task, true);
			}
			if (active.length > 10) {
				scrollWrap.createEl('p', {
					text: `+ ${active.length - 10} more running tasks`,
					cls: 'gemini-bg-tasks-overflow',
				});
			}
		}

		if (recent.length > 0) {
			const recentHeader = container.createDiv({ cls: 'gemini-bg-tasks-recent-header' });
			recentHeader.createEl('h3', { text: 'Recent' });
			const clearBtn = recentHeader.createEl('button', { text: 'Clear', cls: 'gemini-bg-tasks-clear' });
			clearBtn.addEventListener('click', () => {
				this.plugin.backgroundTaskManager?.clearFinished();
				this.renderTabContent();
			});

			const scrollWrap = container.createDiv({ cls: 'gemini-bg-tasks-scroll' });
			const list = scrollWrap.createEl('ul', { cls: 'gemini-bg-tasks-list' });
			for (const task of recent) {
				this.renderTaskItem(list, task, false);
			}
		}
	}

	private renderTaskItem(container: HTMLElement, task: BackgroundTask, canCancel: boolean): void {
		const li = container.createEl('li', { cls: `gemini-bg-task gemini-bg-task--${task.status}` });

		const iconEl = li.createSpan({ cls: 'gemini-bg-task-icon' });
		switch (task.status) {
			case 'pending':
			case 'running':
				setIcon(iconEl, 'loader');
				break;
			case 'complete':
				setIcon(iconEl, 'check-circle');
				break;
			case 'failed':
				setIcon(iconEl, 'alert-circle');
				break;
			case 'cancelled':
				setIcon(iconEl, 'x-circle');
				break;
		}

		const info = li.createDiv({ cls: 'gemini-bg-task-info' });
		info.createDiv({ text: task.label, cls: 'gemini-bg-task-label' });
		info.createDiv({ text: this.formatTaskMeta(task), cls: 'gemini-bg-task-meta' });

		if (task.outputPath && task.status === 'complete') {
			const link = info.createEl('a', { text: 'Open result', href: '#', cls: 'gemini-bg-task-link' });
			link.addEventListener('click', (e) => {
				e.preventDefault();
				this.plugin.app.workspace.openLinkText(task.outputPath!, '', false);
				this.close();
			});
		}

		if (task.error && task.status === 'failed') {
			const short = this.truncateError(task.error);
			info.createSpan({ text: short, cls: 'gemini-bg-task-error', title: task.error } as any);
		}

		if (canCancel) {
			const btn = li.createEl('button', { text: 'Cancel', cls: 'gemini-bg-task-cancel mod-warning' });
			btn.addEventListener('click', () => {
				this.plugin.backgroundTaskManager?.cancel(task.id);
				this.renderTabContent();
			});
		}
	}

	private formatTaskMeta(task: BackgroundTask): string {
		const started = task.startedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
		if (task.completedAt) {
			const durationMs = task.completedAt.getTime() - task.startedAt.getTime();
			const durationLabel =
				durationMs < 60_000 ? `${Math.round(durationMs / 1000)}s` : `${Math.round(durationMs / 60_000)}m`;
			return `Started ${started} · ${durationLabel}`;
		}
		return `Started ${started}`;
	}

	/** Return the first meaningful line of an error, capped at 120 chars. */
	private truncateError(raw: string): string {
		const jsonMatch = raw.match(/"message"\s*:\s*"([^"]+)"/);
		if (jsonMatch) {
			const msg = jsonMatch[1].split(/[\n]/)[0].trim();
			return msg.length > 120 ? msg.slice(0, 117) + '…' : msg;
		}
		const stripped = raw.replace(/^(ApiError:\s*)?\[\d+ [^\]]+\]\s*/, '').replace(/^ApiError:\s*/, '');
		const firstLine = stripped.split(/[\n.]/)[0].trim();
		return firstLine.length > 120 ? firstLine.slice(0, 117) + '…' : firstLine;
	}
	// ---------------------------------------------------------------------------
	// RAG tab
	// ---------------------------------------------------------------------------

	private renderRagTab(container: HTMLElement): void {
		const rag = this.plugin.ragIndexing;
		if (!rag) {
			container.createEl('p', {
				text: 'RAG indexing is not enabled. Enable it in Settings → Gemini Scribe.',
				cls: 'gemini-bg-tasks-empty',
			});
			return;
		}

		const status: RagDetailedStatus = rag.getDetailedStatus();

		// Inner tab bar (Overview / Files / Failures)
		const innerTabBar = container.createDiv({ cls: 'rag-status-tabs' });
		this.renderRagInnerTabBar(innerTabBar, status);

		// Inner tab content
		const innerContent = container.createDiv({ cls: 'rag-status-content' });
		this.renderRagInnerContent(innerContent, status, rag);
	}

	private renderRagInnerTabBar(tabBar: HTMLElement, status: RagDetailedStatus): void {
		tabBar.empty();

		const createTab = (id: RagInnerTab, label: string) => {
			const tab = tabBar.createDiv({
				cls: `rag-status-tab${this.ragInnerTab === id ? ' rag-status-tab-active' : ''}`,
				text: label,
				attr: { role: 'tab', tabindex: '0', 'aria-selected': String(this.ragInnerTab === id) },
			});
			const activate = () => {
				if (this.ragInnerTab === id) return;
				this.ragInnerTab = id;
				this.ragShowAllFiles = false;
				this.ragSearchQuery = '';
				this.ragFileScrollTop = 0;
				this.renderTabContent();
			};
			tab.addEventListener('click', activate);
			tab.addEventListener('keydown', (e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					activate();
				}
			});
		};

		createTab('overview', 'Overview');
		createTab('files', `Files (${status.indexedCount.toLocaleString()})`);
		if (status.failedCount > 0) {
			createTab('failures', `Failures (${status.failedCount})`);
		}
	}

	private renderRagInnerContent(container: HTMLElement, status: RagDetailedStatus, rag: RagIndexingService): void {
		switch (this.ragInnerTab) {
			case 'overview':
				this.renderRagOverview(container, status, rag);
				break;
			case 'files':
				this.renderRagFiles(container, status);
				break;
			case 'failures':
				this.renderRagFailures(container, status);
				break;
		}
	}

	private renderRagOverview(container: HTMLElement, status: RagDetailedStatus, rag: RagIndexingService): void {
		const infoEl = container.createDiv({ cls: 'rag-status-info' });

		// Status row
		const statusRow = infoEl.createDiv({ cls: 'rag-status-row' });
		statusRow.createSpan({ cls: 'rag-status-label', text: 'Status' });
		const statusValue = statusRow.createSpan({ cls: `rag-status-value ${this.ragStatusClass(status.status)}` });
		statusValue.setText(this.ragStatusText(status.status));

		// Files indexed
		const filesRow = infoEl.createDiv({ cls: 'rag-status-row' });
		filesRow.createSpan({ cls: 'rag-status-label', text: 'Files indexed' });
		filesRow.createSpan({ cls: 'rag-status-value', text: status.indexedCount.toLocaleString() });

		// Pending changes
		const pendingRow = infoEl.createDiv({ cls: 'rag-status-row' });
		pendingRow.createSpan({ cls: 'rag-status-label', text: 'Pending' });
		pendingRow.createSpan({
			cls: 'rag-status-value',
			text: `${status.pendingCount} change${status.pendingCount !== 1 ? 's' : ''}`,
		});

		// Failures (if any)
		if (status.failedCount > 0) {
			const failedRow = infoEl.createDiv({ cls: 'rag-status-row' });
			failedRow.createSpan({ cls: 'rag-status-label', text: 'Failed' });
			failedRow.createSpan({
				cls: 'rag-status-value rag-status-error',
				text: `${status.failedCount} file${status.failedCount !== 1 ? 's' : ''}`,
			});
		}

		// Last sync
		if (status.lastSync) {
			const syncRow = infoEl.createDiv({ cls: 'rag-status-row' });
			syncRow.createSpan({ cls: 'rag-status-label', text: 'Last sync' });
			syncRow.createSpan({ cls: 'rag-status-value', text: this.formatRagDate(status.lastSync) });
		}

		// Store name
		if (status.storeName) {
			const storeRow = infoEl.createDiv({ cls: 'rag-status-row' });
			storeRow.createSpan({ cls: 'rag-status-label', text: 'Store' });
			storeRow.createSpan({ cls: 'rag-status-value rag-status-store', text: status.storeName });
		}

		// Action buttons
		const isIndexing = status.status === 'indexing';
		const hasPending = status.pendingCount > 0;

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
							await rag.syncPendingChanges();
							btn.setButtonText('Sync Now');
							this.renderTabContent();
						} catch (error) {
							new Notice(`Sync failed: ${getErrorMessage(error)}`);
							btn.setButtonText('Sync Now');
							btn.setDisabled(false);
						}
					})
			)
			.addButton((btn) =>
				btn
					.setButtonText('Reindex All')
					.setDisabled(isIndexing)
					.onClick(async () => {
						this.close();
						const { RagProgressModal } = await import('./rag-progress-modal');
						const progressModal = new RagProgressModal(this.plugin.app, rag, (result) => {
							new Notice(`RAG Indexing complete: ${result.indexed} indexed, ${result.skipped} unchanged`);
						});
						progressModal.open();
						rag.indexVault().catch((error: unknown) => {
							new Notice(`RAG Indexing failed: ${getErrorMessage(error)}`);
						});
					})
			)
			.addButton((btn) =>
				btn
					.setButtonText('Settings')
					.setCta()
					.onClick(() => {
						this.close();
						// @ts-expect-error — Obsidian internal API
						this.plugin.app.setting.open();
						// @ts-expect-error — Obsidian internal API
						this.plugin.app.setting.openTabById('gemini-scribe');
					})
			);
	}

	private renderRagFiles(container: HTMLElement, status: RagDetailedStatus): void {
		const searchContainer = container.createDiv({ cls: 'rag-status-search-container' });
		const searchInput = searchContainer.createEl('input', {
			cls: 'rag-status-search',
			attr: { type: 'text', placeholder: 'Search files...', value: this.ragSearchQuery },
		});

		const listContainer = container.createDiv({ cls: 'rag-status-file-list' });
		this.renderRagFileList(listContainer, status);

		// Restore scroll position (lost on progress-tick re-render)
		listContainer.scrollTop = this.ragFileScrollTop;
		listContainer.addEventListener('scroll', () => {
			this.ragFileScrollTop = listContainer.scrollTop;
		});

		searchInput.addEventListener('input', (e) => {
			if (this.ragDebounceTimer) clearTimeout(this.ragDebounceTimer);
			this.ragDebounceTimer = setTimeout(() => {
				this.ragSearchQuery = (e.target as HTMLInputElement).value;
				this.ragFileScrollTop = 0;
				this.renderRagFileList(listContainer, status);
			}, 150);
		});
	}

	private renderRagFileList(container: HTMLElement, status: RagDetailedStatus): void {
		container.empty();

		if (status.indexedFiles.length === 0) {
			container.createDiv({ cls: 'rag-status-empty', text: 'No files indexed yet' });
			return;
		}

		let filtered = status.indexedFiles;
		if (this.ragSearchQuery) {
			const q = this.ragSearchQuery.toLowerCase();
			filtered = filtered.filter((f) => f.path.toLowerCase().includes(q));
		}

		if (filtered.length === 0) {
			container.createDiv({ cls: 'rag-status-empty', text: 'No files match your search' });
			return;
		}

		const total = filtered.length;
		const display = this.ragShowAllFiles ? filtered : filtered.slice(0, this.RAG_MAX_FILES_INITIAL);

		for (const file of display) {
			const item = container.createEl('button', {
				cls: 'rag-status-file-item rag-status-file-item--clickable',
				attr: { 'aria-label': `Open ${file.path}` },
			});
			const pathEl = item.createSpan({ cls: 'rag-status-file-path' });
			pathEl.setText(file.path);
			pathEl.setAttribute('title', file.path);
			item.createSpan({ cls: 'rag-status-file-time', text: this.formatRagDate(file.lastIndexed) });
			item.addEventListener('click', () => {
				this.close();
				this.plugin.app.workspace.openLinkText(file.path, '', false);
			});
		}

		if (!this.ragShowAllFiles && total > this.RAG_MAX_FILES_INITIAL) {
			const more = container.createDiv({ cls: 'rag-status-show-more' });
			more.setText(`Show all ${total.toLocaleString()} files`);
			more.addEventListener('click', () => {
				this.ragShowAllFiles = true;
				this.renderRagFileList(container, status);
			});
		}
	}

	private renderRagFailures(container: HTMLElement, status: RagDetailedStatus): void {
		if (status.failedFiles.length === 0) {
			container.createDiv({ cls: 'rag-status-empty', text: 'No failures recorded' });
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
			headerRow.createSpan({ cls: 'rag-status-failure-time', text: this.formatRagDate(failure.timestamp) });
			item.createDiv({ cls: 'rag-status-failure-error', text: failure.error });
		}
	}

	// ---------------------------------------------------------------------------
	// RAG display helpers
	// ---------------------------------------------------------------------------

	private ragStatusText(status: string): string {
		const map: Record<string, string> = {
			idle: 'Ready',
			indexing: 'Indexing...',
			error: 'Error',
			paused: 'Paused',
			disabled: 'Disabled',
			rate_limited: 'Rate Limited',
		};
		return map[status] ?? 'Unknown';
	}

	private ragStatusClass(status: string): string {
		const map: Record<string, string> = {
			idle: 'rag-status-ready',
			indexing: 'rag-status-indexing',
			error: 'rag-status-error',
			paused: 'rag-status-paused',
			rate_limited: 'rag-status-rate-limited',
		};
		return map[status] ?? '';
	}

	private formatRagDate(timestamp: number): string {
		const date = new Date(timestamp);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMs / 3600000);
		const diffDays = Math.floor(diffMs / 86400000);

		if (diffMins < 1) return 'Just now';
		if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
		if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
		if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
		return date.toLocaleDateString();
	}
}
