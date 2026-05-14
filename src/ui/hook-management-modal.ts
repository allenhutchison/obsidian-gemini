import { Notice, Setting, setIcon } from 'obsidian';
import type { Hook, HookAction, HookState, HookTrigger, HooksState } from '../services/hook-manager';
import type { FeatureToolPolicy } from '../types/tool-policy';
import { ManagementModalBase } from './components/management-modal-base';
import { ToolPolicyEditor } from './components/tool-policy-editor';

const TRIGGER_OPTIONS: { value: HookTrigger; label: string; hint: string }[] = [
	{ value: 'file-modified', label: 'File modified (save)', hint: 'Fires when a file is saved.' },
	{ value: 'file-created', label: 'File created', hint: 'Fires when a new file appears.' },
	{ value: 'file-deleted', label: 'File deleted', hint: 'Fires after a file is removed.' },
	{ value: 'file-renamed', label: 'File renamed/moved', hint: 'Fires when a path changes.' },
];

const ACTION_OPTIONS: { value: HookAction; label: string; hint: string }[] = [
	{ value: 'agent-task', label: 'Agent task', hint: 'Run a headless agent session with the prompt body.' },
	{ value: 'summarize', label: 'Summarise file', hint: 'Run the summary feature against the triggering file.' },
	{
		value: 'rewrite',
		label: 'Rewrite file',
		hint: 'Rewrite the entire triggering file using the prompt body as the instruction.',
	},
	{ value: 'command', label: 'Run command', hint: 'Execute a registered command palette command by id.' },
];

const DEFAULT_DEBOUNCE_MS = 5000;
const DEFAULT_COOLDOWN_MS = 30_000;

/**
 * Full CRUD management modal for lifecycle hooks. Extends the shared
 * ManagementModalBase to get the common scaffolding (view state machine,
 * list skeleton, delete confirmation, form skeleton) and implements the
 * hook-specific rendering and CRUD.
 */
export class HookManagementModal extends ManagementModalBase<Hook, HookState> {
	private form = this.blankForm();

	// ── Configuration ────────────────────────────────────────────────────────

	protected readonly entityLabel = 'hook';
	protected readonly entityLabelPlural = 'Lifecycle Hooks';
	protected readonly entityIcon = 'webhook';
	protected readonly newButtonText = 'New hook';
	protected readonly emptyText = 'No hooks yet.';
	protected readonly emptyHint =
		'Hooks run an AI agent in response to vault events — file saves, creates, deletes, renames. Create your first hook to summarise on save, index new attachments, or run a skill on certain notes.';
	protected readonly deleteTitle = 'Delete Hook';
	protected readonly deleteHint = 'Output files in Hooks/Runs/ are not deleted.';
	protected readonly slugPlaceholder = 'e.g. summarise-on-save';

	protected getCssClasses(): string[] {
		// Reuse the scheduler modal's CSS class so the two share a visual
		// design language without a parallel CSS file. `gemini-hook-modal`
		// is the per-feature hook so theme overrides can target hooks
		// specifically when they need to.
		return ['gemini-scheduler-modal', 'gemini-hook-modal'];
	}

	protected getFormTitle(isEdit: boolean): string {
		return isEdit ? `Edit hook: ${this.editingSlug}` : 'New hook';
	}

	// ── Data access ──────────────────────────────────────────────────────────

	protected getManager() {
		return this.plugin.hookManager;
	}

	protected getEntities(): Hook[] {
		return this.plugin.hookManager?.getHooks() ?? [];
	}

	protected getEntityStates(): HooksState {
		return this.plugin.hookManager?.getStateSnapshot() ?? {};
	}

	protected getEntitySlug(entity: Hook): string {
		return entity.slug;
	}

	// ── List preamble ────────────────────────────────────────────────────────

	protected renderListPreamble(contentEl: HTMLElement): void {
		if (!this.plugin.settings.hooksEnabled) {
			const banner = contentEl.createDiv({ cls: 'gemini-scheduler-empty' });
			const iconEl = banner.createDiv({ cls: 'gemini-scheduler-empty-icon' });
			setIcon(iconEl, 'pause-circle');
			banner.createEl('p', { text: 'Lifecycle hooks are disabled.' });
			banner.createEl('p', {
				text: 'Enable "Lifecycle hooks" in plugin settings before any hook can fire. You can still create definitions here while disabled — they will not run until you turn the feature on.',
				cls: 'gemini-scheduler-empty-hint',
			});
		}
	}

