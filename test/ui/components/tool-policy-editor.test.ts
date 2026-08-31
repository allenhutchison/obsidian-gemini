/**
 * Regression tests for the ToolPolicyEditor.setValue equal-value no-op (#1414).
 *
 * The full editor suite lives in test/ui/components/tool-policy-editor.test.ts,
 * added by PR #1413 — this file pins only the setValue semantics that PR
 * deliberately left unpinned because the docstring and the behavior disagreed:
 * setValue must not rebuild the editor when the incoming policy is structurally
 * equal to the current state (focus loss / closed dropdowns on host-modal
 * re-renders), and must rebuild when it differs.
 *
 * The editor is a plain class (not a Modal), driven against a detached jsdom
 * container with the Obsidian DOM sugar added per-test, mirroring the harness
 * conventions of test/ui/agent-view/agent-view-tool-display.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { ToolPolicyEditor } from '../../../src/ui/components/tool-policy-editor';
import { FeatureToolPolicy, PolicyPreset, ToolClassification, ToolPermission } from '../../../src/types/tool-policy';
import type { ObsidianGemini } from '../../../src/types/plugin';

/**
 * Add the Obsidian DOM sugar (createEl/createDiv/createSpan/empty) that jsdom lacks.
 * The global vitest setup patches hide/show/toggle/toggleClass onto the prototype.
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

const TOOLS = [
	{ name: 'read_file', displayName: 'Read File', classification: ToolClassification.READ },
	{ name: 'delete_file', displayName: 'Delete File', classification: ToolClassification.DESTRUCTIVE },
];

describe('ToolPolicyEditor.setValue equal-value no-op (#1414)', () => {
	let mount: HTMLElement;
	let onChange: Mock<(next: FeatureToolPolicy | undefined) => void>;
	let plugin: ObsidianGemini;
	let editor: ToolPolicyEditor | undefined;

	function makeEditor(value: FeatureToolPolicy | undefined): ToolPolicyEditor {
		plugin = {
			toolRegistry: { getAllTools: () => TOOLS },
		} as unknown as ObsidianGemini;
		editor = new ToolPolicyEditor(plugin, mount, { value, onChange });
		return editor;
	}

	function inheritCheckbox(): HTMLInputElement {
		const cb = mount.querySelector<HTMLInputElement>('.gemini-tool-policy-editor-inherit input');
		if (!cb) throw new Error('inherit checkbox not rendered');
		return cb;
	}

	function presetSelect(): HTMLSelectElement {
		const sel = mount.querySelector<HTMLSelectElement>('.gemini-tool-policy-editor-preset-row select');
		if (!sel) throw new Error('preset select not rendered');
		return sel;
	}

	function toolSelect(toolName: string): HTMLSelectElement {
		const label = TOOLS.find((t) => t.name === toolName)?.displayName ?? toolName;
		const rows = Array.from(mount.querySelectorAll('.gemini-tool-policy-editor-tool-row'));
		const row = rows.find((r) => r.querySelector('.gemini-tool-policy-editor-tool-name')?.textContent === label);
		const sel = row?.querySelector('select');
		if (!sel) throw new Error(`override select for ${toolName} not rendered`);
		return sel;
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

	it('does not emit when the value is equal, and still does not emit on a genuine rebuild', () => {
		makeEditor({ preset: PolicyPreset.CAUTIOUS });

		editor!.setValue({ preset: PolicyPreset.CAUTIOUS });
		expect(onChange).not.toHaveBeenCalled();

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
