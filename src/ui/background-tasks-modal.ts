import { App, Modal, setIcon } from 'obsidian';
import type ObsidianGemini from '../main';
import type { BackgroundTask } from '../services/background-task-manager';

/**
 * Modal that lists all running and recently completed background tasks.
 * Opened by clicking the status bar indicator or via the command palette.
 * Subscribes to AgentEventBus so it live-updates while open.
 */
export class BackgroundTasksModal extends Modal {
	private plugin: ObsidianGemini;
	private unsubscribers: Array<() => void> = [];

	constructor(app: App, plugin: ObsidianGemini) {
		super(app);
		this.plugin = plugin;
	}

	onOpen(): void {
		this.render();

		// Subscribe to task lifecycle events so the modal stays current while open.
		const bus = this.plugin.agentEventBus;
		const refresh = async () => this.render();
		this.unsubscribers.push(
			bus.on('backgroundTaskStarted', refresh),
			bus.on('backgroundTaskComplete', refresh),
			bus.on('backgroundTaskFailed', refresh)
		);
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('gemini-bg-tasks-modal');

		contentEl.createEl('h2', { text: 'Background Tasks' });

		const manager = this.plugin.backgroundTaskManager;
		if (!manager) {
			contentEl.createEl('p', { text: 'Background task manager not available.' });
			return;
		}

		const active = manager.getActiveTasks();
		const recent = manager.getRecentTasks();

		if (active.length === 0 && recent.length === 0) {
			contentEl.createEl('p', {
				text: 'No background tasks yet. Long-running operations like deep research and image generation will appear here.',
				cls: 'gemini-bg-tasks-empty',
			});
			return;
		}

		if (active.length > 0) {
			const label = active.length > 10 ? `Running (${active.length})` : 'Running';
			contentEl.createEl('h3', { text: label });
			const scrollWrap = contentEl.createDiv({ cls: 'gemini-bg-tasks-scroll' });
			const list = scrollWrap.createEl('ul', { cls: 'gemini-bg-tasks-list' });
			// Show at most 10 running tasks — the rest are still tracked, just not rendered
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
			const recentHeader = contentEl.createDiv({ cls: 'gemini-bg-tasks-recent-header' });
			recentHeader.createEl('h3', { text: 'Recent' });
			const clearBtn = recentHeader.createEl('button', { text: 'Clear', cls: 'gemini-bg-tasks-clear' });
			clearBtn.addEventListener('click', () => {
				this.plugin.backgroundTaskManager?.clearFinished();
				this.render();
			});

			const scrollWrap = contentEl.createDiv({ cls: 'gemini-bg-tasks-scroll' });
			const list = scrollWrap.createEl('ul', { cls: 'gemini-bg-tasks-list' });
			for (const task of recent) {
				this.renderTaskItem(list, task, false);
			}
		}
	}

	private renderTaskItem(container: HTMLElement, task: BackgroundTask, canCancel: boolean): void {
		const li = container.createEl('li', { cls: `gemini-bg-task gemini-bg-task--${task.status}` });

		// Status icon
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

		// Label + meta
		const info = li.createDiv({ cls: 'gemini-bg-task-info' });
		info.createDiv({ text: task.label, cls: 'gemini-bg-task-label' });
		info.createDiv({ text: this.formatMeta(task), cls: 'gemini-bg-task-meta' });

		// Output link
		if (task.outputPath && task.status === 'complete') {
			const link = info.createEl('a', { text: 'Open result', href: '#', cls: 'gemini-bg-task-link' });
			link.addEventListener('click', (e) => {
				e.preventDefault();
				this.plugin.app.workspace.openLinkText(task.outputPath!, '', false);
				this.close();
			});
		}

		// Error message — first sentence only, full text on hover
		if (task.error && task.status === 'failed') {
			const short = this.truncateError(task.error);
			info.createSpan({ text: short, cls: 'gemini-bg-task-error', title: task.error } as any);
		}

		// Cancel button
		if (canCancel) {
			const btn = li.createEl('button', { text: 'Cancel', cls: 'gemini-bg-task-cancel mod-warning' });
			btn.addEventListener('click', () => {
				this.plugin.backgroundTaskManager?.cancel(task.id);
				this.render();
			});
		}
	}

	private formatMeta(task: BackgroundTask): string {
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

	onClose(): void {
		this.unsubscribers.forEach((unsub) => unsub());
		this.unsubscribers = [];
		this.contentEl.empty();
	}
}
