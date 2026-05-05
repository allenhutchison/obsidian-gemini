import { App, Modal, Notice, Setting, setIcon } from 'obsidian';
import type ObsidianGemini from '../main';
import type { Hook, HookAction, HookState, HookTrigger } from '../services/hook-manager';

type View = 'list' | 'create' | 'edit';

const TOOL_CATEGORIES = ['read_only', 'read_write', 'destructive'] as const;

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
 * Full CRUD management modal for lifecycle hooks. Visually mirrors
 * SchedulerManagementModal so the two automation surfaces feel like one
 * design family — same row layout, same actions, same form patterns.
 *
 * Views:
 *   list   — every hook with toggle / reset / edit / delete
 *   create — empty form
 *   edit   — form pre-filled with an existing hook's values
 *
 * Frontmatter filters can be authored in the YAML directly; the form keeps
 * the advanced section minimal to avoid a complex key/value editor in v1.
 */
export class HookManagementModal extends Modal {
	private view: View;
	private editingSlug: string | null = null;
	private eventUnsubscribers: Array<() => void> = [];
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
		this.subscribeToBackgroundEvents();
	}

	onClose(): void {
		this.eventUnsubscribers.forEach((fn) => fn());
		this.eventUnsubscribers = [];
		this.contentEl.empty();
	}

	/**
	 * Re-render the list when a hook fire finishes so last-error / last-run
	 * info appears immediately without manual refresh.
	 */
	private subscribeToBackgroundEvents(): void {
		const bus = this.plugin.agentEventBus;
		if (!bus) return;
		const refresh = async () => {
			if (this.view === 'list') this.render();
		};
		this.eventUnsubscribers.push(bus.on('backgroundTaskComplete', refresh), bus.on('backgroundTaskFailed', refresh));
	}

	// ── Render dispatcher ────────────────────────────────────────────────────

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		// Reuse the scheduler modal's CSS class so the two share a visual
		// design language without a parallel CSS file. `gemini-hook-modal`
		// is the per-feature hook so theme overrides can target hooks
		// specifically when they need to.
		contentEl.addClass('gemini-scheduler-modal', 'gemini-hook-modal');

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

	// ── List view ────────────────────────────────────────────────────────────

	private renderList(): void {
		const { contentEl } = this;

		const header = contentEl.createDiv({ cls: 'gemini-scheduler-header' });
		header.createEl('h2', { text: 'Lifecycle Hooks' });

		const newBtn = header.createEl('button', {
			text: 'New hook',
			cls: 'mod-cta gemini-scheduler-new-btn',
			attr: { type: 'button' },
		});
		setIcon(newBtn.createSpan({ cls: 'gemini-scheduler-btn-icon' }), 'plus');
		newBtn.addEventListener('click', () => this.openCreate());

		const manager = this.plugin.hookManager;
		if (!manager) {
			contentEl.createEl('p', { text: 'Hook manager not available.' });
			return;
		}

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

		const hooks = manager.getHooks();
		const state = manager.getStateSnapshot();

		if (hooks.length === 0) {
			const empty = contentEl.createDiv({ cls: 'gemini-scheduler-empty' });
			const iconEl = empty.createDiv({ cls: 'gemini-scheduler-empty-icon' });
			setIcon(iconEl, 'webhook');
			empty.createEl('p', { text: 'No hooks yet.' });
			empty.createEl('p', {
				text: 'Hooks run an AI agent in response to vault events — file saves, creates, deletes, renames. Create your first hook to summarise on save, index new attachments, or run a skill on certain notes.',
				cls: 'gemini-scheduler-empty-hint',
			});
			return;
		}

		const list = contentEl.createEl('ul', { cls: 'gemini-scheduler-list' });
		for (const hook of hooks) {
			this.renderHookRow(list, hook, state[hook.slug]);
		}
	}

	private renderHookRow(container: HTMLElement, hook: Hook, hookState: HookState | undefined): void {
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

	private confirmDelete(slug: string): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Delete Hook' });
		contentEl.createEl('p', { text: `Delete "${slug}"? This removes the hook definition file permanently.` });
		contentEl.createEl('p', {
			text: 'Output files in Hooks/Runs/ are not deleted.',
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
				await this.plugin.hookManager?.deleteHook(slug);
				new Notice(`Hook "${slug}" deleted`);
				this.render();
			} catch (err) {
				this.plugin.logger.error(`[HookManagementModal] Delete failed for "${slug}":`, err);
				new Notice(`Failed to delete "${slug}"`);
				this.render();
			}
		});
	}

	// ── Form view ────────────────────────────────────────────────────────────

	private openCreate(): void {
		this.view = 'create';
		this.editingSlug = null;
		this.form = this.blankForm();
		this.render();
	}

	private openEdit(hook: Hook): void {
		this.view = 'edit';
		this.editingSlug = hook.slug;
		this.form = {
			slug: hook.slug,
			trigger: hook.trigger,
			action: hook.action,
			pathGlob: hook.pathGlob ?? '',
			debounceMs: hook.debounceMs,
			cooldownMs: hook.cooldownMs,
			maxRunsPerHour: hook.maxRunsPerHour ?? 0,
			enabledTools: [...hook.enabledTools],
			enabledSkills: [...hook.enabledSkills],
			model: hook.model ?? '',
			outputPath: hook.outputPath ?? '',
			enabled: hook.enabled,
			desktopOnly: hook.desktopOnly,
			prompt: hook.prompt,
			commandId: hook.commandId ?? '',
			focusFile: hook.focusFile === true,
		};
		this.render();
	}

	private renderForm(isEdit: boolean): void {
		const { contentEl } = this;

		const back = contentEl.createEl('button', {
			text: '← Back to list',
			cls: 'gemini-scheduler-back',
			attr: { type: 'button' },
		});
		back.addEventListener('click', () => {
			this.view = 'list';
			this.render();
		});

		contentEl.createEl('h2', { text: isEdit ? `Edit hook: ${this.editingSlug}` : 'New hook' });

		const form = contentEl.createEl('form', { cls: 'gemini-scheduler-form' });
		form.addEventListener('submit', (e) => e.preventDefault());

		// Slug (create only)
		if (!isEdit) {
			new Setting(form)
				.setName('Hook name (slug)')
				.setDesc('Lowercase identifier used as the filename and in output paths. Cannot be changed after creation.')
				.addText((text) =>
					text
						.setPlaceholder('e.g. summarise-on-save')
						.setValue(this.form.slug)
						.onChange((v) => {
							this.form.slug = v.toLowerCase().replace(/[^a-z0-9-]/g, '-');
							text.setValue(this.form.slug);
						})
				);
		}

		// Trigger
		new Setting(form)
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
		new Setting(form)
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
		new Setting(form)
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
		const commandIdSetting = new Setting(form)
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
		const focusFileSetting = new Setting(form)
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

		// Tool access — only meaningful for the agent-task action.
		const toolsSetting = new Setting(form).setName('Tool access').setDesc('Which tool categories the agent may use.');
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

		// Prompt — required for agent-task and rewrite, ignored for the rest.
		const promptSetting = new Setting(form)
			.setName('Prompt')
			.setDesc(
				'Instruction sent to the AI on each fire. Available variables: {{filePath}}, {{fileName}}, {{trigger}}, {{oldPath}}.'
			);
		const promptArea = form.createEl('textarea', {
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
		const advDetails = form.createEl('details', { cls: 'gemini-scheduler-advanced' });
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

		// Footer
		const footer = form.createDiv({ cls: 'gemini-scheduler-footer' });

		const saveBtn = footer.createEl('button', {
			text: isEdit ? 'Save changes' : 'Create hook',
			cls: 'mod-cta',
			attr: { type: 'button' },
		});
		saveBtn.addEventListener('click', () => this.handleSave(isEdit));

		const cancelBtn = footer.createEl('button', { text: 'Cancel', attr: { type: 'button' } });
		cancelBtn.addEventListener('click', () => {
			this.view = 'list';
			this.render();
		});
	}

	private async handleSave(isEdit: boolean): Promise<void> {
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
					enabledTools: this.form.enabledTools,
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
					enabledTools: this.form.enabledTools,
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

	// ── Helpers ──────────────────────────────────────────────────────────────

	private blankForm() {
		return {
			slug: '',
			trigger: 'file-modified' as HookTrigger,
			action: 'agent-task' as HookAction,
			pathGlob: '',
			debounceMs: DEFAULT_DEBOUNCE_MS,
			cooldownMs: DEFAULT_COOLDOWN_MS,
			maxRunsPerHour: 0,
			enabledTools: ['read_only'] as string[],
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

	private formatDate(d: Date): string {
		// Same shape SchedulerManagementModal uses — locale-aware short form.
		return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
	}

	private truncateError(msg: string): string {
		return msg.length > 80 ? `${msg.slice(0, 77)}…` : msg;
	}
}
