import { App, Modal, Notice, Setting, setIcon } from 'obsidian';
import type ObsidianGemini from '../../main';
import { ToolPolicyEditor } from './tool-policy-editor';

/**
 * View state for management modals: list all entities, create a new one,
 * or edit an existing one.
 */
export type ManagementView = 'list' | 'create' | 'edit';

/**
 * Abstract base class for automation management modals (hooks, scheduled
 * tasks, and any future automation surface). Owns the shared scaffolding:
 *
 *   - View state machine (`list | create | edit`)
 *   - onOpen / onClose lifecycle with event-bus subscriptions
 *   - ToolPolicyEditor lifetime management
 *   - List view skeleton (header, empty state, entity iteration)
 *   - Delete confirmation dialog
 *   - Form skeleton (back button, heading, slug field, footer)
 *   - Shared helpers (formatDate, truncateError)
 *
 * Subclasses implement the entity-specific bits: row rendering, form body,
 * CRUD operations, and form state shape.
 */
export abstract class ManagementModalBase<TEntity, TEntityState> extends Modal {
	protected view: ManagementView;
	protected editingSlug: string | null = null;
	protected eventUnsubscribers: Array<() => void> = [];
	protected toolPolicyEditor: ToolPolicyEditor | null = null;

	constructor(
		app: App,
		protected plugin: ObsidianGemini,
		initialView: ManagementView = 'list'
	) {
		super(app);
		this.view = initialView;
	}

	// ── Lifecycle ────────────────────────────────────────────────────────────

	onOpen(): void {
		this.render();
		this.subscribeToBackgroundEvents();
	}

	onClose(): void {
		this.eventUnsubscribers.forEach((fn) => fn());
		this.eventUnsubscribers = [];
		this.disposeToolPolicyEditor();
		this.contentEl.empty();
	}

	protected disposeToolPolicyEditor(): void {
		if (this.toolPolicyEditor) {
			this.toolPolicyEditor.destroy();
			this.toolPolicyEditor = null;
		}
	}

	/**
	 * Re-render the list when a background task finishes so last-error /
	 * last-run info appears immediately without manual refresh.
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

	protected render(): void {
		const { contentEl } = this;
		contentEl.empty();
		for (const cls of this.getCssClasses()) {
			contentEl.addClass(cls);
		}

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
		header.createEl('h2', { text: this.entityLabelPlural });

		const newBtn = header.createEl('button', {
			text: this.newButtonText,
			cls: 'mod-cta gemini-scheduler-new-btn',
			attr: { type: 'button' },
		});
		setIcon(newBtn.createSpan({ cls: 'gemini-scheduler-btn-icon' }), 'plus');
		newBtn.addEventListener('click', () => this.openCreate());

		const manager = this.getManager();
		if (!manager) {
			contentEl.createEl('p', { text: `${this.entityLabel} manager not available.` });
			return;
		}

		// Optional preamble — e.g. the "hooks disabled" banner.
		this.renderListPreamble(contentEl);

		const entities = this.getEntities();
		const states = this.getEntityStates();

		if (entities.length === 0) {
			const empty = contentEl.createDiv({ cls: 'gemini-scheduler-empty' });
			const iconEl = empty.createDiv({ cls: 'gemini-scheduler-empty-icon' });
			setIcon(iconEl, this.entityIcon);
			empty.createEl('p', { text: this.emptyText });
			empty.createEl('p', {
				text: this.emptyHint,
				cls: 'gemini-scheduler-empty-hint',
			});
			return;
		}

		const list = contentEl.createEl('ul', { cls: 'gemini-scheduler-list' });
		for (const entity of entities) {
			const slug = this.getEntitySlug(entity);
			this.renderEntityRow(list, entity, states[slug]);
		}
	}

	// ── Delete confirmation ──────────────────────────────────────────────────

	protected confirmDelete(slug: string): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: this.deleteTitle });
		contentEl.createEl('p', {
			text: `Delete "${slug}"? This removes the ${this.entityLabel} definition file permanently.`,
		});
		contentEl.createEl('p', {
			text: this.deleteHint,
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
				await this.deleteEntity(slug);
				new Notice(`${this.capitalizedEntityLabel} "${slug}" deleted`);
				this.render();
			} catch (err) {
				this.plugin.logger.error(`[${this.constructor.name}] Delete failed for "${slug}":`, err);
				new Notice(`Failed to delete "${slug}"`);
				this.render();
			}
		});
	}

	// ── Form view ────────────────────────────────────────────────────────────

	protected openCreate(): void {
		this.view = 'create';
		this.editingSlug = null;
		this.resetForm();
		this.render();
	}

	protected openEdit(entity: TEntity): void {
		this.view = 'edit';
		this.editingSlug = this.getEntitySlug(entity);
		this.populateFormForEdit(entity);
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

		contentEl.createEl('h2', { text: this.getFormTitle(isEdit) });

		const form = contentEl.createEl('form', { cls: 'gemini-scheduler-form' });
		form.addEventListener('submit', (e) => e.preventDefault());

		// Slug (create only) — identical across all management modals.
		if (!isEdit) {
			new Setting(form)
				.setName(`${this.capitalizedEntityLabel} name (slug)`)
				.setDesc('Lowercase identifier used as the filename and in output paths. Cannot be changed after creation.')
				.addText((text) =>
					text
						.setPlaceholder(this.slugPlaceholder)
						.setValue(this.getFormSlug())
						.onChange((v) => {
							const normalized = v.toLowerCase().replace(/[^a-z0-9-]/g, '-');
							this.setFormSlug(normalized);
							text.setValue(normalized);
						})
				);
		}

		// Entity-specific form body.
		this.renderFormBody(form, isEdit);

		// Footer — identical across all management modals.
		const footer = form.createDiv({ cls: 'gemini-scheduler-footer' });

		const saveBtn = footer.createEl('button', {
			text: isEdit ? 'Save changes' : `Create ${this.entityLabel}`,
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

	// ── Shared helpers ───────────────────────────────────────────────────────

	protected formatDate(date: Date): string {
		return date.toLocaleString([], {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		});
	}

	protected truncateError(msg: string): string {
		return msg.length > 80 ? `${msg.slice(0, 77)}…` : msg;
	}

	/** Capitalize the entity label for use in UI strings. */
	protected get capitalizedEntityLabel(): string {
		return this.entityLabel.charAt(0).toUpperCase() + this.entityLabel.slice(1);
	}

