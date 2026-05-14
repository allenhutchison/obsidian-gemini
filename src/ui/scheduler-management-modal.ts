import { Notice, Setting, setIcon } from 'obsidian';
import type { ScheduledTask, TaskState, ScheduledTasksState } from '../services/scheduled-task-manager';
import type { FeatureToolPolicy } from '../types/tool-policy';
import { ManagementModalBase } from './components/management-modal-base';
import { ToolPolicyEditor } from './components/tool-policy-editor';

const SCHEDULE_PRESETS = [
	{ label: 'Once', value: 'once' },
	{ label: 'Daily (every 24h)', value: 'daily' },
	{ label: 'Daily at time', value: 'daily-at' },
	{ label: 'Weekly (every 7d)', value: 'weekly' },
	{ label: 'Weekly on days at time', value: 'weekly-days' },
	{ label: 'Custom interval', value: 'custom' },
] as const;

// Order matches JS Date.getDay(); shown left-to-right in the day picker.
const WEEKDAY_OPTIONS = [
	{ code: 'sun', label: 'Sun' },
	{ code: 'mon', label: 'Mon' },
	{ code: 'tue', label: 'Tue' },
	{ code: 'wed', label: 'Wed' },
	{ code: 'thu', label: 'Thu' },
	{ code: 'fri', label: 'Fri' },
	{ code: 'sat', label: 'Sat' },
] as const;

/**
 * Full CRUD management modal for scheduled tasks. Extends the shared
 * ManagementModalBase to get the common scaffolding (view state machine,
 * list skeleton, delete confirmation, form skeleton) and implements the
 * task-specific rendering and CRUD.
 */
export class SchedulerManagementModal extends ManagementModalBase<ScheduledTask, TaskState> {
	private form = this.blankForm();

	// ── Configuration ────────────────────────────────────────────────────────

	protected readonly entityLabel = 'task';
	protected readonly entityLabelPlural = 'Scheduled Tasks';
	protected readonly entityIcon = 'calendar-clock';
	protected readonly newButtonText = 'New task';
	protected readonly emptyText = 'No scheduled tasks yet.';
	protected readonly emptyHint =
		'Create your first task to automate recurring AI prompts — daily summaries, weekly reports, and more.';
	protected readonly deleteTitle = 'Delete Task';
	protected readonly deleteHint = 'Run output files in Scheduled-Tasks/Runs/ are not deleted.';
	protected readonly slugPlaceholder = 'e.g. daily-summary';

	protected getCssClasses(): string[] {
		return ['gemini-scheduler-modal'];
	}

	protected getFormTitle(isEdit: boolean): string {
		return isEdit ? `Edit: ${this.editingSlug}` : 'New Scheduled Task';
	}

	// ── Data access ──────────────────────────────────────────────────────────

	protected getManager() {
		return this.plugin.scheduledTaskManager;
	}

	protected getEntities(): ScheduledTask[] {
		return this.plugin.scheduledTaskManager?.getTasks() ?? [];
	}

	protected getEntityStates(): ScheduledTasksState {
		return this.plugin.scheduledTaskManager?.getState() ?? {};
	}

	protected getEntitySlug(entity: ScheduledTask): string {
		return entity.slug;
	}

	// ── Row rendering ────────────────────────────────────────────────────────

