import { Notice, Setting, setIcon } from 'obsidian';
import type { Hook, HookAction, HookState, HookTrigger, HooksState } from '../services/hook-manager';
import type { FeatureToolPolicy } from '../types/tool-policy';
import { DEFAULT_HEADLESS_MAX_ITERATIONS } from '../agent/agent-loop';
import { ManagementModalBase } from './components/management-modal-base';
import { ToolPolicyEditor } from './components/tool-policy-editor';
import { getRawErrorMessage } from '../utils/error-utils';
import { t } from '../i18n';

const TRIGGER_OPTIONS = [
	{ value: 'file-modified', labelKey: 'hooks.triggerFileModified' },
	{ value: 'file-created', labelKey: 'hooks.triggerFileCreated' },
	{ value: 'file-deleted', labelKey: 'hooks.triggerFileDeleted' },
	{ value: 'file-renamed', labelKey: 'hooks.triggerFileRenamed' },
] as const;

const ACTION_OPTIONS = [
	{ value: 'agent-task', labelKey: 'hooks.actionAgentTask' },
	{ value: 'summarize', labelKey: 'hooks.actionSummarize' },
	{ value: 'rewrite', labelKey: 'hooks.actionRewrite' },
	{ value: 'command', labelKey: 'hooks.actionCommand' },
] as const;

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

	protected readonly entityLabel = t('hooks.entityLabel');
	protected readonly entityLabelPlural = t('hooks.entityLabelPlural');
	protected readonly entityIcon = 'webhook';
	protected readonly newButtonText = t('hooks.newHookButton');
	protected readonly emptyText = t('hooks.emptyText');
	protected readonly emptyHint = t('hooks.emptyHint');
	protected readonly deleteTitle = t('hooks.deleteTitle');
	protected readonly deleteHint = t('hooks.deleteHint');
	protected readonly slugPlaceholder = t('hooks.slugPlaceholder');

	protected getCssClasses(): string[] {
		// Reuse the scheduler modal's CSS class so the two share a visual
		// design language without a parallel CSS file. `gemini-hook-modal`
		// is the per-feature hook so theme overrides can target hooks
		// specifically when they need to.
		return ['gemini-scheduler-modal', 'gemini-hook-modal'];
	}

	protected getFormTitle(isEdit: boolean): string {
		return isEdit ? t('hooks.formTitleEdit', { slug: this.editingSlug ?? '' }) : t('hooks.formTitleNew');
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
			banner.createEl('p', { text: t('hooks.disabledBannerTitle') });
			banner.createEl('p', {
				text: t('hooks.disabledBannerHint'),
				cls: 'gemini-scheduler-empty-hint',
			});
		}
	}

	// ── Row rendering ────────────────────────────────────────────────────────

	protected renderEntityRow(container: HTMLElement, hook: Hook, hookState: HookState | undefined): void {
		const isPaused = hookState?.pausedDueToErrors === true;
		const isDisabled = !hook.enabled;

		const { li } = this.renderEntityRowShell(container, { isPaused, isDisabled, activeIcon: 'webhook' });

		const info = li.createDiv({ cls: 'gemini-scheduler-item-info' });
		info.createDiv({ text: hook.slug, cls: 'gemini-scheduler-item-slug' });

		const triggerKey = TRIGGER_OPTIONS.find((o) => o.value === hook.trigger)?.labelKey;
		const actionKey = ACTION_OPTIONS.find((o) => o.value === hook.action)?.labelKey;
		const triggerLabel = triggerKey ? t(triggerKey) : hook.trigger;
		const actionLabel = actionKey ? t(actionKey) : hook.action;
		const baseBadge = `${triggerLabel} → ${actionLabel}`;
		const badge = isDisabled
			? t('hooks.badgeDisabled', { badge: baseBadge })
			: isPaused
				? t('hooks.badgePaused', { badge: baseBadge })
				: baseBadge;
		info.createSpan({ text: badge, cls: 'gemini-scheduler-item-badge' });

		if (hook.pathGlob) {
			info.createDiv({ text: t('hooks.globMeta', { glob: hook.pathGlob }), cls: 'gemini-scheduler-item-meta' });
		}

		const lastFires = hookState?.recentFires ?? [];
		if (lastFires.length > 0) {
			const lastFire = new Date(lastFires[lastFires.length - 1]);
			info.createDiv({
				text: t('hooks.lastFired', { time: this.formatDate(lastFire) }),
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
			text: isDisabled ? t('hooks.enableButton') : t('hooks.disableButton'),
			cls: 'gemini-scheduler-action',
			attr: { type: 'button' },
		});
		toggleBtn.addEventListener('click', () => {
			void (async () => {
				toggleBtn.disabled = true;
				toggleBtn.setText('…');
				try {
					await this.plugin.hookManager?.toggleHook(hook.slug, !hook.enabled);
					this.render();
				} catch (err) {
					this.plugin.logger.error(`[HookManagementModal] Toggle failed for "${hook.slug}":`, err);
					new Notice(t('hooks.toggleFailed', { slug: hook.slug }));
					toggleBtn.setText(isDisabled ? t('hooks.enableButton') : t('hooks.disableButton'));
					toggleBtn.disabled = false;
				}
			})();
		});

		if (isPaused) {
			const resetBtn = actions.createEl('button', {
				text: t('hooks.resetButton'),
				cls: 'gemini-scheduler-action',
				attr: { type: 'button', title: t('hooks.resetTooltip') },
			});
			resetBtn.addEventListener('click', () => {
				void (async () => {
					resetBtn.disabled = true;
					try {
						await this.plugin.hookManager?.resetHook(hook.slug);
						this.render();
					} catch (err) {
						// On success render() rebuilds the row; on failure restore the
						// button so it can't stay stuck disabled (mirrors the toggle handler above).
						this.plugin.logger.error(`[HookManagementModal] resetHook failed for "${hook.slug}":`, err);
						resetBtn.disabled = false;
					}
				})();
			});
		}

		const editBtn = actions.createEl('button', {
			text: t('hooks.editButton'),
			cls: 'gemini-scheduler-action',
			attr: { type: 'button' },
		});
		editBtn.addEventListener('click', () => this.openEdit(hook));

		const deleteBtn = actions.createEl('button', {
			text: t('hooks.deleteButton'),
			cls: 'gemini-scheduler-action gemini-scheduler-action--delete',
			attr: { type: 'button' },
		});
		deleteBtn.addEventListener('click', () => this.confirmDelete(hook.slug));
	}

	// ── Form body ────────────────────────────────────────────────────────────

	protected renderFormBody(formEl: HTMLElement, _isEdit: boolean): void {
		// Trigger
		new Setting(formEl)
			.setName(t('hooks.triggerSetting'))
			.setDesc(t('hooks.triggerDesc'))
			.addDropdown((dd) => {
				for (const opt of TRIGGER_OPTIONS) dd.addOption(opt.value, t(opt.labelKey));
				dd.setValue(this.form.trigger).onChange((v) => {
					this.form.trigger = v as HookTrigger;
				});
			});

		// Action — what to do when the hook fires. Drives which other inputs
		// are visible (tools/prompt for agent-task and rewrite, commandId for
		// command, none for summarize).
		new Setting(formEl)
			.setName(t('hooks.actionSetting'))
			.setDesc(t('hooks.actionDesc'))
			.addDropdown((dd) => {
				for (const opt of ACTION_OPTIONS) dd.addOption(opt.value, t(opt.labelKey));
				dd.setValue(this.form.action).onChange((v) => {
					this.form.action = v as HookAction;
					updateActionVisibility();
				});
			});

		// Path glob
		new Setting(formEl)
			.setName(t('hooks.pathGlobSetting'))
			.setDesc(t('hooks.pathGlobDesc'))
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
			.setName(t('hooks.commandIdSetting'))
			.setDesc(t('hooks.commandIdDesc'))
			.addText((text) =>
				text
					// eslint-disable-next-line obsidianmd/ui/sentence-case -- literal command-id format hint, shown verbatim
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
			.setName(t('hooks.focusFileSetting'))
			.setDesc(t('hooks.focusFileDesc'))
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
			title: t('hooks.toolAccessTitle'),
			description: t('hooks.toolAccessDesc'),
			value: this.form.toolPolicy,
			onChange: (next) => {
				this.form.toolPolicy = next;
			},
		});
		// Container reference for action-visibility toggle below.
		const toolsSetting = { settingEl: toolsContainer } as { settingEl: HTMLElement };

		// Prompt — required for agent-task and rewrite, ignored for the rest.
		const promptSetting = new Setting(formEl).setName(t('hooks.promptSetting')).setDesc(t('hooks.promptDesc'));
		const promptArea = formEl.createEl('textarea', {
			cls: 'gemini-scheduler-prompt',
			attr: { rows: '8', placeholder: t('hooks.promptPlaceholder') },
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
		advDetails.createEl('summary', { text: t('hooks.advancedOptions') });

		new Setting(advDetails)
			.setName(t('hooks.debounceSetting'))
			.setDesc(t('hooks.debounceDesc', { default: DEFAULT_DEBOUNCE_MS }))
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
			.setName(t('hooks.cooldownSetting'))
			.setDesc(t('hooks.cooldownDesc', { default: DEFAULT_COOLDOWN_MS }))
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
			.setName(t('hooks.maxRunsSetting'))
			.setDesc(t('hooks.maxRunsDesc'))
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
			.setName(t('hooks.skillsSetting'))
			.setDesc(t('hooks.skillsDesc'))
			.addText((text) =>
				text
					// eslint-disable-next-line obsidianmd/ui/sentence-case -- example skill names (lowercase), shown verbatim
					.setPlaceholder('summarize, index-files')
					.setValue(this.form.enabledSkills.join(', '))
					.onChange((v) => {
						this.form.enabledSkills = v
							.split(',')
							.map((s) => s.trim())
							.filter((s) => s.length > 0);
					})
			);

		new Setting(advDetails)
			.setName(t('hooks.modelOverrideSetting'))
			.setDesc(t('hooks.modelOverrideDesc'))
			.addText((text) =>
				text
					// eslint-disable-next-line obsidianmd/ui/sentence-case -- example model id, shown verbatim
					.setPlaceholder('gemini-2.5-flash-lite')
					.setValue(this.form.model)
					.onChange((v) => {
						this.form.model = v.trim();
					})
			);

		new Setting(advDetails)
			.setName(t('hooks.maxIterationsSetting'))
			.setDesc(t('hooks.maxIterationsDesc', { default: DEFAULT_HEADLESS_MAX_ITERATIONS }))
			.addText((text) =>
				text
					.setPlaceholder(String(DEFAULT_HEADLESS_MAX_ITERATIONS))
					.setValue(this.form.maxIterations)
					.onChange((v) => {
						this.form.maxIterations = v.trim();
					})
			);

		new Setting(advDetails)
			.setName(t('hooks.outputPathSetting'))
			.setDesc(t('hooks.outputPathDesc'))
			.addText((text) =>
				text
					.setPlaceholder('Hooks/Runs/{slug}/{date}.md')
					.setValue(this.form.outputPath)
					.onChange((v) => {
						this.form.outputPath = v.trim();
					})
			);

		new Setting(advDetails)
			.setName(t('hooks.desktopOnlySetting'))
			.setDesc(t('hooks.desktopOnlyDesc'))
			.addToggle((toggle) =>
				toggle.setValue(this.form.desktopOnly).onChange((v) => {
					this.form.desktopOnly = v;
				})
			);

		new Setting(advDetails)
			.setName(t('hooks.enabledSetting'))
			.setDesc(t('hooks.enabledDesc'))
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
			new Notice(t('hooks.emptyPrompt'));
			return;
		}
		if (action === 'command' && !this.form.commandId.trim()) {
			new Notice(t('hooks.emptyCommandId'));
			return;
		}
		if (!isEdit && !this.form.slug.trim()) {
			new Notice(t('hooks.emptySlug'));
			return;
		}

		// Blank means "use the default" (undefined). A non-blank value must be a
		// positive integer — reject garbage rather than silently dropping it.
		let maxIterations: number | undefined;
		const rawMaxIterations = this.form.maxIterations.trim();
		if (rawMaxIterations) {
			const parsed = Number(rawMaxIterations);
			if (!Number.isInteger(parsed) || parsed <= 0) {
				new Notice(t('hooks.invalidMaxIterations'));
				return;
			}
			maxIterations = parsed;
		}

		const manager = this.plugin.hookManager;
		if (!manager) {
			new Notice(t('hooks.managerUnavailable'));
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
					maxIterations,
					outputPath: this.form.outputPath || undefined,
					enabled: this.form.enabled,
					desktopOnly: this.form.desktopOnly,
					prompt: this.form.prompt,
					commandId: this.form.commandId || undefined,
					focusFile: this.form.focusFile === true ? true : undefined,
				});
				new Notice(t('hooks.hookUpdated', { slug: this.editingSlug }));
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
					maxIterations,
					outputPath: this.form.outputPath || undefined,
					enabled: this.form.enabled,
					desktopOnly: this.form.desktopOnly,
					commandId: this.form.commandId || undefined,
					focusFile: this.form.focusFile === true ? true : undefined,
				});
				new Notice(t('hooks.hookCreated', { slug: this.form.slug }));
			}
			this.view = 'list';
			this.render();
		} catch (err) {
			const msg = getRawErrorMessage(err);
			this.plugin.logger.error('[HookManagementModal] Save failed:', err);
			new Notice(t('hooks.saveFailed', { message: msg }));
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
			maxIterations: hook.maxIterations !== undefined ? String(hook.maxIterations) : '',
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
			maxIterations: '',
			outputPath: '',
			enabled: true,
			desktopOnly: true,
			prompt: '',
			commandId: '',
			focusFile: false,
		};
	}
}