	// ── Row rendering ────────────────────────────────────────────────────────

	protected renderEntityRow(container: HTMLElement, hook: Hook, hookState: HookState | undefined): void {
		const isPaused = hookState?.pausedDueToErrors === true;
		const isDisabled = !hook.enabled;

		const li = container.createEl('li', {
			cls: [
				'gemini-scheduler-item',
				isDisabled ? 'gemini-scheduler-item--disabled' : '',
				isPaused ? 'gemini-scheduler-item--paused' : '',
			]
				.filter(Boolean)
				.join(' '),
		});

		const iconEl = li.createSpan({ cls: 'gemini-scheduler-item-icon' });
		setIcon(iconEl, isPaused ? 'alert-circle' : isDisabled ? 'pause-circle' : 'webhook');

		const info = li.createDiv({ cls: 'gemini-scheduler-item-info' });
		info.createDiv({ text: hook.slug, cls: 'gemini-scheduler-item-slug' });

		const triggerLabel = TRIGGER_OPTIONS.find((t) => t.value === hook.trigger)?.label ?? hook.trigger;
		const actionLabel = ACTION_OPTIONS.find((a) => a.value === hook.action)?.label ?? hook.action;
		const baseBadge = `${triggerLabel} → ${actionLabel}`;
		const badge = isDisabled ? `${baseBadge} · disabled` : isPaused ? `${baseBadge} · paused` : baseBadge;
		info.createSpan({ text: badge, cls: 'gemini-scheduler-item-badge' });

		if (hook.pathGlob) {
			info.createDiv({ text: `Glob: ${hook.pathGlob}`, cls: 'gemini-scheduler-item-meta' });
		}

		const lastFires = hookState?.recentFires ?? [];
		if (lastFires.length > 0) {
			const lastFire = new Date(lastFires[lastFires.length - 1]);
			info.createDiv({
				text: `Last fired: ${this.formatDate(lastFire)}`,
				cls: 'gemini-scheduler-item-meta',
			});
		}

		if (hookState?.lastError) {
			info.createDiv({
				text: this.truncateError(hookState.lastError),
				cls: 'gemini-scheduler-item-error',
				attr: { title: hookState.lastError },
			});
		}

		// Actions
		const actions = li.createDiv({ cls: 'gemini-scheduler-item-actions' });

		const toggleBtn = actions.createEl('button', {
			text: isDisabled ? 'Enable' : 'Disable',
			cls: 'gemini-scheduler-action',
			attr: { type: 'button' },
		});
		toggleBtn.addEventListener('click', async () => {
			toggleBtn.disabled = true;
			toggleBtn.setText('…');
			try {
				await this.plugin.hookManager?.toggleHook(hook.slug, !hook.enabled);
				this.render();
			} catch (err) {
				this.plugin.logger.error(`[HookManagementModal] Toggle failed for "${hook.slug}":`, err);
				new Notice(`Failed to toggle "${hook.slug}"`);
				toggleBtn.setText(isDisabled ? 'Enable' : 'Disable');
				toggleBtn.disabled = false;
			}
		});

		if (isPaused) {
			const resetBtn = actions.createEl('button', {
				text: 'Reset',
				cls: 'gemini-scheduler-action',
				attr: { type: 'button', title: 'Clear pause state' },
			});
			resetBtn.addEventListener('click', async () => {
				resetBtn.disabled = true;
				await this.plugin.hookManager?.resetHook(hook.slug);
				this.render();
			});
		}

		const editBtn = actions.createEl('button', {
			text: 'Edit',
			cls: 'gemini-scheduler-action',
			attr: { type: 'button' },
		});
		editBtn.addEventListener('click', () => this.openEdit(hook));

		const deleteBtn = actions.createEl('button', {
			text: 'Delete',
			cls: 'gemini-scheduler-action gemini-scheduler-action--delete',
			attr: { type: 'button' },
		});
		deleteBtn.addEventListener('click', () => this.confirmDelete(hook.slug));
	}

	// ── Form body ────────────────────────────────────────────────────────────

