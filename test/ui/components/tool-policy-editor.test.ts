/**
 * Tests for ToolPolicyEditor — the shared per-feature tool-policy picker used by
 * the scheduled-task, hook, and project forms.
 *
 * `ToolPolicyEditor` is a plain class (not a `Modal`), so it can be driven directly
 * against a detached container. Per #1262's guidance these assert the **policy
 * decisions** the editor emits — what `onChange` receives for a given interaction —
 * rather than the markup it renders. The DOM is only the input device: real jsdom
 * `<select>`/`<input>` elements are used so `change` events exercise the same
 * listeners a user would.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { ToolPolicyEditor } from '../../../src/ui/components/tool-policy-editor';
import { FeatureToolPolicy, PolicyPreset, ToolClassification, ToolPermission } from '../../../src/types/tool-policy';
import type { ObsidianGemini } from '../../../src/types/plugin';

/**
 * Add the Obsidian DOM sugar (createEl/createDiv/createSpan/empty) that jsdom lacks.
 * The global vitest setup patches hide/show/toggle/toggleClass onto the prototype; the
 * element-factory helpers with cls/text/attr options stay per-test, mirroring
 * test/ui/agent-view/agent-view-tool-display.test.ts.
 */
function addObsidianMethods(el: HTMLElement): HTMLElement {
	const anyEl = el as any;
	anyEl.createEl = function (tag: string, opts?: any) {
		const elem = document.createElement(tag);
		if (opts?.cls) elem.className = opts.cls;
		if (opts?.text !== undefined) elem.textContent = opts.text;
		if (opts?.attr) {
			for (const [key, val] of Object.entries(opts.attr)) {
				elem.setAttribute(key, val as string);
			}
		}
		addObsidianMethods(elem);
		this.appendChild(elem);
		return elem;
	};
	anyEl.createDiv = function (opts?: any) {
		return this.createEl('div', opts);
	};
	anyEl.createSpan = function (opts?: any) {
		return this.createEl('span', opts);
	};
	anyEl.empty = function () {
		this.innerHTML = '';
	};
	return el;
}

/** One tool per classification, so the grouped overrides table renders every section. */
const TOOLS = [
	{ name: 'read_file', displayName: 'Read File', classification: ToolClassification.READ },
	{ name: 'write_file', displayName: 'Write File', classification: ToolClassification.WRITE },
	{ name: 'delete_file', displayName: 'Delete File', classification: ToolClassification.DESTRUCTIVE },
	{ name: 'web_fetch', displayName: 'Web Fetch', classification: ToolClassification.EXTERNAL },
];

