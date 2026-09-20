import { HookManagementModal } from '../../src/ui/hook-management-modal';
import { SchedulerManagementModal } from '../../src/ui/scheduler-management-modal';

/**
 * Regression coverage for the shared advanced rows extracted into
 * ManagementModalBase (#1343): both management modals must render the three
 * shared rows (model override, output path, max iterations) plus the enabled
 * toggle, in the shared order, and `parseMaxIterationsField` must keep the
 * reject-don't-swallow contract the modals had before the extraction.
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
	class Modal extends original.Modal {
		constructor(app: any) {
			super(app);
			this.contentEl = createMockElement();
			this.modalEl = createMockElement();
		}
	}
	// Capture the row structure: each Setting records its name and the
	// components added to it, in order, so tests can assert ordering and
	// round-tripping through the accessors.
	class Setting extends original.Setting {
		public components: any[] = [];
		public nameEl: any = { textContent: '' };
		constructor(container: any) {
			super(container);
			settingRegistry.push(this);
		}
		setName(name: string) {
			this.nameEl.textContent = name;
			return this;
		}
		setDesc() {
			return this;
		}
		addText(cb: (text: any) => any) {
			const component: any = {
				value: '',
				setValue: vi.fn((v: string) => {
					component.value = v;
					return component;
				}),
				setPlaceholder: vi.fn().mockReturnThis(),
				onChange: vi.fn((cb: (v: string) => void) => {
					component.changeCb = cb;
					return component;
				}),
			};
			cb(component);
			this.components.push(component);
			return this;
		}
		addToggle(cb: (toggle: any) => any) {
			const component: any = {
				setValue: vi.fn().mockReturnThis(),
				onChange: vi.fn().mockReturnThis(),
			};
			cb(component);
			this.components.push(component);
			return this;
		}
		addDropdown(cb: (d: any) => any) {
			const component: any = {
				addOption: vi.fn().mockReturnThis(),
				setValue: vi.fn().mockReturnThis(),
				onChange: vi.fn().mockReturnThis(),
			};
			cb(component);
			this.components.push(component);
			return this;
		}
		addExtraButton(cb: (b: any) => any) {
			cb({
				setIcon: vi.fn().mockReturnThis(),
				setTooltip: vi.fn().mockReturnThis(),
				onClick: vi.fn().mockReturnThis(),
			});
			return this;
		}
	}
	return { ...original, Modal, Setting };
});

let settingRegistry: any[] = [];
const registerSettings = () => {
	settingRegistry = [];
};

/** Names of the settings created while `registerSettings` was active. */
const renderedNames = () => settingRegistry.filter((s) => s.nameEl?.textContent).map((s) => s.nameEl.textContent);

// ── Rendering ────────────────────────────────────────────────────────────────

describe('HookManagementModal advanced section', () => {
	let modal: HookManagementModal;

	beforeEach(() => {
		modal = new HookManagementModal(
			{} as any,
			{ agentEventBus: null, logger: { error: vi.fn(), log: vi.fn() } } as any
		);
		registerSettings();
		(modal as any).openCreate();
	});

	// The shared rows must appear with the hooks i18n keys, in the shared
	// order model → outputPath → maxIterations (hooks' pre-#1343 order was
	// model → maxIterations → outputPath; the deliberate swap).
	it('renders the shared rows via the base helper in the shared order', () => {
		const names = renderedNames();
		// Match on the resolved i18n labels (the mock's setName captures the
		// translated string).
		const modelIdx = names.findIndex((n: string) => n.includes('Model override'));
		const outputPathIdx = names.findIndex((n: string) => n.includes('Output path'));
		const maxIterationsIdx = names.findIndex((n: string) => n.includes('Max tool iterations'));
		const enabledIdx = names.findIndex((n: string) => n.includes('Enabled'));
		expect(modelIdx).toBeGreaterThanOrEqual(0);
		expect(outputPathIdx).toBeGreaterThan(modelIdx);
		expect(maxIterationsIdx).toBeGreaterThan(outputPathIdx);
		// Entity-specific rows stay interleaved around the shared block.
		expect(names.some((n: string) => n.includes('Debounce'))).toBe(true);
		expect(names.some((n: string) => n.includes('Desktop only'))).toBe(true);
		// Enabled stays last in the advanced section (shared helper, called last).
		const afterEnabled = names.slice(enabledIdx + 1);
		expect(afterEnabled).toEqual([]);
	});

	it('round-trips form values through the shared accessors', () => {
		const maxIterSetting = settingRegistry.find((s) => s.nameEl?.textContent.includes('Max tool iterations'));
		const component = maxIterSetting.components.find((c: any) => c.setValue);
		// The row was built with the form's current value via setValue.
		expect(component.setValue).toHaveBeenCalledWith('');
		// Simulate user input and confirm the accessor wrote the trimmed value.
		component.changeCb(' 7 ');
		expect((modal as any).form.maxIterations).toBe('7');
	});
});

describe('SchedulerManagementModal advanced section', () => {
	let modal: SchedulerManagementModal;

	beforeEach(() => {
		modal = new SchedulerManagementModal(
			{} as any,
			{ agentEventBus: null, logger: { error: vi.fn(), log: vi.fn() } } as any
		);
		settingRegistry = [];
		(modal as any).openCreate();
	});

	it('renders the shared rows in the same order with entity rows around them', () => {
		const names = renderedNames();
		const modelIdx = names.findIndex((n: string) => n.includes('Model override'));
		const outputPathIdx = names.findIndex((n: string) => n.includes('Output path'));
		const maxIterationsIdx = names.findIndex((n: string) => n.includes('Max tool iterations'));
		const runIfMissedIdx = names.findIndex((n: string) => n.includes('Run if missed'));
		const enabledIdx = names.findIndex((n: string) => n.includes('Enabled'));
		expect(outputPathIdx).toBeGreaterThan(modelIdx);
		expect(maxIterationsIdx).toBeGreaterThan(outputPathIdx);
		// runIfMissed sits between the shared rows and the enabled toggle.
		expect(runIfMissedIdx).toBeGreaterThan(maxIterationsIdx);
		expect(enabledIdx).toBeGreaterThan(runIfMissedIdx);
	});

	it('round-trips form values through the shared accessors', () => {
		const modelSetting = settingRegistry.find((s) => s.nameEl?.textContent.includes('Model override'));
		const component = modelSetting.components.find((c: any) => c.changeCb);
		component.changeCb(' gemini-2.0-flash ');
		expect((modal as any).form.model).toBe('gemini-2.0-flash');
	});
});

// ── parseMaxIterationsField contract (via the base) ─────────────────────────

describe('parseMaxIterationsField (shared coercion)', () => {
	let modal: HookManagementModal;

	beforeEach(() => {
		modal = new HookManagementModal(
			{} as any,
			{ agentEventBus: null, logger: { error: vi.fn(), log: vi.fn() } } as any
		);
	});

	it.each([
		['', undefined],
		['   ', undefined],
		['5', 5],
		[' 12 ', 12],
	])('parses %j to %j', (raw, expected) => {
		expect((modal as any).parseMaxIterationsField(raw)).toBe(expected);
	});

	it.each(['0', '-1', '2.5', 'abc', '5x'])('rejects %s as invalid', (raw) => {
		expect((modal as any).parseMaxIterationsField(raw)).toBe('invalid');
	});
});