	protected renderEntityRow(container: HTMLElement, task: ScheduledTask, taskState: TaskState | undefined): void {
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
				runBtn.disabled = false;
				runBtn.setText('Run now');
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

	// ── Form body ────────────────────────────────────────────────────────────

	protected renderFormBody(formEl: HTMLElement, _isEdit: boolean): void {
		// Schedule
		new Setting(formEl).setName('Schedule').setDesc('How often the task should run.');

		const scheduleRow = formEl.createDiv({ cls: 'gemini-scheduler-schedule-row' });
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

		// Time picker (HTML5 native — works on desktop and mobile without deps).
		// Shown for the time-of-day presets only.
		const timeInput = scheduleRow.createEl('input', {
			cls: 'gemini-scheduler-time-input',
			attr: {
				type: 'time',
				value: this.form.scheduleTime,
			},
		});

		// Day-of-week checkbox row, shown only for the weekly-days preset.
		const daysRow = formEl.createDiv({ cls: 'gemini-scheduler-days-row' });
		const dayCheckboxes: HTMLInputElement[] = [];
		for (const day of WEEKDAY_OPTIONS) {
			const label = daysRow.createEl('label', { cls: 'gemini-scheduler-day-label' });
			const cb = label.createEl('input', { attr: { type: 'checkbox' } }) as HTMLInputElement;
			cb.checked = this.form.scheduleDays.includes(day.code);
			cb.addEventListener('change', () => {
				if (cb.checked) {
					if (!this.form.scheduleDays.includes(day.code)) this.form.scheduleDays.push(day.code);
				} else {
					this.form.scheduleDays = this.form.scheduleDays.filter((d) => d !== day.code);
				}
			});
			label.appendText(` ${day.label}`);
			dayCheckboxes.push(cb);
		}

		const updateScheduleVisibility = (preset: string) => {
			customInput.style.display = preset === 'custom' ? '' : 'none';
			timeInput.style.display = preset === 'daily-at' || preset === 'weekly-days' ? '' : 'none';
			daysRow.style.display = preset === 'weekly-days' ? '' : 'none';
		};
		updateScheduleVisibility(this.form.schedulePreset);

		presetSelect.addEventListener('change', () => {
			this.form.schedulePreset = presetSelect.value as any;
			updateScheduleVisibility(presetSelect.value);
		});
		customInput.addEventListener('input', () => {
			this.form.scheduleCustom = customInput.value;
		});
		timeInput.addEventListener('input', () => {
			this.form.scheduleTime = timeInput.value;
		});

		// Tool access — shared editor (preset + per-tool overrides). Replaces
		// the old category checkbox row, which silently dropped vault-ops and
		// destructive tools because the checkbox values didn't match real
		// ToolCategory enum values.
		const toolsContainer = formEl.createDiv({ cls: 'gemini-scheduler-tools' });
		this.disposeToolPolicyEditor();
		this.toolPolicyEditor = new ToolPolicyEditor(this.plugin, toolsContainer, {
			title: 'Tool access',
			description: 'When inherited, this task uses the plugin\u2019s global tool policy.',
			value: this.form.toolPolicy,
			onChange: (next) => {
				this.form.toolPolicy = next;
			},
		});

		// Prompt
		new Setting(formEl)
			.setName('Prompt')
			.setDesc(
				'The instruction sent to the AI on each run. Supports the same markdown you would use in the agent chat.'
			);
		const promptArea = formEl.createEl('textarea', {
			cls: 'gemini-scheduler-prompt',
			attr: { rows: '8', placeholder: 'Write your prompt here…' },
		});
		promptArea.value = this.form.prompt;
		promptArea.addEventListener('input', () => {
			this.form.prompt = promptArea.value;
		});

		// Advanced section (collapsible)
		const advDetails = formEl.createEl('details', { cls: 'gemini-scheduler-advanced' });
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
	}

	// ── CRUD ─────────────────────────────────────────────────────────────────

	protected async deleteEntity(slug: string): Promise<void> {
		await this.plugin.scheduledTaskManager?.deleteTask(slug);
	}

	protected async handleSave(isEdit: boolean): Promise<void> {
		const schedule = this.resolvedSchedule();
		if (!schedule) {
			new Notice(
				'Please enter a valid schedule. Custom interval expects 30m or 2h. Daily at time and Weekly on days at time both need a valid HH:MM (and Weekly needs at least one day).'
			);
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
					toolPolicy: this.form.toolPolicy,
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
					toolPolicy: this.form.toolPolicy,
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

	// ── Form state ───────────────────────────────────────────────────────────

	protected resetForm(): void {
		this.form = this.blankForm();
	}

	protected populateFormForEdit(task: ScheduledTask): void {
		const preset = this.detectPreset(task.schedule);
		const blank = this.blankForm();
		const { time, days } = this.parseTimeAndDaysFromSchedule(task.schedule);
		this.form = {
			slug: task.slug,
			schedulePreset: preset,
			scheduleCustom: task.schedule.startsWith('interval:') ? task.schedule.slice('interval:'.length) : '',
			scheduleTime: time ?? blank.scheduleTime,
			scheduleDays: days ?? blank.scheduleDays,
			toolPolicy: task.toolPolicy,
			outputPath: task.outputPath,
			model: task.model ?? '',
			enabled: task.enabled,
			runIfMissed: task.runIfMissed,
			prompt: task.prompt,
		};
	}

	protected getFormSlug(): string {
		return this.form.slug;
	}

	protected setFormSlug(slug: string): void {
		this.form.slug = slug;
	}

	// ── Helpers (scheduler-specific) ─────────────────────────────────────────

	/**
	 * Override the base class truncateError with a richer version that
	 * extracts JSON "message" fields and strips ApiError prefixes.
	 */
	protected truncateError(raw: string): string {
		const jsonMatch = raw.match(/"message"\s*:\s*"([^"]+)"/);
		if (jsonMatch) {
			const msg = jsonMatch[1].split(/[\n]/)[0].trim();
			return msg.length > 120 ? msg.slice(0, 117) + '…' : msg;
		}
		const stripped = raw.replace(/^(ApiError:\s*)?\[\d+ [^\]]+\]\s*/, '').replace(/^ApiError:\s*/, '');
		const firstLine = stripped.split(/[\n.]/)[0].trim();
		return firstLine.length > 120 ? firstLine.slice(0, 117) + '…' : firstLine;
	}

	private blankForm() {
		return {
			slug: '',
			schedulePreset: 'daily' as string,
			scheduleCustom: '',
			scheduleTime: '09:00',
			scheduleDays: ['mon', 'tue', 'wed', 'thu', 'fri'] as string[],
			toolPolicy: undefined as FeatureToolPolicy | undefined,
			outputPath: '',
			model: '',
			enabled: true,
			runIfMissed: false,
			prompt: '',
		};
	}

	private detectPreset(schedule: string): string {
		if (schedule === 'once' || schedule === 'daily' || schedule === 'weekly') return schedule;
		if (/^daily@\d{1,2}:\d{2}$/.test(schedule)) return 'daily-at';
		if (/^weekly@\d{1,2}:\d{2}:[a-z,]+$/i.test(schedule)) return 'weekly-days';
		return 'custom';
	}

	private resolvedSchedule(): string | null {
		const preset = this.form.schedulePreset;
		if (preset === 'once' || preset === 'daily' || preset === 'weekly') return preset;
		if (preset === 'daily-at') {
			if (!this.isValidTime(this.form.scheduleTime)) return null;
			return `daily@${this.form.scheduleTime}`;
		}
		if (preset === 'weekly-days') {
			if (!this.isValidTime(this.form.scheduleTime) || this.form.scheduleDays.length === 0) return null;
			// Sort by canonical weekday order so the persisted value is stable
			// regardless of the order the user clicked the checkboxes in.
			const orderedDays = WEEKDAY_OPTIONS.map((d) => d.code).filter((c) => this.form.scheduleDays.includes(c));
			return `weekly@${this.form.scheduleTime}:${orderedDays.join(',')}`;
		}
		// custom
		const raw = this.form.scheduleCustom.trim();
		if (!raw) return null;
		if (/^\d+(m|h)$/.test(raw)) return `interval:${raw}`;
		// Accept full form too
		if (/^interval:\d+(m|h)$/.test(raw)) return raw;
		return null;
	}

	private isValidTime(value: string): boolean {
		const m = /^(\d{1,2}):(\d{2})$/.exec(value);
		if (!m) return false;
		const h = parseInt(m[1], 10);
		const min = parseInt(m[2], 10);
		return h >= 0 && h <= 23 && min >= 0 && min <= 59;
	}

	/**
	 * Pull the time and day-list out of a `daily@HH:MM` or `weekly@HH:MM:days`
	 * schedule so the form can pre-fill its time/day controls when editing.
	 * Returns nulls for any other schedule shape (the caller falls back to
	 * defaults from `blankForm()`).
	 */
	private parseTimeAndDaysFromSchedule(schedule: string): { time: string | null; days: string[] | null } {
		const dailyAt = /^daily@(\d{1,2}:\d{2})$/.exec(schedule);
		if (dailyAt) return { time: dailyAt[1], days: null };
		const weeklyDays = /^weekly@(\d{1,2}:\d{2}):([a-z,]+)$/i.exec(schedule);
		if (weeklyDays) {
			const validCodes = WEEKDAY_OPTIONS.map((d) => d.code) as readonly string[];
			const days = weeklyDays[2]
				.toLowerCase()
				.split(',')
				.filter((d) => validCodes.includes(d));
			return { time: weeklyDays[1], days: days.length > 0 ? days : null };
		}
		return { time: null, days: null };
	}
}
