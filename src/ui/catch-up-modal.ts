import { App, Modal, setIcon } from 'obsidian';
import type ObsidianGemini from '../main';
import type { PendingCatchUp } from '../services/scheduled-task-manager';

/**
 * Modal shown on startup when scheduled tasks were missed while the plugin
 * was offline and the tasks have runIfMissed: true.
 *
 * Each row shows the task slug + how long ago it was due, with per-row
 * Approve / Skip buttons and global "Run all" / "Skip all" actions.
 *
 * Approving submits the task immediately via BackgroundTaskManager.
 * Skipping advances the task's nextRunAt without running it.
 */
export class CatchUpModal extends Modal {
	private plugin: ObsidianGemini;
	private pending: PendingCatchUp[];

	constructor(app: App, plugin: ObsidianGemini, pending: PendingCatchUp[]) {
		super(app);
		this.plugin = plugin;
		this.pending = [...pending];
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('gemini-catchup-modal');

		contentEl.createEl('h2', { text: 'Missed Scheduled Runs' });
		contentEl.createEl('p', {
			text: 'The following tasks were scheduled to run while Obsidian was closed. Choose which ones to run now.',
			cls: 'gemini-catchup-description',
		});

		const list = contentEl.createEl('ul', { cls: 'gemini-catchup-list' });
		this.renderList(list);

		// Global actions
		const actions = contentEl.createDiv({ cls: 'gemini-catchup-actions' });

		const runAllBtn = actions.createEl('button', {
			text: 'Run all',
			cls: 'mod-cta',
			attr: { type: 'button' },
		});
		runAllBtn.addEventListener('click', async () => {
			await this.approveAll();
			this.pending = [];
			this.close();
		});

		const skipAllBtn = actions.createEl('button', {
			text: 'Skip all',
			attr: { type: 'button' },
		});
		skipAllBtn.addEventListener('click', async () => {
			await this.skipAll();
			this.pending = [];
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
		// Only clear the badge when all tasks have been handled (run or skipped).
		// If the user dismissed without acting, leave the badge so they can reopen.
		if (this.pending.length === 0) {
			this.plugin.backgroundStatusBar?.setPendingCatchUpCount(0);
		}
	}

	// ---------------------------------------------------------------------------

	private renderList(list: HTMLElement): void {
		list.empty();

		if (this.pending.length === 0) {
			list.createEl('li', { text: 'No pending runs.', cls: 'gemini-catchup-empty' });
			return;
		}

		for (const entry of this.pending) {
			const li = list.createEl('li', { cls: 'gemini-catchup-item' });

			const info = li.createDiv({ cls: 'gemini-catchup-item-info' });
			const iconEl = info.createSpan({ cls: 'gemini-catchup-item-icon' });
			setIcon(iconEl, 'clock');
			info.createSpan({ cls: 'gemini-catchup-item-slug', text: entry.task.slug });
			info.createSpan({
				cls: 'gemini-catchup-item-age',
				text: `missed ${this.formatAge(entry.missedAt)}`,
			});

			const btns = li.createDiv({ cls: 'gemini-catchup-item-btns' });

			const approveBtn = btns.createEl('button', {
				text: 'Run',
				cls: 'mod-cta gemini-catchup-approve',
				attr: { type: 'button' },
			});
			approveBtn.addEventListener('click', async () => {
				await this.approveOne(entry);
				this.pending = this.pending.filter((p) => p.task.slug !== entry.task.slug);
				if (this.pending.length === 0) {
					this.close();
				} else {
					this.renderList(list);
				}
			});

			const skipBtn = btns.createEl('button', {
				text: 'Skip',
				attr: { type: 'button' },
			});
			skipBtn.addEventListener('click', async () => {
				await this.skipOne(entry);
				this.pending = this.pending.filter((p) => p.task.slug !== entry.task.slug);
				if (this.pending.length === 0) {
					this.close();
				} else {
					this.renderList(list);
				}
			});
		}
	}

	private async approveOne(entry: PendingCatchUp): Promise<void> {
		const mgr = this.plugin.scheduledTaskManager;
		if (!mgr) return;
		await mgr.runNow(entry.task.slug);
	}

	private async skipOne(entry: PendingCatchUp): Promise<void> {
		const mgr = this.plugin.scheduledTaskManager;
		if (!mgr) return;
		// Advance state so the task is not picked up again on the next tick
		await mgr.skipCatchUp(entry.task.slug);
	}

	private async approveAll(): Promise<void> {
		for (const entry of this.pending) {
			await this.approveOne(entry);
		}
	}

	private async skipAll(): Promise<void> {
		for (const entry of this.pending) {
			await this.skipOne(entry);
		}
	}

	private formatAge(date: Date): string {
		const diffMs = Date.now() - date.getTime();
		const mins = Math.floor(diffMs / 60_000);
		if (mins < 60) return `${mins}m ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		return `${days}d ago`;
	}
}
