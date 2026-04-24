import { App, Modal, setIcon } from 'obsidian';
import type ObsidianGemini from '../main';
import type { ScheduledTask, TaskState } from '../services/scheduled-task-manager';

/**
 * Modal that lists all known scheduled tasks with their next-run time and last-run status.
 * Opened via the command palette ("View Scheduled Tasks").
 */
export class ScheduledTasksModal extends Modal {
	constructor(
		app: App,
		private plugin: ObsidianGemini
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('gemini-scheduled-tasks-modal');

		contentEl.createEl('h2', { text: 'Scheduled Tasks' });

		const manager = this.plugin.scheduledTaskManager;
		if (!manager) {
			contentEl.createEl('p', { text: 'Scheduled task manager not available.' });
			return;
		}

		const tasks = manager.getTasks();
		const state = manager.getState();

		if (tasks.length === 0) {
			contentEl.createEl('p', {
				text: 'No scheduled tasks found. Create a markdown file in the Scheduled-Tasks folder to get started.',
				cls: 'gemini-scheduled-tasks-empty',
			});
			return;
		}

		const list = contentEl.createEl('ul', { cls: 'gemini-scheduled-tasks-list' });
		for (const task of tasks) {
			this.renderTaskRow(list, task, state[task.slug]);
		}
	}

	private renderTaskRow(container: HTMLElement, task: ScheduledTask, taskState: TaskState | undefined): void {
		const isPaused = taskState?.pausedDueToErrors === true;
		const isDisabled = !task.enabled;

		const li = container.createEl('li', {
			cls: [
				'gemini-scheduled-task',
				isDisabled ? 'gemini-scheduled-task--disabled' : '',
				isPaused ? 'gemini-scheduled-task--paused' : '',
			]
				.filter(Boolean)
				.join(' '),
		});

		// Status icon
		const iconEl = li.createSpan({ cls: 'gemini-scheduled-task-icon' });
		setIcon(iconEl, isPaused ? 'alert-circle' : isDisabled ? 'pause-circle' : 'clock');

		const info = li.createDiv({ cls: 'gemini-scheduled-task-info' });
		info.createDiv({ text: task.slug, cls: 'gemini-scheduled-task-label' });

		// Schedule badge
		const badgeText = isDisabled
			? `${task.schedule} · disabled`
			: isPaused
				? `${task.schedule} · paused`
				: task.schedule;
		info.createSpan({ text: badgeText, cls: 'gemini-scheduled-task-badge' });

		// Next run / last run
		if (taskState) {
			if (!isPaused) {
				const nextRun = new Date(taskState.nextRunAt);
				const nextLabel = nextRun.getTime() >= 8_639_000_000_000_000 ? 'Once — complete' : this.formatDate(nextRun);
				info.createDiv({ text: `Next: ${nextLabel}`, cls: 'gemini-scheduled-task-meta' });
			}

			if (taskState.lastRunAt) {
				info.createDiv({
					text: `Last: ${this.formatDate(new Date(taskState.lastRunAt))}`,
					cls: 'gemini-scheduled-task-meta',
				});
			}

			if (taskState.lastError) {
				info.createDiv({
					text: this.truncateError(taskState.lastError),
					cls: 'gemini-scheduled-task-error',
					title: taskState.lastError, // full message on hover
				} as any);
			}
		}

		const actions = li.createDiv({ cls: 'gemini-scheduled-task-actions' });

		if (isPaused) {
			// "Reset" button re-enables a paused task
			const resetBtn = actions.createEl('button', { text: 'Reset', cls: 'gemini-scheduled-task-reset' });
			resetBtn.addEventListener('click', async () => {
				resetBtn.disabled = true;
				resetBtn.setText('Resetting…');
				await this.plugin.scheduledTaskManager?.resetTask(task.slug);
				this.onOpen(); // re-render
			});
		}

		// "Run now" button — disabled while paused
		const runBtn = actions.createEl('button', {
			text: 'Run now',
			cls: 'gemini-scheduled-task-run',
		});
		if (isPaused || isDisabled) runBtn.disabled = true;

		runBtn.addEventListener('click', async () => {
			runBtn.disabled = true;
			runBtn.setText('Running…');
			try {
				await this.plugin.scheduledTaskManager?.runNow(task.slug);
				runBtn.setText('Submitted');
			} catch (error) {
				runBtn.setText('Error');
				this.plugin.logger.error(`[ScheduledTasksModal] runNow failed for "${task.slug}":`, error);
			}
		});
	}

	/** Return the first meaningful line of an error, capped at 120 chars. */
	private truncateError(raw: string): string {
		// Try to extract the human-readable message from a Gemini JSON error blob
		// e.g. ApiError: {"error":{"code":429,"message":"You exceeded..."}}
		const jsonMatch = raw.match(/"message"\s*:\s*"([^"]+)"/);
		if (jsonMatch) {
			const msg = jsonMatch[1].split(/[\n]/)[0].trim();
			return msg.length > 120 ? msg.slice(0, 117) + '…' : msg;
		}
		// Strip HTTP status prefix like "[429 Too Many Requests] "
		const stripped = raw.replace(/^(ApiError:\s*)?\[\d+ [^\]]+\]\s*/, '').replace(/^ApiError:\s*/, '');
		const firstLine = stripped.split(/[\n.]/)[0].trim();
		return firstLine.length > 120 ? firstLine.slice(0, 117) + '…' : firstLine;
	}

	private formatDate(date: Date): string {
		return date.toLocaleString([], {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
