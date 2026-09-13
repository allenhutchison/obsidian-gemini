import { App, Modal, Setting, DropdownComponent, TFile, TFolder } from 'obsidian';
import { ChatSession, SessionModelConfig } from '../../types/agent';
import { GeminiModel } from '../../models';
import type { ObsidianGemini } from '../../types/plugin';
import { t } from '../../i18n';

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

		// `| undefined` + an explicit `!== undefined` check below: Obsidian's
		// BaseComponent exposes a builder-style `then()` method, which makes
		// DropdownComponent structurally Promise-like, so a bare truthiness test
		// trips @typescript-eslint/no-misused-promises.
		let modelDropdown: DropdownComponent | undefined;
		modelSetting
			.addDropdown((dropdown: DropdownComponent) => {
				modelDropdown = dropdown;

				// Add default option with a special value
				dropdown.addOption('__default__', t('agent.sessionSettings.useDefault'));

				// Add available models
				models.forEach((model: GeminiModel) => {
					dropdown.addOption(model.value, model.label);
				});

				// Set current value
				dropdown.setValue(this.modelConfig.model || '__default__');

				dropdown.onChange(async (value) => {
					if (value === '__default__') {
						delete this.modelConfig.model;
					} else {
						this.modelConfig.model = value;
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
						if (modelDropdown !== undefined) {
							// Update the dropdown value
							modelDropdown.setValue('__default__');
							// Trigger the onChange handler by simulating a change event
							const changeEvent = new Event('change', { bubbles: true });
							modelDropdown.selectEl.dispatchEvent(changeEvent);
						}
					});
			});

		// Prompt template selection
		const promptSetting = new Setting(contentEl)
			.setName(t('agent.sessionSettings.promptTemplate'))
			.setDesc(t('agent.sessionSettings.promptTemplateDesc'));

		// See modelDropdown above: `| undefined` + explicit `!== undefined` avoids a
		// no-misused-promises false positive from BaseComponent's builder `then()`.
		let promptDropdown: DropdownComponent | undefined;
		promptSetting
			.addDropdown((dropdown: DropdownComponent) => {
				promptDropdown = dropdown;

				// Add default option with special value
				dropdown.addOption('__default__', t('agent.sessionSettings.useDefaultPrompt'));

				// Get prompt files
				const promptsFolder = `${this.plugin.settings.historyFolder}/Prompts`;
				const folder = this.plugin.app.vault.getAbstractFileByPath(promptsFolder);

				if (folder && folder instanceof TFolder) {
					const promptFiles = folder.children
						.filter((f): f is TFile => f instanceof TFile && f.extension === 'md')
						.map((f) => f.path);

					promptFiles.forEach((path) => {
						const name = path.split('/').pop()?.replace('.md', '') || path;
						dropdown.addOption(path, name);
					});
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
