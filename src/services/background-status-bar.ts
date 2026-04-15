import { setIcon, setTooltip } from 'obsidian';
import type ObsidianGemini from '../main';
import type { BackgroundTaskManager } from './background-task-manager';
import type { RagStatusProvider } from './rag-status-bar';

/**
 * A single coordinated status bar item that reflects both RAG indexing state
 * and background task state. This is the canonical "things are happening in
 * the background" surface — there should only ever be one icon, not two.
 *
 * Priority: if background tasks are running they take the icon; RAG state is
 * included in the tooltip. When no tasks are running, RAG state drives the icon.
 */
export class BackgroundStatusBar {
	private plugin: ObsidianGemini;
	private taskManager: BackgroundTaskManager;
	private ragProvider: RagStatusProvider | null = null;
	private statusBarItem: HTMLElement | null = null;

	constructor(plugin: ObsidianGemini, taskManager: BackgroundTaskManager) {
		this.plugin = plugin;
		this.taskManager = taskManager;
	}

	/** Called after RAG is initialized so it can contribute to the shared indicator.
	 *  Pass null to unregister (e.g. when RagIndexingService is torn down). */
	setRagProvider(provider: RagStatusProvider | null): void {
		this.ragProvider = provider;
		this.update();
	}

	/** Attach the status bar item to the Obsidian status bar. */
	setup(): void {
		if (this.statusBarItem) return;

		this.statusBarItem = this.plugin.addStatusBarItem();
		this.statusBarItem.addClass('gemini-bg-status-bar');

		this.statusBarItem.createSpan({ cls: 'gemini-bg-status-icon' });
		this.statusBarItem.createSpan({ cls: 'gemini-bg-status-text' });

		this.statusBarItem.addEventListener('click', async () => {
			const { BackgroundTasksModal } = await import('../ui/background-tasks-modal');
			new BackgroundTasksModal(this.plugin.app, this.plugin).open();
		});

		this.update();
	}

	/** Re-render the status bar item to reflect current state. */
	update(): void {
		if (!this.statusBarItem) return;

		const iconEl = this.statusBarItem.querySelector('.gemini-bg-status-icon') as HTMLElement | null;
		const textEl = this.statusBarItem.querySelector('.gemini-bg-status-text') as HTMLElement | null;
		if (!iconEl || !textEl) return;

		const runningCount = this.taskManager.runningCount;
		const ragStatus = this.ragProvider?.getStatus() ?? 'disabled';

		// Nothing to show — hide entirely
		if (runningCount === 0 && (ragStatus === 'disabled' || ragStatus === 'idle')) {
			this.statusBarItem.style.display = 'none';
			return;
		}

		this.statusBarItem.style.display = '';
		this.statusBarItem.removeClass('gemini-bg-active');

		const tooltipParts: string[] = [];

		if (runningCount > 0) {
			// Background tasks take visual priority
			this.statusBarItem.addClass('gemini-bg-active');
			setIcon(iconEl, 'loader');
			textEl.setText(runningCount > 1 ? `${runningCount} tasks` : '1 task');
			tooltipParts.push(`${runningCount} background task${runningCount > 1 ? 's' : ''} running — click to view`);
		} else {
			// No tasks running — let RAG drive the icon
			const ragIcon = ragStatus === 'indexing' ? 'upload-cloud' : ragStatus === 'paused' ? 'pause-circle' : 'database';
			setIcon(iconEl, ragIcon);
			textEl.setText(
				ragStatus === 'indexing'
					? (() => {
							const p = this.ragProvider!.getIndexingProgress();
							if (p.total > 0) {
								return `${Math.round((p.current / p.total) * 100)}%`;
							}
							return '…';
						})()
					: String(this.ragProvider?.getIndexedFileCount() ?? '')
			);
		}

		// Append RAG state to tooltip
		if (ragStatus === 'indexing') {
			const p = this.ragProvider!.getIndexingProgress();
			const pctLabel = p.total > 0 ? ` (${p.current}/${p.total})` : '';
			tooltipParts.push(`RAG: indexing${pctLabel}`);
		} else if (ragStatus === 'paused') {
			tooltipParts.push(`RAG: paused (${this.ragProvider!.getIndexedFileCount()} files indexed)`);
		} else if (ragStatus === 'error') {
			tooltipParts.push('RAG: error — check settings');
		} else if (ragStatus === 'rate_limited') {
			const secs = this.ragProvider!.getRateLimitRemainingSeconds();
			tooltipParts.push(`RAG: rate limited (${secs}s)`);
		} else if (ragStatus === 'idle' && runningCount === 0) {
			tooltipParts.push(`RAG: ${this.ragProvider!.getIndexedFileCount()} files indexed`);
		}

		setTooltip(this.statusBarItem, tooltipParts.join(' · '), { placement: 'top' });
	}

	destroy(): void {
		if (this.statusBarItem) {
			this.statusBarItem.remove();
			this.statusBarItem = null;
		}
		this.ragProvider = null;
	}
}
