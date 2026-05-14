import { ManagementModalBase } from '../../src/ui/components/management-modal-base';

/**
 * Create a mock DOM element with all the Obsidian API surface that
 * ManagementModalBase touches. Recursive — createDiv/createEl return
 * new mock elements.
 */
function createMockElement(): any {
	const el: any = {
		empty: vi.fn(),
		addClass: vi.fn(),
		classList: { add: vi.fn() },
		createEl: vi.fn(() => createMockElement()),
		createDiv: vi.fn(() => createMockElement()),
		createSpan: vi.fn(() => createMockElement()),
		appendChild: vi.fn(),
		appendText: vi.fn(),
		addEventListener: vi.fn(),
		style: {},
		// For Setting's settingEl
		settingEl: undefined as any,
		disabled: false,
		setText: vi.fn(),
		value: '',
	};
	el.settingEl = el;
	return el;
}

vi.mock('obsidian', async () => {
	const original = await vi.importActual<any>('../../__mocks__/obsidian.js');
	// Extend Modal to give contentEl the full API surface we need.
	class Modal extends original.Modal {
		constructor(app: any) {
			super(app);
			this.contentEl = createMockElement();
		}
	}
	// Extend Setting so addText returns a chainable text component that
	// supports setPlaceholder/setValue/onChange in fluent style.
	class Setting extends original.Setting {
		addText(cb: (text: any) => any) {
			const component: any = {
				setValue: vi.fn().mockReturnThis(),
				setPlaceholder: vi.fn().mockReturnThis(),
				onChange: vi.fn().mockReturnThis(),
			};
			cb(component);
			this.components.push(component);
			return this;
		}
	}
	return { ...original, Modal, Setting };
});

// ── Minimal concrete stub ────────────────────────────────────────────────────

interface StubEntity {
	slug: string;
	name: string;
	enabled: boolean;
}
interface StubState {
	lastError?: string;
	pausedDueToErrors?: boolean;
}

const MOCK_ENTITIES: StubEntity[] = [
	{ slug: 'alpha', name: 'Alpha Entity', enabled: true },
	{ slug: 'beta', name: 'Beta Entity', enabled: false },
];
const MOCK_STATES: Record<string, StubState> = {
	alpha: {},
	beta: { lastError: 'Something went wrong', pausedDueToErrors: true },
};

class TestModal extends ManagementModalBase<StubEntity, StubState> {
	// Track calls for assertions
	deleteEntityCalls: string[] = [];
	handleSaveCalls: boolean[] = [];
	resetFormCalls = 0;
	populateCalls: StubEntity[] = [];
	renderEntityRowCalls: Array<{ entity: StubEntity; state: StubState | undefined }> = [];
	renderFormBodyCalls: boolean[] = [];
	preambleCalls = 0;

	protected readonly entityLabel = 'widget';
	protected readonly entityLabelPlural = 'Widgets';
	protected readonly entityIcon = 'box';
	protected readonly newButtonText = 'New widget';
	protected readonly emptyText = 'No widgets yet.';
	protected readonly emptyHint = 'Create your first widget.';
	protected readonly deleteTitle = 'Delete Widget';
	protected readonly deleteHint = 'Widget files are not deleted.';
	protected readonly slugPlaceholder = 'e.g. my-widget';

	protected getCssClasses() {
		return ['test-modal'];
	}
	protected getFormTitle(isEdit: boolean) {
		return isEdit ? `Edit: ${this.editingSlug}` : 'New Widget';
	}

	// Data access — uses the mock arrays directly
	private mockManager: unknown = {};
	protected getManager() {
		return this.mockManager;
	}
	protected getEntities() {
		return MOCK_ENTITIES;
	}
	protected getEntityStates() {
		return MOCK_STATES;
	}
	protected getEntitySlug(entity: StubEntity) {
		return entity.slug;
	}

	// Rendering
	protected renderListPreamble(_contentEl: HTMLElement): void {
		this.preambleCalls++;
	}
	protected renderEntityRow(_container: HTMLElement, entity: StubEntity, state: StubState | undefined): void {
		this.renderEntityRowCalls.push({ entity, state });
	}
	protected renderFormBody(_formEl: HTMLElement, isEdit: boolean): void {
		this.renderFormBodyCalls.push(isEdit);
	}

	// CRUD
	protected async deleteEntity(slug: string): Promise<void> {
		this.deleteEntityCalls.push(slug);
	}
	protected async handleSave(isEdit: boolean): Promise<void> {
		this.handleSaveCalls.push(isEdit);
	}

	private formSlug = '';
	protected resetForm(): void {
		this.resetFormCalls++;
		this.formSlug = '';
	}
	protected populateFormForEdit(entity: StubEntity): void {
		this.populateCalls.push(entity);
		this.formSlug = entity.slug;
	}
	protected getFormSlug(): string {
		return this.formSlug;
	}
	protected setFormSlug(slug: string): void {
		this.formSlug = slug;
	}

