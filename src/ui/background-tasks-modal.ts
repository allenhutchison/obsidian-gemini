import { App, Modal, setIcon } from 'obsidian';
import type ObsidianGemini from '../main';
import type { BackgroundTask } from '../services/background-task-manager';

/**
 * Modal that lists all running and recently completed background tasks.
 * Opened by clicking the status bar indicator or via the command palette.
 */
export class BackgroundTasksModal extends Modal {
	private plugin: ObsidianGemini;

	constructor(app: App, plugin: ObsidianGemini) {
		super(app);
		this.plugin = plugin;
	}

	onOpen(): void {
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
			contentEl.createEl('h3', { text: 'Running' });
			const list = contentEl.createEl('ul', { cls: 'gemini-bg-tasks-list' });
			for (const task of active) {
				this.renderTaskItem(list, task, true);
			}
		}

		if (recent.length > 0) {
			contentEl.createEl('h3', { text: 'Recent' });
			const list = contentEl.createEl('ul', { cls: 'gemini-bg-tasks-list' });
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

		// Error message
		if (task.error && task.status === 'failed') {
			info.createSpan({ text: task.error, cls: 'gemini-bg-task-error' });
		}

		// Cancel button
		if (canCancel) {
			const btn = li.createEl('button', { text: 'Cancel', cls: 'gemini-bg-task-cancel mod-warning' });
			btn.addEventListener('click', () => {
				this.plugin.backgroundTaskManager?.cancel(task.id);
				this.onOpen(); // re-render
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

	onClose(): void {
		this.contentEl.empty();
	}
}
