import { Setting } from 'obsidian';
import type ObsidianGemini from '../main';
import { ObsidianGeminiSettings } from '../main';
import { GEMINI_MODELS } from '../models';

export interface CollapsibleSectionOptions {
	/** Description shown under the title; visible whether the section is open or closed. */
	description?: string;
	/** When true, render an "Advanced" badge next to the title. */
	advanced?: boolean;
}

/**
 * Render a collapsible settings section using a native `<details>` element.
 * Returns the inner content element; pass it as the container for any
 * `new Setting(...)` calls that belong inside the section.
 *
 * Expand state is persisted in `plugin.settings.expandedSettingsSections`
 * (array of section ids) so collapsed/expanded state survives a reload.
 *
 * Uses plain DOM APIs (not Obsidian's `createEl`/`createDiv` extensions) so
 * the helper is callable in jsdom-based unit tests with a stub container.
 * If `containerEl` lacks `appendChild` (e.g. a test fixture passes `{}`), the
 * helper falls back to returning a detached div so tests that only exercise
 * the inner settings still work.
 */
export function createCollapsibleSection(
	plugin: ObsidianGemini,
	containerEl: HTMLElement,
	title: string,
	id: string,
	options: CollapsibleSectionOptions = {}
): HTMLElement {
	if (typeof (containerEl as { appendChild?: unknown })?.appendChild !== 'function') {
		// Stub container in unit tests — return a detached div so callers can
		// keep passing it to `new Setting(...)` without DOM side-effects.
		return typeof document !== 'undefined' ? document.createElement('div') : (containerEl as HTMLElement);
	}

	const expanded = plugin.settings.expandedSettingsSections ?? [];
	const isOpen = expanded.includes(id);

	const details = document.createElement('details');
	details.classList.add('gemini-settings-section');
	if (options.advanced) details.classList.add('gemini-settings-section--advanced');
	details.dataset.sectionId = id;
	if (isOpen) details.setAttribute('open', '');
	containerEl.appendChild(details);

	const summary = document.createElement('summary');
	summary.classList.add('gemini-settings-section-summary');

	// HTML spec: <summary> only permits phrasing/heading content; <div> isn't
	// valid here. Use <span>s styled with flex/block via CSS instead.
	const header = document.createElement('span');
	header.classList.add('gemini-settings-section-header');
	const titleRow = document.createElement('span');
	titleRow.classList.add('gemini-settings-section-title-row');
	const titleEl = document.createElement('span');
	titleEl.classList.add('gemini-settings-section-title');
	titleEl.textContent = title;
	titleRow.appendChild(titleEl);
	if (options.advanced) {
		const badge = document.createElement('span');
		badge.classList.add('gemini-settings-section-badge');
		badge.textContent = 'Advanced';
		titleRow.appendChild(badge);
	}
	header.appendChild(titleRow);
	if (options.description) {
		const descEl = document.createElement('span');
		descEl.classList.add('gemini-settings-section-description');
		descEl.textContent = options.description;
		header.appendChild(descEl);
	}
	summary.appendChild(header);
	details.appendChild(summary);

	const content = document.createElement('div');
	content.classList.add('gemini-settings-section-content');
	details.appendChild(content);

	details.addEventListener('toggle', async () => {
		const current = plugin.settings.expandedSettingsSections ?? [];
		const next = details.open ? Array.from(new Set([...current, id])) : current.filter((x) => x !== id);
		// Skip the save if nothing actually changed (e.g. a programmatic toggle that
		// fires after setAttribute('open') without altering the user's persisted set).
		if (next.length === current.length && next.every((x, i) => x === current[i])) return;
		plugin.settings.expandedSettingsSections = next;
		// Persist directly via saveData rather than saveSettings — this is UI-only
		// state and shouldn't trigger plugin.saveSettings()'s lifecycle reconciliation
		// (re-init on api-key/provider/RAG changes).
		try {
			await plugin.saveData(plugin.settings);
		} catch (error) {
			plugin.logger.error('Failed to save expandedSettingsSections:', error);
		}
	});

	return content;
}