	// Expose protected members for testing
	get currentView() {
		return this.view;
	}
	get currentEditingSlug() {
		return this.editingSlug;
	}

	// Allow calling protected methods from tests
	callRender() {
		this.render();
	}
	callOpenCreate() {
		this.openCreate();
	}
	callOpenEdit(entity: StubEntity) {
		this.openEdit(entity);
	}
	callConfirmDelete(slug: string) {
		this.confirmDelete(slug);
	}
	callFormatDate(d: Date) {
		return this.formatDate(d);
	}
	callTruncateError(msg: string) {
		return this.truncateError(msg);
	}

	/** Disable the manager to test the "not available" path. */
	setManagerNull() {
		this.mockManager = null;
	}
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ManagementModalBase', () => {
	let modal: TestModal;

	beforeEach(() => {
		modal = new TestModal({} as any, { agentEventBus: null, logger: { error: vi.fn(), log: vi.fn() } } as any, 'list');
	});

	// ── View state machine ───────────────────────────────────────────────

	describe('view transitions', () => {
		it('starts in the initial view', () => {
			expect(modal.currentView).toBe('list');
		});

		it('transitions to create via openCreate', () => {
			modal.callOpenCreate();
			expect(modal.currentView).toBe('create');
			expect(modal.currentEditingSlug).toBeNull();
			expect(modal.resetFormCalls).toBe(1);
		});

		it('transitions to edit via openEdit', () => {
			modal.callOpenEdit(MOCK_ENTITIES[0]);
			expect(modal.currentView).toBe('edit');
			expect(modal.currentEditingSlug).toBe('alpha');
			expect(modal.populateCalls).toHaveLength(1);
			expect(modal.populateCalls[0]).toBe(MOCK_ENTITIES[0]);
		});
	});

	// ── Lifecycle ────────────────────────────────────────────────────────

	describe('lifecycle', () => {
		it('onOpen renders the list and subscribes to events', () => {
			modal.onOpen();
			// Should have rendered entity rows for both entities
			expect(modal.renderEntityRowCalls).toHaveLength(2);
		});

		it('onClose clears unsubscribers and empties content', () => {
			modal.onOpen();
			modal.onClose();
			// contentEl.empty() should have been called during onClose
			expect(modal.contentEl.empty).toHaveBeenCalled();
		});
	});

	// ── Render dispatcher ────────────────────────────────────────────────

	describe('render', () => {
		it('renders the list view with entity rows', () => {
			modal.callRender();
			expect(modal.renderEntityRowCalls).toHaveLength(2);
			expect(modal.renderEntityRowCalls[0].entity.slug).toBe('alpha');
			expect(modal.renderEntityRowCalls[0].state).toEqual({});
			expect(modal.renderEntityRowCalls[1].entity.slug).toBe('beta');
			expect(modal.renderEntityRowCalls[1].state).toEqual(MOCK_STATES.beta);
		});

		it('adds CSS classes to content element', () => {
			modal.callRender();
			expect(modal.contentEl.addClass).toHaveBeenCalledWith('test-modal');
		});

		it('calls renderListPreamble in list view', () => {
			modal.callRender();
			expect(modal.preambleCalls).toBe(1);
		});

		it('renders the create form', () => {
			modal.callOpenCreate();
			expect(modal.renderFormBodyCalls).toHaveLength(1);
			expect(modal.renderFormBodyCalls[0]).toBe(false);
		});

		it('renders the edit form', () => {
			modal.callOpenEdit(MOCK_ENTITIES[0]);
			expect(modal.renderFormBodyCalls).toHaveLength(1);
			expect(modal.renderFormBodyCalls[0]).toBe(true);
		});
	});

	// ── Shared helpers ───────────────────────────────────────────────────

	describe('formatDate', () => {
		it('formats a date with short month, day, and time', () => {
			const result = modal.callFormatDate(new Date('2025-06-15T14:30:00'));
			// locale-dependent, just check it returns a non-empty string
			expect(typeof result).toBe('string');
			expect(result.length).toBeGreaterThan(0);
		});
	});

	describe('truncateError', () => {
		it('returns short messages unchanged', () => {
			expect(modal.callTruncateError('Oops')).toBe('Oops');
		});

		it('truncates messages over 80 characters', () => {
			const long = 'A'.repeat(100);
			const result = modal.callTruncateError(long);
			expect(result.length).toBe(78); // 77 chars + '…'
			expect(result.endsWith('…')).toBe(true);
		});

		it('keeps exactly 80-char messages unchanged', () => {
			const exact = 'B'.repeat(80);
			expect(modal.callTruncateError(exact)).toBe(exact);
		});
	});

	// ── confirmDelete ────────────────────────────────────────────────────

	describe('confirmDelete', () => {
		it('does not throw and empties content', () => {
			modal.callConfirmDelete('test-slug');
			expect(modal.contentEl.empty).toHaveBeenCalled();
		});
	});
});