describe('ToolPolicyEditor', () => {
	let mount: HTMLElement;
	let onChange: Mock<(next: FeatureToolPolicy | undefined) => void>;
	let plugin: ObsidianGemini;
	let editor: ToolPolicyEditor | undefined;

	/** Build the editor and keep a handle so afterEach can tear it down. */
	function makeEditor(value: FeatureToolPolicy | undefined, tools: unknown[] = TOOLS): ToolPolicyEditor {
		plugin = {
			toolRegistry: { getAllTools: () => tools },
		} as unknown as ObsidianGemini;
		editor = new ToolPolicyEditor(plugin, mount, { value, onChange });
		return editor;
	}

	/** The single "inherit global policy" checkbox. */
	function inheritCheckbox(): HTMLInputElement {
		const cb = mount.querySelector<HTMLInputElement>('.gemini-tool-policy-editor-inherit input');
		if (!cb) throw new Error('inherit checkbox not rendered');
		return cb;
	}

	/** The preset dropdown (absent while "inherit global policy" is on). */
	function presetSelect(): HTMLSelectElement {
		const sel = mount.querySelector<HTMLSelectElement>('.gemini-tool-policy-editor-preset-row select');
		if (!sel) throw new Error('preset select not rendered');
		return sel;
	}

	/** The per-tool override dropdown for `toolName`, located via its row's name span. */
	function toolSelect(toolName: string): HTMLSelectElement {
		const label = TOOLS.find((t) => t.name === toolName)?.displayName ?? toolName;
		const rows = Array.from(mount.querySelectorAll('.gemini-tool-policy-editor-tool-row'));
		const row = rows.find((r) => r.querySelector('.gemini-tool-policy-editor-tool-name')?.textContent === label);
		const sel = row?.querySelector('select');
		if (!sel) throw new Error(`override select for ${toolName} not rendered`);
		return sel;
	}

	/** Set a <select>'s value and fire the `change` event the editor listens for. */
	function choose(select: HTMLSelectElement, value: string): void {
		select.value = value;
		select.dispatchEvent(new Event('change'));
	}

	/** Toggle the checkbox and fire its `change` event. */
	function toggleInherit(checked: boolean): void {
		const cb = inheritCheckbox();
		cb.checked = checked;
		cb.dispatchEvent(new Event('change'));
	}

	/** The value handed to the most recent onChange call. */
	function lastEmitted(): FeatureToolPolicy | undefined {
		expect(onChange).toHaveBeenCalled();
		return onChange.mock.calls[onChange.mock.calls.length - 1][0];
	}

	beforeEach(() => {
		document.body.innerHTML = '';
		mount = addObsidianMethods(document.createElement('div'));
		document.body.appendChild(mount);
		onChange = vi.fn<(next: FeatureToolPolicy | undefined) => void>();
	});

	afterEach(() => {
		editor?.destroy();
		editor = undefined;
		document.body.innerHTML = '';
	});

	// ── Initial value → rendered state ────────────────────────────────────────

	describe('initial value', () => {
		it('renders the inherit-global state for an undefined policy and hides the body', () => {
			makeEditor(undefined);

			expect(inheritCheckbox().checked).toBe(true);
			expect(mount.querySelector('.gemini-tool-policy-editor-preset-row')).toBeNull();
			expect(mount.querySelectorAll('.gemini-tool-policy-editor-tool-row')).toHaveLength(0);
			// Rendering alone must never emit — onChange means "the user changed something".
			expect(onChange).not.toHaveBeenCalled();
		});

		it('reflects an explicit preset and per-tool overrides in the controls', () => {
			makeEditor({
				preset: PolicyPreset.READ_ONLY,
				overrides: { delete_file: ToolPermission.DENY },
			});

			expect(inheritCheckbox().checked).toBe(false);
			expect(presetSelect().value).toBe(PolicyPreset.READ_ONLY);
			expect(toolSelect('delete_file').value).toBe(ToolPermission.DENY);
			// Tools with no override sit on the inherit sentinel.
			expect(toolSelect('read_file').value).toBe('__inherit__');
			expect(onChange).not.toHaveBeenCalled();
		});

		it('shows the preset row with no preset selected when only overrides are set', () => {
			makeEditor({ overrides: { web_fetch: ToolPermission.APPROVE } });

			expect(inheritCheckbox().checked).toBe(false);
			expect(presetSelect().value).toBe('__inherit__');
			expect(toolSelect('web_fetch').value).toBe(ToolPermission.APPROVE);
		});

		it('does not alias the caller value — mutating the editor leaves the input untouched', () => {
			const original: FeatureToolPolicy = {
				preset: PolicyPreset.CAUTIOUS,
				overrides: { read_file: ToolPermission.APPROVE },
			};
			makeEditor(original);

			choose(toolSelect('delete_file'), ToolPermission.DENY);

			expect(original).toEqual({
				preset: PolicyPreset.CAUTIOUS,
				overrides: { read_file: ToolPermission.APPROVE },
			});
			// ...and the emitted overrides map is a copy too, not the editor's own state.
			const emitted = lastEmitted();
			expect(emitted?.overrides).toEqual({
				read_file: ToolPermission.APPROVE,
				delete_file: ToolPermission.DENY,
			});
			expect(emitted?.overrides).not.toBe(original.overrides);
		});
	});

	// ── The inherit toggle ────────────────────────────────────────────────────

	describe('inherit toggle', () => {
		it('emits undefined and reveals the body when inheriting is turned off', () => {
			makeEditor(undefined);

			toggleInherit(false);

			// An empty custom policy normalizes to undefined — there is nothing to
			// persist until the user actually picks a preset or an override.
			expect(lastEmitted()).toBeUndefined();
			expect(inheritCheckbox().checked).toBe(false);
			expect(presetSelect()).toBeTruthy();
			expect(mount.querySelectorAll('.gemini-tool-policy-editor-tool-row')).toHaveLength(TOOLS.length);
		});

		it('discards a configured policy and emits undefined when inheriting is turned back on', () => {
			makeEditor({ preset: PolicyPreset.YOLO, overrides: { delete_file: ToolPermission.DENY } });

			toggleInherit(true);

			expect(lastEmitted()).toBeUndefined();
			expect(mount.querySelector('.gemini-tool-policy-editor-preset-row')).toBeNull();
		});
	});

	// ── Preset selection ──────────────────────────────────────────────────────

	describe('preset selection', () => {
		it('emits the chosen preset', () => {
			makeEditor({});

			choose(presetSelect(), PolicyPreset.EDIT_MODE);

			expect(lastEmitted()).toEqual({ preset: PolicyPreset.EDIT_MODE });
		});

		it('offers every preset except CUSTOM, plus the no-preset sentinel', () => {
			makeEditor({});

			const values = Array.from(presetSelect().options).map((o) => o.value);
			expect(values).toEqual([
				'__inherit__',
				PolicyPreset.READ_ONLY,
				PolicyPreset.CAUTIOUS,
				PolicyPreset.EDIT_MODE,
				PolicyPreset.YOLO,
			]);
			expect(values).not.toContain(PolicyPreset.CUSTOM);
		});

		it('clearing the preset drops it and normalizes an otherwise-empty policy to undefined', () => {
			makeEditor({ preset: PolicyPreset.READ_ONLY });

			choose(presetSelect(), '__inherit__');

			expect(lastEmitted()).toBeUndefined();
		});

		it('clearing the preset keeps surviving overrides', () => {
			makeEditor({ preset: PolicyPreset.READ_ONLY, overrides: { web_fetch: ToolPermission.DENY } });

			choose(presetSelect(), '__inherit__');

			expect(lastEmitted()).toEqual({ overrides: { web_fetch: ToolPermission.DENY } });
		});
	});

	// ── Per-tool overrides ────────────────────────────────────────────────────

	describe('per-tool overrides', () => {
		it('emits an override for the tool that changed', () => {
			makeEditor({});

			choose(toolSelect('delete_file'), ToolPermission.DENY);

			expect(lastEmitted()).toEqual({ overrides: { delete_file: ToolPermission.DENY } });
		});

		it('layers overrides on top of the preset rather than replacing it', () => {
			makeEditor({ preset: PolicyPreset.EDIT_MODE });

			choose(toolSelect('delete_file'), ToolPermission.DENY);

			expect(lastEmitted()).toEqual({
				preset: PolicyPreset.EDIT_MODE,
				overrides: { delete_file: ToolPermission.DENY },
			});
		});

		it('accumulates overrides across several tools', () => {
			makeEditor({});

			choose(toolSelect('delete_file'), ToolPermission.DENY);
			choose(toolSelect('write_file'), ToolPermission.ASK_USER);
			choose(toolSelect('read_file'), ToolPermission.APPROVE);

			expect(lastEmitted()).toEqual({
				overrides: {
					delete_file: ToolPermission.DENY,
					write_file: ToolPermission.ASK_USER,
					read_file: ToolPermission.APPROVE,
				},
			});
		});

		it('resetting a tool to inherit removes just that override', () => {
			makeEditor({
				overrides: { delete_file: ToolPermission.DENY, web_fetch: ToolPermission.APPROVE },
			});

			choose(toolSelect('delete_file'), '__inherit__');

			expect(lastEmitted()).toEqual({ overrides: { web_fetch: ToolPermission.APPROVE } });
		});

		it('normalizes to undefined once the last override is cleared', () => {
			makeEditor({ overrides: { delete_file: ToolPermission.DENY } });

			choose(toolSelect('delete_file'), '__inherit__');

			expect(lastEmitted()).toBeUndefined();
		});

		it('offers every permission plus the inherit sentinel for each tool', () => {
			makeEditor({});

			const values = Array.from(toolSelect('write_file').options).map((o) => o.value);
			expect(values).toEqual(['__inherit__', ToolPermission.DENY, ToolPermission.ASK_USER, ToolPermission.APPROVE]);
		});

		it('renders a row per registered tool, grouped by classification order', () => {
			makeEditor({});

			const names = Array.from(mount.querySelectorAll('.gemini-tool-policy-editor-tool-name')).map(
				(el) => el.textContent
			);
			// Object.values(ToolClassification) order: read, write, destructive, external.
			expect(names).toEqual(['Read File', 'Write File', 'Delete File', 'Web Fetch']);
		});

		it('falls back to the tool name when a tool has no display name', () => {
			makeEditor({}, [{ name: 'bare_tool', displayName: '', classification: ToolClassification.READ }]);

			const names = Array.from(mount.querySelectorAll('.gemini-tool-policy-editor-tool-name')).map(
				(el) => el.textContent
			);
			expect(names).toEqual(['bare_tool']);
		});

		it('renders an empty-state message instead of a table when no tools are registered', () => {
			makeEditor({}, []);

			expect(mount.querySelectorAll('.gemini-tool-policy-editor-tool-row')).toHaveLength(0);
			expect(mount.querySelector('.gemini-tool-policy-editor-overrides')?.textContent).toContain('No tools registered');
			// The preset row still renders — the policy is editable without tools.
			expect(presetSelect()).toBeTruthy();
		});

		it('survives a plugin with no tool registry at all', () => {
			plugin = {} as unknown as ObsidianGemini;
			editor = new ToolPolicyEditor(plugin, mount, { value: {}, onChange });

			expect(mount.querySelectorAll('.gemini-tool-policy-editor-tool-row')).toHaveLength(0);
			expect(presetSelect()).toBeTruthy();
		});
	});

	// ── setValue ──────────────────────────────────────────────────────────────

	describe('setValue', () => {
		it('round-trips a policy into the controls without emitting', () => {
			makeEditor(undefined);

			editor!.setValue({ preset: PolicyPreset.CAUTIOUS, overrides: { web_fetch: ToolPermission.DENY } });

			expect(inheritCheckbox().checked).toBe(false);
			expect(presetSelect().value).toBe(PolicyPreset.CAUTIOUS);
			expect(toolSelect('web_fetch').value).toBe(ToolPermission.DENY);
			// setValue is a programmatic refresh, not a user edit.
			expect(onChange).not.toHaveBeenCalled();
		});

		it('round-trips undefined back to the inherit-global state', () => {
			makeEditor({ preset: PolicyPreset.YOLO });

			editor!.setValue(undefined);

			expect(inheritCheckbox().checked).toBe(true);
			expect(mount.querySelector('.gemini-tool-policy-editor-preset-row')).toBeNull();
			expect(onChange).not.toHaveBeenCalled();
		});

		it('does not alias the value passed to it', () => {
			makeEditor(undefined);
			const next: FeatureToolPolicy = { overrides: { read_file: ToolPermission.APPROVE } };

			editor!.setValue(next);
			choose(toolSelect('write_file'), ToolPermission.DENY);

			expect(next).toEqual({ overrides: { read_file: ToolPermission.APPROVE } });
		});

		it('edits after setValue emit from the new value, not the old one', () => {
			makeEditor({ preset: PolicyPreset.YOLO, overrides: { delete_file: ToolPermission.APPROVE } });

			editor!.setValue({ preset: PolicyPreset.READ_ONLY });
			choose(toolSelect('web_fetch'), ToolPermission.DENY);

			expect(lastEmitted()).toEqual({
				preset: PolicyPreset.READ_ONLY,
				overrides: { web_fetch: ToolPermission.DENY },
			});
		});

		// ── The equal-value no-op (#1414) ────────────────────────────────────
		//
		// setValue's docstring promises "no-op if the new value is structurally
		// equal to the current state" — the tests below pin that the DOM is not
		// rebuilt (same nodes survive) and that no emission fires.

		it('does not rebuild the DOM when the new value is structurally equal', () => {
			const initial: FeatureToolPolicy = {
				preset: PolicyPreset.CAUTIOUS,
				overrides: { delete_file: ToolPermission.DENY },
			};
			makeEditor(initial);
			const checkboxBefore = inheritCheckbox();
			const presetBefore = presetSelect();
			const toolBefore = toolSelect('delete_file');

			// A structurally-equal (but freshly allocated) policy — this is what a
			// host-modal refresh hands over when nothing about the policy changed.
			editor!.setValue({ preset: PolicyPreset.CAUTIOUS, overrides: { delete_file: ToolPermission.DENY } });

			// The very same DOM nodes survive: no container.empty() + rebuild.
			expect(inheritCheckbox()).toBe(checkboxBefore);
			expect(presetSelect()).toBe(presetBefore);
			expect(toolSelect('delete_file')).toBe(toolBefore);
		});

		it('does not rebuild when both values are undefined', () => {
			makeEditor(undefined);
			const checkboxBefore = inheritCheckbox();

			editor!.setValue(undefined);

			expect(inheritCheckbox()).toBe(checkboxBefore);
		});

		it('does not rebuild when the only difference is absent vs empty overrides', () => {
			makeEditor({ preset: PolicyPreset.YOLO });
			const presetBefore = presetSelect();

			editor!.setValue({ preset: PolicyPreset.YOLO, overrides: {} });

			expect(presetSelect()).toBe(presetBefore);
		});

		it('rebuilds and reflects the new value when the policy differs', () => {
			makeEditor({ preset: PolicyPreset.CAUTIOUS });
			const presetBefore = presetSelect();

			editor!.setValue({ preset: PolicyPreset.READ_ONLY, overrides: { delete_file: ToolPermission.ASK_USER } });

			// New nodes were built (the old select was torn down) and carry the new value.
			expect(presetSelect()).not.toBe(presetBefore);
			expect(presetSelect().value).toBe(PolicyPreset.READ_ONLY);
			expect(toolSelect('delete_file').value).toBe(ToolPermission.ASK_USER);
		});

		it('rebuilds when the value changes from undefined to a policy and back', () => {
			makeEditor(undefined);
			expect(mount.querySelector('.gemini-tool-policy-editor-preset-row')).toBeNull();

			editor!.setValue({ preset: PolicyPreset.YOLO });
			expect(inheritCheckbox().checked).toBe(false);
			expect(presetSelect().value).toBe(PolicyPreset.YOLO);

			editor!.setValue(undefined);
			expect(inheritCheckbox().checked).toBe(true);
			expect(mount.querySelector('.gemini-tool-policy-editor-preset-row')).toBeNull();
		});

		it('still does not emit on a genuine rebuild', () => {
			makeEditor({ preset: PolicyPreset.CAUTIOUS });

			editor!.setValue({ preset: PolicyPreset.YOLO });

			expect(onChange).not.toHaveBeenCalled();
		});

		it('keeps the editor editable after an equal-value setValue', () => {
			makeEditor({ preset: PolicyPreset.CAUTIOUS, overrides: { delete_file: ToolPermission.DENY } });

			editor!.setValue({ preset: PolicyPreset.CAUTIOUS, overrides: { delete_file: ToolPermission.DENY } });

			// The surviving controls still respond: picks emit from the current state.
			const select = toolSelect('read_file');
			select.value = ToolPermission.APPROVE;
			select.dispatchEvent(new Event('change'));

			expect(onChange).toHaveBeenCalledTimes(1);
			expect(onChange).toHaveBeenCalledWith({
				preset: PolicyPreset.CAUTIOUS,
				overrides: { delete_file: ToolPermission.DENY, read_file: ToolPermission.APPROVE },
			});
		});
	});

	// ── Rendering options ─────────────────────────────────────────────────────

	describe('rendering options', () => {
		it('uses the default title and omits the description when neither is supplied', () => {
			makeEditor({});

			expect(mount.querySelector('.gemini-tool-policy-editor-title')?.textContent).toBe('Tool access');
			expect(mount.querySelector('.gemini-tool-policy-editor-desc')).toBeNull();
		});

		it('suppresses the heading entirely for an empty title', () => {
			plugin = { toolRegistry: { getAllTools: () => TOOLS } } as unknown as ObsidianGemini;
			editor = new ToolPolicyEditor(plugin, mount, { value: {}, onChange, title: '' });

			expect(mount.querySelector('.gemini-tool-policy-editor-title')).toBeNull();
		});

		it('renders a custom title and description', () => {
			plugin = { toolRegistry: { getAllTools: () => TOOLS } } as unknown as ObsidianGemini;
			editor = new ToolPolicyEditor(plugin, mount, {
				value: {},
				onChange,
				title: 'Hook tools',
				description: 'When off, inherits the global plugin tool policy.',
			});

			expect(mount.querySelector('.gemini-tool-policy-editor-title')?.textContent).toBe('Hook tools');
			expect(mount.querySelector('.gemini-tool-policy-editor-desc')?.textContent).toBe(
				'When off, inherits the global plugin tool policy.'
			);
		});

		it('gives each instance a unique checkbox id so coexisting editors stay independently labelled', () => {
			const first = addObsidianMethods(document.createElement('div'));
			const second = addObsidianMethods(document.createElement('div'));
			document.body.append(first, second);
			const stub = { toolRegistry: { getAllTools: () => TOOLS } } as unknown as ObsidianGemini;

			const a = new ToolPolicyEditor(stub, first, { value: undefined, onChange });
			const b = new ToolPolicyEditor(stub, second, { value: undefined, onChange });

			const idA = first.querySelector('input')?.id;
			const idB = second.querySelector('input')?.id;
			expect(idA).toBeTruthy();
			expect(idA).not.toBe(idB);
			// The label is bound to its own checkbox, not the other editor's.
			expect(first.querySelector('label')?.getAttribute('for')).toBe(idA);
			expect(second.querySelector('label')?.getAttribute('for')).toBe(idB);

			a.destroy();
			b.destroy();
		});
	});

	// ── destroy ───────────────────────────────────────────────────────────────

	describe('destroy', () => {
		it('detaches the editor DOM from the mount and the document', () => {
			makeEditor({ preset: PolicyPreset.CAUTIOUS });
			expect(mount.querySelector('.gemini-tool-policy-editor')).toBeTruthy();

			editor!.destroy();

			expect(mount.querySelector('.gemini-tool-policy-editor')).toBeNull();
			expect(mount.children).toHaveLength(0);
			expect(document.querySelector('.gemini-tool-policy-editor')).toBeNull();
		});

		it('leaves no control behind that could emit, and does not emit on the way out', () => {
			makeEditor({ preset: PolicyPreset.CAUTIOUS, overrides: { delete_file: ToolPermission.DENY } });

			editor!.destroy();

			// Nothing interactive survives under the mount, so no further user
			// interaction can reach the editor's listeners.
			expect(mount.querySelectorAll('select')).toHaveLength(0);
			expect(mount.querySelectorAll('input')).toHaveLength(0);
			expect(onChange).not.toHaveBeenCalled();
		});

		it('is safe to call twice', () => {
			makeEditor({});

			editor!.destroy();
			expect(() => editor!.destroy()).not.toThrow();
			expect(onChange).not.toHaveBeenCalled();
		});

		it('does not disturb sibling content already in the mount', () => {
			const sibling = document.createElement('p');
			sibling.textContent = 'kept';
			mount.appendChild(sibling);
			makeEditor({});

			editor!.destroy();

			expect(mount.contains(sibling)).toBe(true);
			expect(mount.querySelector('.gemini-tool-policy-editor')).toBeNull();
		});
	});
});