	protected renderFormBody(formEl: HTMLElement, _isEdit: boolean): void {
		// Trigger
		new Setting(formEl)
			.setName('Trigger')
			.setDesc('The vault event that fires this hook.')
			.addDropdown((dd) => {
				for (const opt of TRIGGER_OPTIONS) dd.addOption(opt.value, opt.label);
				dd.setValue(this.form.trigger).onChange((v) => {
					this.form.trigger = v as HookTrigger;
				});
			});

		// Action — what to do when the hook fires. Drives which other inputs
		// are visible (tools/prompt for agent-task and rewrite, commandId for
		// command, none for summarize).
		new Setting(formEl)
			.setName('Action')
			.setDesc('What this hook does on each fire.')
			.addDropdown((dd) => {
				for (const opt of ACTION_OPTIONS) dd.addOption(opt.value, opt.label);
				dd.setValue(this.form.action).onChange((v) => {
					this.form.action = v as HookAction;
					updateActionVisibility();
				});
			});

		// Path glob
		new Setting(formEl)
			.setName('Path glob (optional)')
			.setDesc(
				'Limit fires to paths matching this glob. Examples: Daily/**/*.md, Notes/*.md. Leave blank for any path.'
			)
			.addText((text) =>
				text
					.setPlaceholder('Daily/**/*.md')
					.setValue(this.form.pathGlob)
					.onChange((v) => {
						this.form.pathGlob = v.trim();
					})
			);

		// Command id — only shown when action=command.
		const commandIdSetting = new Setting(formEl)
			.setName('Command id')
			.setDesc(
				'Command palette id to fire. Examples: editor:save-file, gemini-scribe-summarize-active-file. View Command IDs via Settings → Hotkeys (open the developer console with Ctrl+Shift+I to inspect ids).'
			)
			.addText((text) =>
				text
					.setPlaceholder('plugin-id:command-name')
					.setValue(this.form.commandId)
					.onChange((v) => {
						this.form.commandId = v.trim();
					})
			);
		const commandIdEl = commandIdSetting.settingEl;

		// Focus file — only shown when action=command. Editor-scoped commands
		// run against the active workspace state; this toggle lets the hook
		// open the trigger file before dispatching so commands like
		// `editor:save-file` target the right note.
		const focusFileSetting = new Setting(formEl)
			.setName('Focus trigger file before dispatch')
			.setDesc(
				'When on, the triggering file is opened in the workspace before the command runs — useful for editor-scoped commands. When off, the command runs against whatever file is currently active. Default off.'
			)
			.addToggle((toggle) =>
				toggle.setValue(this.form.focusFile).onChange((v) => {
					this.form.focusFile = v;
				})
			);
		const focusFileEl = focusFileSetting.settingEl;

		// Tool access — only meaningful for the agent-task action. Uses the
		// shared ToolPolicyEditor, replacing the old category checkbox row
		// whose hardcoded string list didn't match real ToolCategory values.
		const toolsContainer = formEl.createDiv({ cls: 'gemini-scheduler-tools' });
		this.disposeToolPolicyEditor();
		this.toolPolicyEditor = new ToolPolicyEditor(this.plugin, toolsContainer, {
			title: 'Tool access',
			description: 'When inherited, this hook uses the plugin\u2019s global tool policy.',
			value: this.form.toolPolicy,
			onChange: (next) => {
				this.form.toolPolicy = next;
			},
		});
		// Container reference for action-visibility toggle below.
		const toolsSetting = { settingEl: toolsContainer } as { settingEl: HTMLElement };

		// Prompt — required for agent-task and rewrite, ignored for the rest.
		const promptSetting = new Setting(formEl)
			.setName('Prompt')
			.setDesc(
				'Instruction sent to the AI on each fire. Available variables: {{filePath}}, {{fileName}}, {{trigger}}, {{oldPath}}.'
			);
		const promptArea = formEl.createEl('textarea', {
			cls: 'gemini-scheduler-prompt',
			attr: { rows: '8', placeholder: 'e.g. Summarise the changes in {{filePath}}.' },
		});
		promptArea.value = this.form.prompt;
		promptArea.addEventListener('input', () => {
			this.form.prompt = promptArea.value;
		});

		const updateActionVisibility = () => {
			const action = this.form.action;
			const showCommandId = action === 'command';
			const showTools = action === 'agent-task';
			const showPrompt = action === 'agent-task' || action === 'rewrite';

			commandIdEl.style.display = showCommandId ? '' : 'none';
			focusFileEl.style.display = showCommandId ? '' : 'none';
			toolsSetting.settingEl.style.display = showTools ? '' : 'none';
			toolsContainer.style.display = showTools ? '' : 'none';
			promptSetting.settingEl.style.display = showPrompt ? '' : 'none';
			promptArea.style.display = showPrompt ? '' : 'none';
		};
		updateActionVisibility();

		// Advanced
		const advDetails = formEl.createEl('details', { cls: 'gemini-scheduler-advanced' });
		advDetails.createEl('summary', { text: 'Advanced options' });

		new Setting(advDetails)
			.setName('Debounce (ms)')
			.setDesc(`Coalesce rapid events for the same file. Default ${DEFAULT_DEBOUNCE_MS}.`)
			.addText((text) =>
				text
					.setValue(String(this.form.debounceMs))
					.setPlaceholder(String(DEFAULT_DEBOUNCE_MS))
					.onChange((v) => {
						const n = parseInt(v, 10);
						this.form.debounceMs = Number.isFinite(n) && n >= 0 ? n : DEFAULT_DEBOUNCE_MS;
					})
			);

		new Setting(advDetails)
			.setName('Cooldown (ms)')
			.setDesc(
				`After a fire completes, suppress further events on the same (hook, file) for this window. Default ${DEFAULT_COOLDOWN_MS}.`
			)
			.addText((text) =>
				text
					.setValue(String(this.form.cooldownMs))
					.setPlaceholder(String(DEFAULT_COOLDOWN_MS))
					.onChange((v) => {
						const n = parseInt(v, 10);
						this.form.cooldownMs = Number.isFinite(n) && n >= 0 ? n : DEFAULT_COOLDOWN_MS;
					})
			);

		new Setting(advDetails)
			.setName('Max runs per hour')
			.setDesc('Sliding-window cap across all files. 0 (default) means unlimited.')
			.addText((text) =>
				text
					.setValue(String(this.form.maxRunsPerHour))
					.setPlaceholder('0')
					.onChange((v) => {
						const n = parseInt(v, 10);
						this.form.maxRunsPerHour = Number.isFinite(n) && n >= 0 ? n : 0;
					})
			);

		new Setting(advDetails)
			.setName('Skills (comma-separated)')
			.setDesc('Slugs of skills to pre-activate. Empty = inherit all available skills.')
			.addText((text) =>
				text
					.setPlaceholder('summarise, index-files')
					.setValue(this.form.enabledSkills.join(', '))
					.onChange((v) => {
						this.form.enabledSkills = v
							.split(',')
							.map((s) => s.trim())
							.filter((s) => s.length > 0);
					})
			);

		new Setting(advDetails)
			.setName('Model override')
			.setDesc('Override the plugin chat model for this hook. Leave blank to use the default.')
			.addText((text) =>
				text
					.setPlaceholder('gemini-2.5-flash-lite')
					.setValue(this.form.model)
					.onChange((v) => {
						this.form.model = v.trim();
					})
			);

		new Setting(advDetails)
			.setName('Output path (optional)')
			.setDesc(
				'Where to write the agent response. Supports {slug}, {date}, {fileName}. Leave blank to skip writing a file.'
			)
			.addText((text) =>
				text
					.setPlaceholder('Hooks/Runs/{slug}/{date}.md')
					.setValue(this.form.outputPath)
					.onChange((v) => {
						this.form.outputPath = v.trim();
					})
			);

		new Setting(advDetails)
			.setName('Desktop only')
			.setDesc('Skip this hook on mobile platforms. Headless agent runs can be heavy on phones.')
			.addToggle((toggle) =>
				toggle.setValue(this.form.desktopOnly).onChange((v) => {
					this.form.desktopOnly = v;
				})
			);

		new Setting(advDetails)
			.setName('Enabled')
			.setDesc('Disable to pause the hook without deleting it.')
			.addToggle((toggle) =>
				toggle.setValue(this.form.enabled).onChange((v) => {
					this.form.enabled = v;
				})
			);
	}

