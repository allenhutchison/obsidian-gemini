import { App, Modal, Notice, Setting, setIcon } from 'obsidian';
import type ObsidianGemini from '../main';
import type { ScheduledTask, TaskState } from '../services/scheduled-task-manager';

type View = 'list' | 'create' | 'edit';

const TOOL_CATEGORIES = ['read_only', 'read_write', 'destructive'] as const;

const SCHEDULE_PRESETS = [
	{ label: 'Once', value: 'once' },
	{ label: 'Daily', value: 'daily' },
	{ label: 'Weekly', value: 'weekly' },
	{ label: 'Custom interval', value: 'custom' },
] as const;

/**
 * Full CRUD management modal for scheduled tasks.
 *
 * Views:
 *   list   — lists all tasks with toggle, edit, delete, run-now controls
 *   create — form for a new task
 *   edit   — form pre-filled with an existing task's values
 *
 * Opening via "New Scheduled Task" command skips straight to the create view.
 */
export class SchedulerManagementModal extends Modal {
	private view: View;
	private editingSlug: string | null = null;
	private eventUnsubscribers: Array<() => void> = [];

	// Form state (shared between create and edit views)
	private form = this.blankForm();

	constructor(
		app: App,
		private plugin: ObsidianGemini,
		initialView: View = 'list'
	) {
		super(app);
		this.view = initialView;
	}

	onOpen(): void {
		this.render();
		this.subscribeToTaskEvents();
	}

	onClose(): void {
		this.eventUnsubscribers.forEach((fn) => fn());
		this.eventUnsubscribers = [];
		this.contentEl.empty();
	}

	/**
	 * Re-render the list whenever a background task finishes so errors and
	 * last-run times appear immediately without closing and reopening the modal.
	 */
	private subscribeToTaskEvents(): void {
		const bus = this.plugin.agentEventBus;
		if (!bus) return;

		const refresh = async () => {
			if (this.view === 'list') this.render();
		};

		this.eventUnsubscribers.push(bus.on('backgroundTaskComplete', refresh), bus.on('backgroundTaskFailed', refresh));
	}

	// ---------------------------------------------------------------------------
	// Render dispatcher
	// ---------------------------------------------------------------------------

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('gemini-scheduler-modal');