	// ── Abstract: configuration ──────────────────────────────────────────────

	/** Singular lowercase label: `'hook'` or `'task'`. */
	protected abstract readonly entityLabel: string;
	/** Plural display title: `'Lifecycle Hooks'` or `'Scheduled Tasks'`. */
	protected abstract readonly entityLabelPlural: string;
	/** Lucide icon name for the empty state: `'webhook'` or `'calendar-clock'`. */
	protected abstract readonly entityIcon: string;
	/** Text for the "New" button: `'New hook'` or `'New task'`. */
	protected abstract readonly newButtonText: string;
	/** Primary text for the empty state. */
	protected abstract readonly emptyText: string;
	/** Secondary hint for the empty state. */
	protected abstract readonly emptyHint: string;
	/** Heading for the delete confirmation dialog. */
	protected abstract readonly deleteTitle: string;
	/** Hint text shown below the delete confirmation. */
	protected abstract readonly deleteHint: string;
	/** Placeholder for the slug input. */
	protected abstract readonly slugPlaceholder: string;

	/** CSS classes to add to the modal content element. */
	protected abstract getCssClasses(): string[];

	/** Title for the create/edit form heading. */
	protected abstract getFormTitle(isEdit: boolean): string;

	// ── Abstract: data access ────────────────────────────────────────────────

	/** Return the entity manager, or null/undefined if unavailable. */
	protected abstract getManager(): unknown | null | undefined;
	/** Return all entities for the list view. */
	protected abstract getEntities(): TEntity[];
	/** Return the state map keyed by slug. */
	protected abstract getEntityStates(): Record<string, TEntityState>;
	/** Extract the slug from an entity. */
	protected abstract getEntitySlug(entity: TEntity): string;

	// ── Abstract: rendering ──────────────────────────────────────────────────

	/**
	 * Optional hook to render content between the header and the entity list
	 * (e.g. the "hooks disabled" banner). Default is a no-op.
	 */
	protected renderListPreamble(_contentEl: HTMLElement): void {
		// No-op by default; subclasses override when needed.
	}

	/** Render a single entity row in the list view. */
	protected abstract renderEntityRow(container: HTMLElement, entity: TEntity, state: TEntityState | undefined): void;

	/** Render the entity-specific form fields between the slug and footer. */
	protected abstract renderFormBody(formEl: HTMLElement, isEdit: boolean): void;

	// ── Abstract: CRUD ───────────────────────────────────────────────────────

	/** Delete an entity by slug. */
	protected abstract deleteEntity(slug: string): Promise<void>;
	/** Validate and save the form (create or update). */
	protected abstract handleSave(isEdit: boolean): Promise<void>;
	/** Reset the form state to blank defaults. */
	protected abstract resetForm(): void;
	/** Populate the form state from an existing entity for editing. */
	protected abstract populateFormForEdit(entity: TEntity): void;
	/** Get the current slug value from the form state. */
	protected abstract getFormSlug(): string;
	/** Set the slug value in the form state. */
	protected abstract setFormSlug(slug: string): void;
}