	// ── CRUD ─────────────────────────────────────────────────────────────────

	protected async deleteEntity(slug: string): Promise<void> {
		await this.plugin.hookManager?.deleteHook(slug);
	}

	protected async handleSave(isEdit: boolean): Promise<void> {
		const action = this.form.action;
		const promptRequired = action === 'agent-task' || action === 'rewrite';

		if (promptRequired && !this.form.prompt.trim()) {
			new Notice('Prompt cannot be empty for this action.');
			return;
		}
		if (action === 'command' && !this.form.commandId.trim()) {
			new Notice('Command id cannot be empty for the "command" action.');
			return;
		}
		if (!isEdit && !this.form.slug.trim()) {
			new Notice('Hook name cannot be empty.');
			return;
		}

		const manager = this.plugin.hookManager;
		if (!manager) {
			new Notice('Hook manager not available.');
			return;
		}

		try {
			if (isEdit && this.editingSlug) {
				await manager.updateHook(this.editingSlug, {
					trigger: this.form.trigger,
					action,
					pathGlob: this.form.pathGlob || undefined,
					debounceMs: this.form.debounceMs,
					cooldownMs: this.form.cooldownMs,
					maxRunsPerHour: this.form.maxRunsPerHour > 0 ? this.form.maxRunsPerHour : undefined,
					toolPolicy: this.form.toolPolicy,
					enabledSkills: this.form.enabledSkills,
					model: this.form.model || undefined,
					outputPath: this.form.outputPath || undefined,
					enabled: this.form.enabled,
					desktopOnly: this.form.desktopOnly,
					prompt: this.form.prompt,
					commandId: this.form.commandId || undefined,
					focusFile: this.form.focusFile === true ? true : undefined,
				});
				new Notice(`Hook "${this.editingSlug}" updated`);
			} else {
				await manager.createHook({
					slug: this.form.slug,
					trigger: this.form.trigger,
					action,
					prompt: this.form.prompt,
					pathGlob: this.form.pathGlob || undefined,
					debounceMs: this.form.debounceMs,
					cooldownMs: this.form.cooldownMs,
					maxRunsPerHour: this.form.maxRunsPerHour > 0 ? this.form.maxRunsPerHour : undefined,
					toolPolicy: this.form.toolPolicy,
					enabledSkills: this.form.enabledSkills,
					model: this.form.model || undefined,
					outputPath: this.form.outputPath || undefined,
					enabled: this.form.enabled,
					desktopOnly: this.form.desktopOnly,
					commandId: this.form.commandId || undefined,
					focusFile: this.form.focusFile === true ? true : undefined,
				});
				new Notice(`Hook "${this.form.slug}" created`);
			}
			this.view = 'list';
			this.render();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this.plugin.logger.error('[HookManagementModal] Save failed:', err);
			new Notice(`Failed to save hook: ${msg}`);
		}
	}

