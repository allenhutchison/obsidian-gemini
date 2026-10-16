import { App, ButtonComponent, Modal, Setting, DropdownComponent } from 'obsidian';
import { ChatSession, SessionModelConfig } from '../../types/agent';
import { GeminiModel } from '../../models';
import type { ObsidianGemini } from '../../types/plugin';
import { t } from '../../i18n';
import { STATE_SUBFOLDERS, stateFolderPath } from '../../services/state-folder';
import { ModelPickerModal, orderModelPickerOptions } from '../components/model-picker-modal';

/**
 * Options for the session prompt-template dropdown. Prompts can live in subfolders, so each is
 * labelled by its path relative to the prompts folder. A session's current template is kept
 * selectable even when it no longer qualifies (e.g. since tagged as a selection prompt), so the
 * dropdown doesn't misreport the session as using the default.
 */
export function buildPromptTemplateOptions(
	promptPaths: string[],
	promptsFolder: string,
	currentTemplate: string | undefined
): { path: string; label: string }[] {
	const stripMd = (p: string) => p.replace(/\.md$/, '');
	const options = promptPaths
		.map((path) => ({ path, label: stripMd(path.slice(promptsFolder.length + 1)) }))
		.sort((a, b) => a.label.localeCompare(b.label));
	if (currentTemplate && !options.some((o) => o.path === currentTemplate)) {
		options.push({ path: currentTemplate, label: stripMd(currentTemplate.split('/').pop() || currentTemplate) });
	}
	return options;
}

export class SessionSettingsModal extends Modal {
	private plugin: ObsidianGemini;
	private onSave: (config: SessionModelConfig) => Promise<void>;
	private modelConfig: SessionModelConfig;

	constructor(
		app: App,
		plugin: ObsidianGemini,
		session: ChatSession,
		onSave: (config: SessionModelConfig) => Promise<void>
	) {
		super(app);
		this.plugin = plugin;
		this.onSave = onSave;
		// Clone current config or create new
		this.modelConfig = session.modelConfig ? { ...session.modelConfig } : {};
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: t('agent.menu.sessionSettings') });

		// Get available models first
		const models = await this.plugin.getModelManager().getAvailableModels();

		// Model selection
		const modelSetting = new Setting(contentEl)
			.setName(t('agent.sessionSettings.model'))
			.setDesc(t('agent.sessionSettings.modelDesc'));

		// A button opening the fuzzy-search picker rather than a native dropdown:
		// an aggregator endpoint can list hundreds of models.
		const defaultOption = { value: '', label: t('agent.sessionSettings.useDefault') };
		const modelLabel = (value: string | undefined): string =>
			value ? (models.find((m) => m.value === value)?.label ?? value) : defaultOption.label;
		// `| undefined` + an explicit `!== undefined` check below: Obsidian's
		// BaseComponent exposes a builder-style `then()` method, which makes
		// ButtonComponent structurally Promise-like, so a bare truthiness test
		// trips @typescript-eslint/no-misused-promises.
		let modelButton: ButtonComponent | undefined;
		const setModel = async (value: string) => {
			if (value) {
				this.modelConfig.model = value;
			} else {
				delete this.modelConfig.model;
			}
			if (modelButton !== undefined) modelButton.setButtonText(modelLabel(value));
			// Save immediately
			await this.saveConfig();
		};
		modelSetting
			.addButton((button: ButtonComponent) => {
				modelButton = button;
				button.buttonEl.addClass('gemini-model-picker-button');
				button.setButtonText(modelLabel(this.modelConfig.model)).onClick(() => {
					const options = orderModelPickerOptions(
						defaultOption,
						models.map((model: GeminiModel) => ({ value: model.value, label: model.label }))
					);
					new ModelPickerModal(this.app, options, (value) => void setModel(value)).open();
				});
			})
			.addExtraButton((button) => {
				button
					.setIcon('reset')
					.setTooltip(t('agent.sessionSettings.resetToDefault'))
					.onClick(() => void setModel(''));
			});

		// Prompt template selection
		const promptSetting = new Setting(contentEl)
			.setName(t('agent.sessionSettings.promptTemplate'))
			.setDesc(t('agent.sessionSettings.promptTemplateDesc'));

		// See modelButton above: `| undefined` + explicit `!== undefined` avoids a
		// no-misused-promises false positive from BaseComponent's builder `then()`.
		let promptDropdown: DropdownComponent | undefined;
		promptSetting
			.addDropdown((dropdown: DropdownComponent) => {
				promptDropdown = dropdown;

				// Add default option with special value
				dropdown.addOption('__default__', t('agent.sessionSettings.useDefaultPrompt'));

				// Session prompts only: selection-tagged prompts belong to the "Apply prompt..." menu.
				const options = buildPromptTemplateOptions(
					this.plugin.promptManager.listSessionPromptFiles().map((file) => file.path),
					stateFolderPath(this.plugin.settings, STATE_SUBFOLDERS.prompts),
					this.modelConfig.promptTemplate
				);
				for (const { path, label } of options) {
					dropdown.addOption(path, label);
				}

				// Set current value
				dropdown.setValue(this.modelConfig.promptTemplate || '__default__');

				dropdown.onChange(async (value) => {
					if (value === '__default__') {
						delete this.modelConfig.promptTemplate;
					} else {
						this.modelConfig.promptTemplate = value;
					}
					// Save immediately
					await this.saveConfig();
				});
			})
			.addExtraButton((button) => {
				button
					.setIcon('reset')
					.setTooltip(t('agent.sessionSettings.resetToDefault'))
					.onClick(() => {
						if (promptDropdown !== undefined) {
							// Update the dropdown value
							promptDropdown.setValue('__default__');
							// Trigger the onChange handler by simulating a change event
							const changeEvent = new Event('change', { bubbles: true });
							promptDropdown.selectEl.dispatchEvent(changeEvent);
						}
					});
			});

		// Info section
		contentEl.createDiv({
			text: t('agent.sessionSettings.info'),
			cls: 'setting-item-description',
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}

	private async saveConfig() {
		// Create a clean config object with only defined values
		const cleanConfig: SessionModelConfig = {};

		// Check each property - if it exists and is not undefined, include it
		// The delete operations ensure these properties don't exist when set to default
		if (this.modelConfig.model !== undefined) {
			cleanConfig.model = this.modelConfig.model;
		}
		if (this.modelConfig.promptTemplate !== undefined) {
			cleanConfig.promptTemplate = this.modelConfig.promptTemplate;
		}

		await this.onSave(cleanConfig);
	}
}
