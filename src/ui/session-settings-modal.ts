import { Modal, Setting, DropdownComponent, SliderComponent, TFile, TFolder } from 'obsidian';
import { ChatSession, SessionModelConfig } from '../types/agent';
import type ObsidianGemini from '../main';

export class SessionSettingsModal extends Modal {
	private plugin: InstanceType<typeof ObsidianGemini>;
	private session: ChatSession;
	private onSave: (config: SessionModelConfig) => Promise<void>;
	private modelConfig: SessionModelConfig;

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
		this.modelConfig = { ...session.modelConfig } || {};
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Session Settings' });

		// Get available models first
		const models = await this.plugin.getModelManager().getAvailableModels();

		// Model selection
		new Setting(contentEl)
			.setName('Model')
			.setDesc('Select the AI model for this session')
			.addDropdown((dropdown: DropdownComponent) => {
				// Add default option
				dropdown.addOption('', 'Use default');
				
				// Add available models
				models.forEach((model: any) => {
					dropdown.addOption(model.value, model.label);
				});
				
				// Set current value
				dropdown.setValue(this.modelConfig.model || '');
				
				dropdown.onChange(async (value) => {
					if (value === '') {
						delete this.modelConfig.model;
					} else {
						this.modelConfig.model = value;
					}
				});
			});

		// Temperature slider
		new Setting(contentEl)
			.setName('Temperature')
			.setDesc('Controls randomness (0 = deterministic, 2 = very creative)')
			.addSlider((slider: SliderComponent) => {
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
					.onClick(() => {
						const slider = contentEl.querySelector('.temperature-slider input') as HTMLInputElement;
						if (slider) {
							slider.value = this.plugin.settings.temperature.toString();
							slider.dispatchEvent(new Event('input'));
							slider.dispatchEvent(new Event('change'));
						}
						delete this.modelConfig.temperature;
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
					.onClick(() => {
						const slider = contentEl.querySelector('.top-p-slider input') as HTMLInputElement;
						if (slider) {
							slider.value = this.plugin.settings.topP.toString();
							slider.dispatchEvent(new Event('input'));
							slider.dispatchEvent(new Event('change'));
						}
						delete this.modelConfig.topP;
					});
			});

		// Add top-p value display
		const topPValueEl = contentEl.createDiv({ cls: 'top-p-value' });
		topPValueEl.textContent = (this.modelConfig.topP ?? this.plugin.settings.topP).toFixed(2);

		// Prompt template selection
		new Setting(contentEl)
			.setName('Prompt Template')
			.setDesc('Select a custom prompt template for this session')
			.addDropdown(async (dropdown: DropdownComponent) => {
				// Add default option
				dropdown.addOption('', 'Use default prompt');
				
				// Get prompt files
				const promptsFolder = `${this.plugin.settings.historyFolder}/Prompts`;
				const folder = this.plugin.app.vault.getAbstractFileByPath(promptsFolder);
				
				if (folder && folder instanceof TFolder) {
					const promptFiles = folder.children
						.filter((f): f is TFile => f instanceof TFile && f.extension === 'md')
						.map(f => f.path);
					
					promptFiles.forEach(path => {
						const name = path.split('/').pop()?.replace('.md', '') || path;
						dropdown.addOption(path, name);
					});
				}
				
				// Set current value
				dropdown.setValue(this.modelConfig.promptTemplate || '');
				
				dropdown.onChange(async (value) => {
					if (value === '') {
						delete this.modelConfig.promptTemplate;
					} else {
						this.modelConfig.promptTemplate = value;
					}
				});
			});

		// Info section
		contentEl.createDiv({ 
			text: 'These settings override the global defaults for this session only.',
			cls: 'setting-item-description'
		});

		// Buttons
		const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
		
		// Cancel button
		buttonContainer.createEl('button', {
			text: 'Cancel',
			cls: 'mod-cancel'
		}).addEventListener('click', () => {
			this.close();
		});
		
		// Save button
		buttonContainer.createEl('button', {
			text: 'Save',
			cls: 'mod-cta'
		}).addEventListener('click', async () => {
			await this.onSave(this.modelConfig);
			this.close();
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}