	// ── Form state ───────────────────────────────────────────────────────────

	protected resetForm(): void {
		this.form = this.blankForm();
	}

	protected populateFormForEdit(hook: Hook): void {
		this.form = {
			slug: hook.slug,
			trigger: hook.trigger,
			action: hook.action,
			pathGlob: hook.pathGlob ?? '',
			debounceMs: hook.debounceMs,
			cooldownMs: hook.cooldownMs,
			maxRunsPerHour: hook.maxRunsPerHour ?? 0,
			toolPolicy: hook.toolPolicy,
			enabledSkills: [...hook.enabledSkills],
			model: hook.model ?? '',
			outputPath: hook.outputPath ?? '',
			enabled: hook.enabled,
			desktopOnly: hook.desktopOnly,
			prompt: hook.prompt,
			commandId: hook.commandId ?? '',
			focusFile: hook.focusFile === true,
		};
	}

	protected getFormSlug(): string {
		return this.form.slug;
	}

	protected setFormSlug(slug: string): void {
		this.form.slug = slug;
	}

	private blankForm() {
		return {
			slug: '',
			trigger: 'file-modified' as HookTrigger,
			action: 'agent-task' as HookAction,
			pathGlob: '',
			debounceMs: DEFAULT_DEBOUNCE_MS,
			cooldownMs: DEFAULT_COOLDOWN_MS,
			maxRunsPerHour: 0,
			toolPolicy: undefined as FeatureToolPolicy | undefined,
			enabledSkills: [] as string[],
			model: '',
			outputPath: '',
			enabled: true,
			desktopOnly: true,
			prompt: '',
			commandId: '',
			focusFile: false,
		};
	}
}
