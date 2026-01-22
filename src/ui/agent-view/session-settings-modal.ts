import { Modal, Setting, DropdownComponent, SliderComponent, TFile, TFolder } from 'obsidian';
import { ChatSession, SessionModelConfig } from '../../types/agent';
import type ObsidianGemini from '../../main';

export class SessionSettingsModal extends Modal {
	private plugin: InstanceType<typeof ObsidianGemini>;
	private session: ChatSession;
	private onSave: (config: SessionModelConfig) => Promise<void>;
	private modelConfig: SessionModelConfig;
	private tempSlider: SliderComponent | null = null;
	private topPSlider: SliderComponent | null = null;

	constructor(
		app: any,
		plugin: InstanceType<typeof ObsidianGemini>,
		session: ChatSession,
		onSave: (config: SessionModelConfig) => Promise<void>
	) {
		super(app);
		this.plugin = plugin;
		this.session = session;
		this.onSave = onSave;
		// Clone current config or create new
		this.modelConfig = session.modelConfig ? { ...session.modelConfig } : {};
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Session Settings' });

		// Get available models first
		const models = await this.plugin.getModelManager().getAvailableModels();

		// Model selection
		const modelSetting = new Setting(contentEl).setName('Model').setDesc('Select the AI model for this session');

		let modelDropdown: DropdownComponent;
		modelSetting
			.addDropdown((dropdown: DropdownComponent) => {
				modelDropdown = dropdown;

				// Add default option with a special value
				dropdown.addOption('__default__', 'Use default');

				// Add available models
				models.forEach((model: any) => {
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
					.setTooltip('Reset to default')
					.onClick(async () => {
						if (modelDropdown) {
							// Update the dropdown value
							modelDropdown.setValue('__default__');
							// Trigger the onChange handler by simulating a change event
							const changeEvent = new Event('change', { bubbles: true });
							modelDropdown.selectEl.dispatchEvent(changeEvent);
						}
					});
			});

		// Temperature slider
		new Setting(contentEl)
			.setName('Temperature')
			.setDesc('Controls randomness (0 = deterministic, 2 = very creative)')
			.addSlider((slider: SliderComponent) => {
				this.tempSlider = slider;
				const defaultTemp = this.plugin.settings.temperature;
				const currentTemp = this.modelConfig.temperature ?? defaultTemp;

				slider
					.setLimits(0, 2, 0.1)
					.setValue(currentTemp)
					.setDynamicTooltip()
					.onChange(async (value) => {
						// Only save if different from default
						if (value !== defaultTemp) {
							this.modelConfig.temperature = value;
						} else {
							delete this.modelConfig.temperature;
						}
						// Save immediately
						await this.saveConfig();
					});

				// Show current value
				slider.sliderEl.addEventListener('input', () => {
					const valueEl = contentEl.querySelector('.temperature-value');
					if (valueEl) {
						valueEl.textContent = slider.getValue().toFixed(1);
					}
				});
			})
			.addExtraButton((button) => {
				button
					.setIcon('reset')
					.setTooltip('Reset to default')
					.onClick(async () => {
						if (this.tempSlider) {
							// Set to default value - this will trigger onChange
							this.tempSlider.setValue(this.plugin.settings.temperature);
						}
					});
			});

		// Add temperature value display
		const tempValueEl = contentEl.createDiv({ cls: 'temperature-value' });
		tempValueEl.textContent = (this.modelConfig.temperature ?? this.plugin.settings.temperature).toFixed(1);

		// Top-P slider
		new Setting(contentEl)
			.setName('Top-P')
			.setDesc('Nucleus sampling threshold (0 = only top token, 1 = all tokens)')
			.addSlider((slider: SliderComponent) => {
				this.topPSlider = slider;
				const defaultTopP = this.plugin.settings.topP;
				const currentTopP = this.modelConfig.topP ?? defaultTopP;

				slider
					.setLimits(0, 1, 0.05)
					.setValue(currentTopP)
					.setDynamicTooltip()
					.onChange(async (value) => {
						// Only save if different from default
						if (value !== defaultTopP) {
							this.modelConfig.topP = value;
						} else {
							delete this.modelConfig.topP;
						}
						// Save immediately
						await this.saveConfig();
					});

				// Show current value
				slider.sliderEl.addEventListener('input', () => {
					const valueEl = contentEl.querySelector('.top-p-value');
					if (valueEl) {
						valueEl.textContent = slider.getValue().toFixed(2);
					}
				});
			})
			.addExtraButton((button) => {
				button
					.setIcon('reset')
					.setTooltip('Reset to default')
					.onClick(async () => {
						if (this.topPSlider) {
							// Set to default value - this will trigger onChange
							this.topPSlider.setValue(this.plugin.settings.topP);
						}
					});
			});

		// Add top-p value display
		const topPValueEl = contentEl.createDiv({ cls: 'top-p-value' });
		topPValueEl.textContent = (this.modelConfig.topP ?? this.plugin.settings.topP).toFixed(2);

		// Prompt template selection
		const promptSetting = new Setting(contentEl)
			.setName('Prompt Template')
			.setDesc('Select a custom prompt template for this session');

		let promptDropdown: DropdownComponent;
		promptSetting
			.addDropdown((dropdown: DropdownComponent) => {
				promptDropdown = dropdown;

				// Add default option with special value
				dropdown.addOption('__default__', 'Use default prompt');

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
					.setTooltip('Reset to default')
					.onClick(async () => {
						if (promptDropdown) {
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
			text: 'These settings override the global defaults for this session only. Changes are saved automatically.',
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
		if (this.modelConfig.temperature !== undefined) {
			cleanConfig.temperature = this.modelConfig.temperature;
		}
		if (this.modelConfig.topP !== undefined) {
			cleanConfig.topP = this.modelConfig.topP;
		}
		if (this.modelConfig.promptTemplate !== undefined) {
			cleanConfig.promptTemplate = this.modelConfig.promptTemplate;
		}

		await this.onSave(cleanConfig);
	}
}