		switch (this.view) {
			case 'list':
				this.renderList();
				break;
			case 'create':
				this.renderForm(false);
				break;
			case 'edit':
				this.renderForm(true);
				break;
		}
	}

	// ---------------------------------------------------------------------------
	// List view
	// ---------------------------------------------------------------------------

	private renderList(): void {
		const { contentEl } = this;

		const header = contentEl.createDiv({ cls: 'gemini-scheduler-header' });
		header.createEl('h2', { text: 'Scheduled Tasks' });

		const newBtn = header.createEl('button', {
			text: 'New task',
			cls: 'mod-cta gemini-scheduler-new-btn',
			attr: { type: 'button' },
		});
		setIcon(newBtn.createSpan({ cls: 'gemini-scheduler-btn-icon' }), 'plus');
		newBtn.addEventListener('click', () => this.openCreate());

		const manager = this.plugin.scheduledTaskManager;
		if (!manager) {
			contentEl.createEl('p', { text: 'Scheduled task manager not available.' });
			return;
		}

		const tasks = manager.getTasks();
		const state = manager.getState();

		if (tasks.length === 0) {
			const empty = contentEl.createDiv({ cls: 'gemini-scheduler-empty' });
			const iconEl = empty.createDiv({ cls: 'gemini-scheduler-empty-icon' });
			setIcon(iconEl, 'calendar-clock');
			empty.createEl('p', { text: 'No scheduled tasks yet.' });
			empty.createEl('p', {
				text: 'Create your first task to automate recurring AI prompts — daily summaries, weekly reports, and more.',
				cls: 'gemini-scheduler-empty-hint',
			});
			return;
		}

		const list = contentEl.createEl('ul', { cls: 'gemini-scheduler-list' });
		for (const task of tasks) {
			this.renderTaskRow(list, task, state[task.slug]);
		}
	}

	private renderTaskRow(container: HTMLElement, task: ScheduledTask, taskState: TaskState | undefined): void {
		const isPaused = taskState?.pausedDueToErrors === true;
		const isDisabled = !task.enabled;

		const li = container.createEl('li', {
			cls: [
				'gemini-scheduler-item',
				isDisabled ? 'gemini-scheduler-item--disabled' : '',
				isPaused ? 'gemini-scheduler-item--paused' : '',
			]
				.filter(Boolean)
				.join(' '),
		});

		// Status icon
		const iconEl = li.createSpan({ cls: 'gemini-scheduler-item-icon' });
		setIcon(iconEl, isPaused ? 'alert-circle' : isDisabled ? 'pause-circle' : 'clock');

		// Info block
		const info = li.createDiv({ cls: 'gemini-scheduler-item-info' });
		info.createDiv({ text: task.slug, cls: 'gemini-scheduler-item-slug' });

		const badgeText = isDisabled
			? `${task.schedule} · disabled`
			: isPaused
				? `${task.schedule} · paused`
				: task.schedule;
		info.createSpan({ text: badgeText, cls: 'gemini-scheduler-item-badge' });

		if (taskState && !isPaused) {
			const nextRun = new Date(taskState.nextRunAt);
			const nextLabel = nextRun.getTime() >= 8_639_000_000_000_000 ? 'Once — complete' : this.formatDate(nextRun);
			info.createDiv({ text: `Next: ${nextLabel}`, cls: 'gemini-scheduler-item-meta' });
		}
		if (taskState?.lastRunAt) {
			info.createDiv({
				text: `Last: ${this.formatDate(new Date(taskState.lastRunAt))}`,
				cls: 'gemini-scheduler-item-meta',
			});
		}
		if (taskState?.lastError) {
			info.createDiv({
				text: this.truncateError(taskState.lastError),
				cls: 'gemini-scheduler-item-error',
				title: taskState.lastError,
			} as any);
		}

		// Action buttons
		const actions = li.createDiv({ cls: 'gemini-scheduler-item-actions' });

		// Toggle (enable/disable)
		const toggleBtn = actions.createEl('button', {
			text: isDisabled ? 'Enable' : 'Disable',
			cls: 'gemini-scheduler-action',
			attr: { type: 'button', title: isDisabled ? 'Enable this task' : 'Disable this task' },
		});
		toggleBtn.addEventListener('click', async () => {
			toggleBtn.disabled = true;
			toggleBtn.setText('…');
			try {
				await this.plugin.scheduledTaskManager?.updateTask(task.slug, { enabled: !task.enabled });
				this.render();
			} catch (err) {
				this.plugin.logger.error(`[SchedulerManagementModal] Toggle failed for "${task.slug}":`, err);
				new Notice(`Failed to toggle "${task.slug}"`);
				toggleBtn.setText(isDisabled ? 'Enable' : 'Disable');
				toggleBtn.disabled = false;
			}
		});

		if (isPaused) {
			const resetBtn = actions.createEl('button', {
				text: 'Reset',
				cls: 'gemini-scheduler-action',
				attr: { type: 'button', title: 'Clear error state and re-enable' },
			});
			resetBtn.addEventListener('click', async () => {
				resetBtn.disabled = true;
				await this.plugin.scheduledTaskManager?.resetTask(task.slug);
				this.render();
			});
		}

		// Run now
		const runBtn = actions.createEl('button', {
			text: 'Run now',
			cls: 'gemini-scheduler-action',
			attr: { type: 'button' },
		});
		if (isPaused || isDisabled) runBtn.disabled = true;
		runBtn.addEventListener('click', async () => {
			runBtn.disabled = true;
			runBtn.setText('Running…');
			try {
				await this.plugin.scheduledTaskManager?.runNow(task.slug);
				runBtn.setText('Submitted');
			} catch (err) {
				this.plugin.logger.error(`[SchedulerManagementModal] runNow failed for "${task.slug}":`, err);
				new Notice(`Failed to run "${task.slug}"`);
				runBtn.setText('Error');
			}
		});

		// Edit
		const editBtn = actions.createEl('button', {
			text: 'Edit',
			cls: 'gemini-scheduler-action',
			attr: { type: 'button' },
		});
		editBtn.addEventListener('click', () => this.openEdit(task));

		// Delete
		const deleteBtn = actions.createEl('button', {
			text: 'Delete',
			cls: 'gemini-scheduler-action gemini-scheduler-action--delete',
			attr: { type: 'button' },
		});
		deleteBtn.addEventListener('click', () => this.confirmDelete(task.slug));
	}

	private confirmDelete(slug: string): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Delete Task' });
		contentEl.createEl('p', { text: `Delete "${slug}"? This removes the task definition file permanently.` });
		contentEl.createEl('p', {
			text: 'Run output files in Scheduled-Tasks/Runs/ are not deleted.',
			cls: 'gemini-scheduler-delete-hint',
		});

		const btns = contentEl.createDiv({ cls: 'gemini-scheduler-confirm-btns' });

		const cancelBtn = btns.createEl('button', { text: 'Cancel', attr: { type: 'button' } });
		cancelBtn.addEventListener('click', () => this.render());

		const confirmBtn = btns.createEl('button', {
			text: 'Delete',
			cls: 'gemini-scheduler-confirm-delete',
			attr: { type: 'button' },
		});
		confirmBtn.addEventListener('click', async () => {
			confirmBtn.disabled = true;
			confirmBtn.setText('Deleting…');
			try {
				await this.plugin.scheduledTaskManager?.deleteTask(slug);
				new Notice(`Task "${slug}" deleted`);
				this.render();
			} catch (err) {
				this.plugin.logger.error(`[SchedulerManagementModal] Delete failed for "${slug}":`, err);
				new Notice(`Failed to delete "${slug}"`);
				this.render();
			}
		});
	}

	// ---------------------------------------------------------------------------
	// Create / Edit form view
	// ---------------------------------------------------------------------------

	private openCreate(): void {
		this.view = 'create';
		this.editingSlug = null;
		this.form = this.blankForm();
		this.render();
	}

	private openEdit(task: ScheduledTask): void {
		this.view = 'edit';
		this.editingSlug = task.slug;
		this.form = {
			slug: task.slug,
			schedulePreset: this.detectPreset(task.schedule),
			scheduleCustom: task.schedule.startsWith('interval:') ? task.schedule.slice('interval:'.length) : '',
			enabledTools: [...task.enabledTools],
			outputPath: task.outputPath,
			model: task.model ?? '',
			enabled: task.enabled,
			runIfMissed: task.runIfMissed,
			prompt: task.prompt,
		};
		this.render();
	}

	private renderForm(isEdit: boolean): void {
		const { contentEl } = this;

		// Back link
		const back = contentEl.createEl('button', {
			text: '← Back to list',
			cls: 'gemini-scheduler-back',
			attr: { type: 'button' },
		});
		back.addEventListener('click', () => {
			this.view = 'list';
			this.render();
		});

		contentEl.createEl('h2', { text: isEdit ? `Edit: ${this.editingSlug}` : 'New Scheduled Task' });

		const form = contentEl.createEl('form', { cls: 'gemini-scheduler-form' });
		form.addEventListener('submit', (e) => e.preventDefault());

		// Slug (create only)
		if (!isEdit) {
			new Setting(form)
				.setName('Task name (slug)')
				.setDesc('Lowercase identifier used as the filename and in output paths. Cannot be changed after creation.')
				.addText((text) =>
					text
						.setPlaceholder('e.g. daily-summary')
						.setValue(this.form.slug)
						.onChange((v) => {
							this.form.slug = v.toLowerCase().replace(/[^a-z0-9-]/g, '-');
							text.setValue(this.form.slug);
						})
				);
		}

		// Schedule
		new Setting(form).setName('Schedule').setDesc('How often the task should run.');

		const scheduleRow = form.createDiv({ cls: 'gemini-scheduler-schedule-row' });
		const presetSelect = scheduleRow.createEl('select', { cls: 'gemini-scheduler-select' });
		for (const preset of SCHEDULE_PRESETS) {
			const opt = presetSelect.createEl('option', { value: preset.value, text: preset.label });
			if (this.form.schedulePreset === preset.value) opt.selected = true;
		}

		const customInput = scheduleRow.createEl('input', {
			cls: 'gemini-scheduler-custom-interval',
			attr: {
				type: 'text',
				placeholder: 'e.g. 30m or 2h',
				value: this.form.scheduleCustom,
			},
		});
		customInput.style.display = this.form.schedulePreset === 'custom' ? '' : 'none';

		presetSelect.addEventListener('change', () => {
			this.form.schedulePreset = presetSelect.value as any;
			customInput.style.display = presetSelect.value === 'custom' ? '' : 'none';
		});
		customInput.addEventListener('input', () => {
			this.form.scheduleCustom = customInput.value;
		});

		// Tool access
		new Setting(form).setName('Tool access').setDesc('Which tool categories the agent may use during a run.');
		const toolsContainer = form.createDiv({ cls: 'gemini-scheduler-tools' });
		for (const cat of TOOL_CATEGORIES) {
			const label = toolsContainer.createEl('label', { cls: 'gemini-scheduler-tool-label' });
			const cb = label.createEl('input', { attr: { type: 'checkbox' } }) as HTMLInputElement;
			cb.checked = this.form.enabledTools.includes(cat);
			cb.addEventListener('change', () => {
				if (cb.checked) {
					if (!this.form.enabledTools.includes(cat)) this.form.enabledTools.push(cat);
				} else {
					this.form.enabledTools = this.form.enabledTools.filter((t) => t !== cat);
				}
			});
			label.appendText(` ${cat}`);
		}

		// Prompt
		new Setting(form)
			.setName('Prompt')
			.setDesc(
				'The instruction sent to the AI on each run. Supports the same markdown you would use in the agent chat.'
			);
		const promptArea = form.createEl('textarea', {
			cls: 'gemini-scheduler-prompt',
			attr: { rows: '8', placeholder: 'Write your prompt here…' },
		});
		promptArea.value = this.form.prompt;
		promptArea.addEventListener('input', () => {
			this.form.prompt = promptArea.value;
		});

		// Advanced section (collapsible)
		const advDetails = form.createEl('details', { cls: 'gemini-scheduler-advanced' });
		advDetails.createEl('summary', { text: 'Advanced options' });

		new Setting(advDetails)
			.setName('Model override')
			.setDesc('Override the plugin chat model for this task (e.g. gemini-2.0-flash). Leave blank to use the default.')
			.addText((text) =>
				text
					.setPlaceholder('gemini-2.0-flash')
					.setValue(this.form.model)
					.onChange((v) => {
						this.form.model = v.trim();
					})
			);

		new Setting(advDetails)
			.setName('Output path')
			.setDesc(
				`Where to write results. Supports {slug} and {date} placeholders. Default: ${this.plugin.scheduledTaskManager?.scheduledTasksFolder ?? '<state-folder>'}/Runs/<slug>/{date}.md`
			)
			.addText((text) =>
				text.setValue(this.form.outputPath).onChange((v) => {
					this.form.outputPath = v.trim();
				})
			);

		new Setting(advDetails)
			.setName('Run if missed')
			.setDesc(
				'When Obsidian was closed and this task was due, show it in the catch-up approval modal on next startup.'
			)
			.addToggle((toggle) =>
				toggle.setValue(this.form.runIfMissed).onChange((v) => {
					this.form.runIfMissed = v;
				})
			);

		new Setting(advDetails)
			.setName('Enabled')
			.setDesc('Disable to pause the task without deleting it.')
			.addToggle((toggle) =>
				toggle.setValue(this.form.enabled).onChange((v) => {
					this.form.enabled = v;
				})
			);

		// Footer buttons
		const footer = form.createDiv({ cls: 'gemini-scheduler-footer' });

		const saveBtn = footer.createEl('button', {
			text: isEdit ? 'Save changes' : 'Create task',
			cls: 'mod-cta',
			attr: { type: 'button' },
		});
		saveBtn.addEventListener('click', () => this.handleSave(isEdit));

		const cancelBtn = footer.createEl('button', {
			text: 'Cancel',
			attr: { type: 'button' },
		});
		cancelBtn.addEventListener('click', () => {
			this.view = 'list';
			this.render();
		});
	}

	private async handleSave(isEdit: boolean): Promise<void> {
		const schedule = this.resolvedSchedule();
		if (!schedule) {
			new Notice('Please enter a valid schedule (e.g. 30m or 2h for custom intervals).');
			return;
		}
		if (!this.form.prompt.trim()) {
			new Notice('Prompt cannot be empty.');
			return;
		}
		if (!isEdit && !this.form.slug.trim()) {
			new Notice('Task name cannot be empty.');
			return;
		}

		const manager = this.plugin.scheduledTaskManager;
		if (!manager) {
			new Notice('Scheduled task manager not available.');
			return;
		}

		try {
			if (isEdit && this.editingSlug) {
				await manager.updateTask(this.editingSlug, {
					schedule,
					enabledTools: this.form.enabledTools,
					outputPath: this.form.outputPath || undefined,
					model: this.form.model || undefined,
					enabled: this.form.enabled,
					runIfMissed: this.form.runIfMissed,
					prompt: this.form.prompt,
				});
				new Notice(`Task "${this.editingSlug}" updated`);
			} else {
				await manager.createTask({
					slug: this.form.slug,
					schedule,
					enabledTools: this.form.enabledTools,
					outputPath: this.form.outputPath || undefined,
					model: this.form.model || undefined,
					enabled: this.form.enabled,
					runIfMissed: this.form.runIfMissed,
					prompt: this.form.prompt,
				});
				new Notice(`Task "${this.form.slug}" created`);
			}
			this.view = 'list';
			this.render();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this.plugin.logger.error('[SchedulerManagementModal] Save failed:', err);
			new Notice(`Failed to save task: ${msg}`);
		}
	}

	// ---------------------------------------------------------------------------
	// Helpers
	// ---------------------------------------------------------------------------

	private blankForm() {
		return {
			slug: '',
			schedulePreset: 'daily' as string,
			scheduleCustom: '',
			enabledTools: ['read_only'] as string[],
			outputPath: '',
			model: '',
			enabled: true,
			runIfMissed: false,
			prompt: '',
		};
	}

	private detectPreset(schedule: string): string {
		if (schedule === 'once' || schedule === 'daily' || schedule === 'weekly') return schedule;
		return 'custom';
	}

	private resolvedSchedule(): string | null {
		if (this.form.schedulePreset !== 'custom') return this.form.schedulePreset;
		const raw = this.form.scheduleCustom.trim();
		if (!raw) return null;
		if (/^\d+(m|h)$/.test(raw)) return `interval:${raw}`;
		// Accept full form too
		if (/^interval:\d+(m|h)$/.test(raw)) return raw;
		return null;
	}

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

	private formatDate(date: Date): string {
		return date.toLocaleString([], {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		});
	}
}
