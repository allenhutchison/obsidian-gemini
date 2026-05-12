import type ObsidianGemini from '../../main';
import type { Tool } from '../../tools/types';
import {
	FeatureToolPolicy,
	PolicyPreset,
	PRESET_LABELS,
	PERMISSION_LABELS,
	CLASSIFICATION_LABELS,
	ToolClassification,
	ToolPermission,
	clonePolicy,
} from '../../types/tool-policy';

/**
 * Sentinel used in the preset dropdown to mean "no preset set on this feature
 * — inherit whatever the global plugin policy currently uses." Stored as a
 * sentinel string rather than `undefined` because <select> values are strings.
 */
const INHERIT_PRESET = '__inherit__';
/** Same idea for per-tool overrides: "leave this tool to the preset / global". */
const INHERIT_OVERRIDE = '__inherit__';

export interface ToolPolicyEditorOptions {
	/** Initial value. `undefined` means "inherit global policy". */
	value: FeatureToolPolicy | undefined;
	/** Fired whenever the user changes a field. */
	onChange(next: FeatureToolPolicy | undefined): void;
	/**
	 * Optional title for the editor block. Defaults to "Tool access". Pass an
	 * empty string to suppress the heading entirely when the editor is embedded
	 * in a larger form that already has its own labels.
	 */
	title?: string;
	/**
	 * Optional description text rendered below the heading. Useful for telling
	 * the user what "inherit" means in their feature's context (e.g. "When off,
	 * inherits the global plugin tool policy.").
	 */
	description?: string;
}

/**
 * Shared UI for picking a FeatureToolPolicy: an "Inherit global policy" toggle,
 * a preset dropdown, and a per-tool overrides table grouped by classification.
 *
 * The editor mutates an internal clone of the supplied value so caller state is
 * never accidentally aliased; every change is surfaced via `onChange` with the
 * full new value (or `undefined` when the user chose to inherit).
 *
 * Usage:
 *   const editor = new ToolPolicyEditor(plugin, container, {
 *     value: task.toolPolicy,
 *     onChange: (next) => { form.toolPolicy = next; },
 *   });
 *   // ... later, when destroying the modal:
 *   editor.destroy();
 */
export class ToolPolicyEditor {
	private state: FeatureToolPolicy | undefined;
	private container: HTMLElement;
	private bodyEl!: HTMLElement;

	constructor(
		private plugin: ObsidianGemini,
		mount: HTMLElement,
		private options: ToolPolicyEditorOptions
	) {
		this.state = clonePolicy(options.value);
		this.container = mount.createDiv({ cls: 'gemini-tool-policy-editor' });
		this.render();
	}

	/**
	 * Replace the editor contents (e.g. after a re-render in the host modal).
	 * No-op if the new value is structurally equal to the current state.
	 */
	setValue(next: FeatureToolPolicy | undefined): void {
		this.state = clonePolicy(next);
		this.render();
	}

	/** Remove the editor's DOM nodes. */
	destroy(): void {
		this.container.empty();
		this.container.remove();
	}

	private emit(): void {
		// Normalize: an empty overrides map is the same as no overrides; an
		// empty policy object is the same as undefined.
		let normalized: FeatureToolPolicy | undefined;
		if (this.state) {
			const { preset, overrides } = this.state;
			const overridesNonEmpty = overrides && Object.keys(overrides).length > 0 ? overrides : undefined;
			if (preset === undefined && !overridesNonEmpty) {
				normalized = undefined;
			} else {
				normalized = {
					...(preset !== undefined ? { preset } : {}),
					...(overridesNonEmpty ? { overrides: { ...overridesNonEmpty } } : {}),
				};
			}
		}
		this.options.onChange(normalized);
	}