/**
 * Render an always-open settings section header (used for "General"). Returns
 * the inner content element; visually matches the collapsibles minus chevron.
 */
export function createAlwaysOpenSection(containerEl: HTMLElement, title: string, description?: string): HTMLElement {
	if (typeof (containerEl as { appendChild?: unknown })?.appendChild !== 'function') {
		return typeof document !== 'undefined' ? document.createElement('div') : (containerEl as HTMLElement);
	}

	const wrapper = document.createElement('div');
	wrapper.classList.add('gemini-settings-section', 'gemini-settings-section--always-open');
	containerEl.appendChild(wrapper);

	// Use spans here too for parity with the collapsible variant (where the
	// elements live inside <summary> and must be phrasing content).
	const header = document.createElement('span');
	header.classList.add('gemini-settings-section-header');
	const titleRow = document.createElement('span');
	titleRow.classList.add('gemini-settings-section-title-row');
	const titleEl = document.createElement('span');
	titleEl.classList.add('gemini-settings-section-title');
	titleEl.textContent = title;
	titleRow.appendChild(titleEl);
	header.appendChild(titleRow);
	if (description) {
		const descEl = document.createElement('span');
		descEl.classList.add('gemini-settings-section-description');
		descEl.textContent = description;
		header.appendChild(descEl);
	}
	wrapper.appendChild(header);

	const content = document.createElement('div');
	content.classList.add('gemini-settings-section-content');
	wrapper.appendChild(content);

	return content;
}

export async function selectModelSetting(
	containerEl: HTMLElement,
	plugin: ObsidianGemini,
	settingName: NonNullable<
		{
			// Reverse `extends` so we only match keys whose type is the broad
			// `string` (e.g. `chatModelName`), not literal unions like
			// `provider: 'gemini' | 'ollama'` which would otherwise pass the
			// forward-extends check and break the assignment below.
			[K in keyof ObsidianGeminiSettings]: string extends ObsidianGeminiSettings[K] ? K : never;
		}[keyof ObsidianGeminiSettings]
	>,
	label: string,
	description: string,
	role: 'text' | 'image' = 'text'
) {
	let availableModels: import('../models').GeminiModel[];

	const manager = plugin.getModelManager?.();
	if (manager) {
		if (role === 'image') {
			availableModels = await manager.getImageGenerationModels();
		} else {
			availableModels = await manager.getAvailableModels();
		}
	} else {
		// Fallback: role-aware filter on the bundled GEMINI_MODELS
		availableModels =
			role === 'image'
				? GEMINI_MODELS.filter((m) => m.supportsImageGeneration)
				: GEMINI_MODELS.filter((m) => !m.supportsImageGeneration);
	}

	plugin.logger.debug(
		`selectModelSetting for ${label} (role=${role}): Found ${availableModels.length} models`,
		availableModels.map((m) => m.value)
	);

	new Setting(containerEl)
		.setName(label)
		.setDesc(description)
		.addDropdown((dropdown) => {
			// Add all models from the available list
			availableModels.forEach((model) => {
				dropdown.addOption(model.value, model.label);
			});

			// Get current setting value
			const currentValue = String((plugin.settings as ObsidianGeminiSettings)[settingName]);

			// Check if current value exists in available models
			const valueExists = availableModels.some((m) => m.value === currentValue);

			// If value doesn't exist in options, use first available model
			if (!valueExists && availableModels.length > 0) {
				const defaultValue = availableModels[0].value;
				plugin.logger.warn(
					`${label}: Current value "${currentValue}" not found in available models. Defaulting to "${defaultValue}"`
				);
				(plugin.settings as ObsidianGeminiSettings)[settingName] = defaultValue;
				dropdown.setValue(defaultValue);
				// Save the corrected setting
				plugin.saveSettings().catch((e) => plugin.logger.error(`Failed to save corrected ${label} setting:`, e));
			} else {
				dropdown.setValue(currentValue);
			}

			dropdown.onChange(async (value) => {
				(plugin.settings as ObsidianGeminiSettings)[settingName] = value;
				await plugin.saveSettings();
			});
			return dropdown;
		});
}