	private render(): void {
		this.container.empty();

		const title = this.options.title ?? 'Tool access';
		if (title) {
			this.container.createEl('h4', { text: title, cls: 'gemini-tool-policy-editor-title' });
		}
		if (this.options.description) {
			this.container.createEl('p', {
				text: this.options.description,
				cls: 'gemini-tool-policy-editor-desc',
			});
		}

		// Inherit toggle — when on, hides the rest of the editor.
		const inheritRow = this.container.createDiv({ cls: 'gemini-tool-policy-editor-inherit' });
		const inheritCb = inheritRow.createEl('input', { attr: { type: 'checkbox' } }) as HTMLInputElement;
		inheritCb.checked = this.state === undefined;
		inheritRow.createEl('label', { text: ' Inherit global plugin tool policy' });
		inheritCb.addEventListener('change', () => {
			if (inheritCb.checked) {
				this.state = undefined;
			} else {
				// Initialise to an empty (custom) policy so the user can pick fields.
				this.state = {};
			}
			this.emit();
			this.render();
		});

		this.bodyEl = this.container.createDiv({ cls: 'gemini-tool-policy-editor-body' });
		if (this.state === undefined) {
			return;
		}

		this.renderPresetRow();
		this.renderOverridesTable();
	}

	private renderPresetRow(): void {
		const row = this.bodyEl.createDiv({ cls: 'gemini-tool-policy-editor-preset-row' });
		row.createEl('label', { text: 'Preset:' });
		const select = row.createEl('select') as HTMLSelectElement;

		// "(no preset)" means: use the preset from the global policy, only
		// honour any explicit overrides on this feature. Distinct from
		// "inherit global policy" — that hides this entire body.
		select.add(new Option('(no preset — use global preset)', INHERIT_PRESET));

		// Skip CUSTOM in the picker — it's the implicit value when the user
		// has only set overrides and no preset; the resolver treats CUSTOM as
		// "no preset-driven contribution" already.
		for (const preset of Object.values(PolicyPreset)) {
			if (preset === PolicyPreset.CUSTOM) continue;
			select.add(new Option(PRESET_LABELS[preset], preset));
		}

		select.value = this.state?.preset ?? INHERIT_PRESET;
		select.addEventListener('change', () => {
			if (!this.state) this.state = {};
			if (select.value === INHERIT_PRESET) {
				delete this.state.preset;
			} else {
				this.state.preset = select.value as PolicyPreset;
			}
			this.emit();
		});
	}

	private renderOverridesTable(): void {
		const wrapper = this.bodyEl.createDiv({ cls: 'gemini-tool-policy-editor-overrides' });
		wrapper.createEl('h5', { text: 'Per-tool overrides' });

		const tools = this.plugin.toolRegistry?.getAllTools() ?? [];
		if (tools.length === 0) {
			wrapper.createEl('p', { text: 'No tools registered.' });
			return;
		}

		// Group tools by classification so the table mirrors the global-policy UI.
		const byClass = new Map<ToolClassification, Tool[]>();
		for (const tool of tools) {
			const list = byClass.get(tool.classification) ?? [];
			list.push(tool);
			byClass.set(tool.classification, list);
		}

		for (const classification of Object.values(ToolClassification)) {
			const list = byClass.get(classification);
			if (!list || list.length === 0) continue;

			wrapper.createEl('h6', {
				text: CLASSIFICATION_LABELS[classification],
				cls: 'gemini-tool-policy-editor-class-heading',
			});

			for (const tool of list) {
				const row = wrapper.createDiv({ cls: 'gemini-tool-policy-editor-tool-row' });
				row.createEl('span', {
					text: tool.displayName || tool.name,
					cls: 'gemini-tool-policy-editor-tool-name',
				});

				const select = row.createEl('select') as HTMLSelectElement;
				select.add(new Option('(inherit)', INHERIT_OVERRIDE));
				for (const perm of Object.values(ToolPermission)) {
					select.add(new Option(PERMISSION_LABELS[perm], perm));
				}
				select.value = this.state?.overrides?.[tool.name] ?? INHERIT_OVERRIDE;
				select.addEventListener('change', () => {
					if (!this.state) this.state = {};
					if (!this.state.overrides) this.state.overrides = {};
					if (select.value === INHERIT_OVERRIDE) {
						delete this.state.overrides[tool.name];
					} else {
						this.state.overrides[tool.name] = select.value as ToolPermission;
					}
					this.emit();
				});
			}
		}
	}
}
