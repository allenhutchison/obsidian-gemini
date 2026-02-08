import ObsidianGemini from '../main';
import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import { selectModelSetting } from './settings-helpers';
import { FolderSuggest } from './folder-suggest';

export default class ObsidianGeminiSettingTab extends PluginSettingTab {
	plugin: InstanceType<typeof ObsidianGemini>;
	private showDeveloperSettings = false;
	private temperatureDebounceTimer: NodeJS.Timeout | null = null;
	private topPDebounceTimer: NodeJS.Timeout | null = null;

	constructor(app: App, plugin: InstanceType<typeof ObsidianGemini>) {
		super(app, plugin);
		this.plugin = plugin;
	}

	private async updateDiscoveryStatus(setting: Setting): Promise<void> {
		try {
			const status = await this.plugin.getModelManager().getDiscoveryStatus();

			if (!status.enabled) {
				setting.setDesc('Model discovery is disabled');
				return;
			}

			if (status.working) {
				const lastUpdate = status.lastUpdate ? new Date(status.lastUpdate).toLocaleString() : 'Never';
				setting.setDesc(`✓ Working - Last update: ${lastUpdate}`);
			} else {
				setting.setDesc(`✗ Not working - ${status.error || 'Unknown error'}`);
			}
		} catch (error) {
			setting.setDesc(`Error checking status: ${error instanceof Error ? error.message : 'Unknown'}`);
		}
	}

	/**
	 * Create temperature setting with dynamic ranges based on model capabilities
	 */
	private async createTemperatureSetting(containerEl: HTMLElement): Promise<void> {
		const modelManager = this.plugin.getModelManager();
		const ranges = await modelManager.getParameterRanges();
		const displayInfo = await modelManager.getParameterDisplayInfo();

		const desc = displayInfo.hasModelData
			? `Controls randomness. Lower values are more deterministic. ${displayInfo.temperature}`
			: 'Controls randomness. Lower values are more deterministic. (Default: 0.7)';

		new Setting(containerEl)
			.setName('Temperature')
			.setDesc(desc)
			.addSlider((slider) =>
				slider
					.setLimits(ranges.temperature.min, ranges.temperature.max, ranges.temperature.step)
					.setValue(this.plugin.settings.temperature)
					.setDynamicTooltip()
					.onChange(async (value) => {
						// Clear previous timeout
						if (this.temperatureDebounceTimer) {
							clearTimeout(this.temperatureDebounceTimer);
						}

						// Set immediate value for responsive UI
						this.plugin.settings.temperature = value;

						// Debounce validation and saving
						this.temperatureDebounceTimer = setTimeout(async () => {
							// Validate the value against model capabilities
							const validation = await modelManager.validateParameters(value, this.plugin.settings.topP);

							if (!validation.temperature.isValid && validation.temperature.adjustedValue !== undefined) {
								slider.setValue(validation.temperature.adjustedValue);
								this.plugin.settings.temperature = validation.temperature.adjustedValue;
								if (validation.temperature.warning) {
									new Notice(validation.temperature.warning);
								}
							}

							await this.plugin.saveSettings();
						}, 300);
					})
			);
	}

	/**
	 * Create topP setting with dynamic ranges based on model capabilities
	 */
	private async createTopPSetting(containerEl: HTMLElement): Promise<void> {
		const modelManager = this.plugin.getModelManager();
		const ranges = await modelManager.getParameterRanges();
		const displayInfo = await modelManager.getParameterDisplayInfo();

		const desc = displayInfo.hasModelData
			? `Controls diversity. Lower values are more focused. ${displayInfo.topP}`
			: 'Controls diversity. Lower values are more focused. (Default: 1)';

		new Setting(containerEl)
			.setName('Top P')
			.setDesc(desc)
			.addSlider((slider) =>
				slider
					.setLimits(ranges.topP.min, ranges.topP.max, ranges.topP.step)
					.setValue(this.plugin.settings.topP)
					.setDynamicTooltip()
					.onChange(async (value) => {
						// Clear previous timeout
						if (this.topPDebounceTimer) {
							clearTimeout(this.topPDebounceTimer);
						}

						// Set immediate value for responsive UI
						this.plugin.settings.topP = value;

						// Debounce validation and saving
						this.topPDebounceTimer = setTimeout(async () => {
							// Validate the value against model capabilities
							const validation = await modelManager.validateParameters(this.plugin.settings.temperature, value);

							if (!validation.topP.isValid && validation.topP.adjustedValue !== undefined) {
								slider.setValue(validation.topP.adjustedValue);
								this.plugin.settings.topP = validation.topP.adjustedValue;
								if (validation.topP.warning) {
									new Notice(validation.topP.warning);
								}
							}

							await this.plugin.saveSettings();
						}, 300);
					})
			);
	}

	async display(): Promise<void> {
		const { containerEl } = this;

		containerEl.empty();

		// Documentation button at the top
		new Setting(containerEl)
			.setName('Documentation')
			.setDesc('View the complete plugin documentation and guides')
			.addButton((button) =>
				button.setButtonText('View Documentation').onClick(() => {
					window.open('https://github.com/allenhutchison/obsidian-gemini/tree/master/docs', '_blank');
				})
			);

		new Setting(containerEl)
			.setName('API Key')
			.setDesc('Your Google Gemini API key. Get one free at https://aistudio.google.com/apikey')
			.addText((text) => {
				text
					.setPlaceholder('Enter your API Key')
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value;
						await this.plugin.saveSettings();
					});
				// Set input width to accommodate at least 40 characters
				text.inputEl.style.width = '40ch';
			});

		// Add note about model version filtering
		new Setting(containerEl)
			.setName('Model Versions')
			.setDesc(
				'ℹ️ Only Gemini 2.5+ models are shown. Older model versions have been deprecated by Google and are no longer supported.'
			)
			.addButton((button) =>
				button.setButtonText('Learn More').onClick(() => {
					window.open('https://ai.google.dev/gemini-api/docs/models/gemini');
				})
			);

		await selectModelSetting(
			containerEl,
			this.plugin,
			'chatModelName',
			'Chat Model',
			'Model used for agent chat sessions, selection rewriting, and web search tools.'
		);
		await selectModelSetting(
			containerEl,
			this.plugin,
			'summaryModelName',
			'Summary Model',
			'Model used for the "Summarize Active File" command that adds summaries to frontmatter.'
		);
		await selectModelSetting(
			containerEl,
			this.plugin,
			'completionsModelName',
			'Completion Model',
			'Model used for IDE-style inline completions as you type in notes.'
		);
		await selectModelSetting(
			containerEl,
			this.plugin,
			'imageModelName',
			'Image Model',
			'Model used for image generation.',
			'image'
		);

		new Setting(containerEl)
			.setName('Summary Frontmatter Key')
			.setDesc('Frontmatter property name where summaries are stored when using "Summarize Active File" command.')
			.addText((text) =>
				text
					.setPlaceholder('summary')
					.setValue(this.plugin.settings.summaryFrontmatterKey)
					.onChange(async (value) => {
						this.plugin.settings.summaryFrontmatterKey = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Your Name')
			.setDesc('Your name used in system instructions so the AI can address you personally in conversations.')
			.addText((text) =>
				text
					.setPlaceholder('Enter your name')
					.setValue(this.plugin.settings.userName)
					.onChange(async (value) => {
						this.plugin.settings.userName = value;
						await this.plugin.saveSettings();
					})
			);

		// Plugin State Folder
		new Setting(containerEl)
			.setName('Plugin State Folder')
			.setDesc(
				'Folder where plugin data is stored. Agent sessions are saved in Agent-Sessions/, custom prompts in Prompts/.'
			)
			.addText((text) => {
				const folderSuggest = new FolderSuggest(this.app, text.inputEl, async (folder) => {
					this.plugin.settings.historyFolder = folder;
					await this.plugin.saveSettings();
				});
				text.setValue(this.plugin.settings.historyFolder);
			});

		// Session History
		new Setting(containerEl).setName('Session History').setHeading();

		new Setting(containerEl)
			.setName('Enable Session History')
			.setDesc(
				'Store agent session history as markdown files in your vault. Sessions are automatically saved in the Agent-Sessions subfolder with auto-generated titles based on conversation content.'
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.chatHistory).onChange(async (value) => {
					this.plugin.settings.chatHistory = value;
					await this.plugin.saveSettings();
				})
			);

		// Note: Migration settings removed in v4.0 - agent-only mode

		// UI Settings
		new Setting(containerEl).setName('UI Settings').setHeading();

		new Setting(containerEl)
			.setName('Enable Streaming')
			.setDesc('Stream AI responses word-by-word as they are generated for a more interactive chat experience.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.streamingEnabled).onChange(async (value) => {
					this.plugin.settings.streamingEnabled = value;
					await this.plugin.saveSettings();
				})
			);

		// A2UI Save Folder Setting
		new Setting(containerEl)
			.setName('A2UI Save Folder')
			.setDesc(
				this.plugin.settings.a2uiSaveFolder
					? `Current: ${this.plugin.settings.a2uiSaveFolder}. Clear to prompt for location next time.`
					: 'Not set. Will prompt for location when saving A2UI content.'
			)
			.addText((text) => {
				const folderSuggest = new FolderSuggest(this.app, text.inputEl, async (folder) => {
					this.plugin.settings.a2uiSaveFolder = folder;
					await this.plugin.saveSettings();
					this.display(); // Refresh to update description
				});
				text.setValue(this.plugin.settings.a2uiSaveFolder || '');
				text.setPlaceholder('Leave empty to prompt on save');
				text.onChange(async (value) => {
					this.plugin.settings.a2uiSaveFolder = value;
					await this.plugin.saveSettings();
				});
			})
			.addButton((button) =>
				button
					.setButtonText('Reset')
					.setTooltip('Clear saved folder to prompt again next time')
					.onClick(async () => {
						this.plugin.settings.a2uiSaveFolder = '';
						await this.plugin.saveSettings();
						this.display();
					})
			);

		// Advanced Settings
		new Setting(containerEl).setName('Advanced Settings').setHeading();

		new Setting(containerEl)
			.setName('Debug Mode')
			.setDesc('Enable debug logging to the console. Useful for troubleshooting.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.debugMode).onChange(async (value) => {
					this.plugin.settings.debugMode = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('Show Advanced Settings')
			.setDesc('Reveal advanced settings for power users.')
			.addButton((button) =>
				button
					.setButtonText(this.showDeveloperSettings ? 'Hide Advanced Settings' : 'Show Advanced Settings')
					.setClass(this.showDeveloperSettings ? 'mod-warning' : 'mod-cta')
					.onClick(() => {
						this.showDeveloperSettings = !this.showDeveloperSettings;
						this.display(); // Refresh to show/hide advanced settings
					})
			);

		// Advanced settings only visible when explicitly enabled
		if (this.showDeveloperSettings) {
			// Custom Prompts Advanced Settings
			new Setting(containerEl).setName('Custom Prompts').setHeading();

			new Setting(containerEl)
				.setName('Allow system prompt override')
				.setDesc(
					'WARNING: Allows custom prompts to completely replace the system prompt. This may break expected functionality.'
				)
				.addToggle((toggle) =>
					toggle.setValue(this.plugin.settings.allowSystemPromptOverride ?? false).onChange(async (value) => {
						this.plugin.settings.allowSystemPromptOverride = value;
						await this.plugin.saveSettings();
					})
				);

			// API Configuration
			new Setting(containerEl).setName('API Configuration').setHeading();

			new Setting(containerEl)
				.setName('Maximum Retries')
				.setDesc('Maximum number of retries when a model request fails.')
				.addText((text) =>
					text
						.setPlaceholder('e.g., 3')
						.setValue(this.plugin.settings.maxRetries.toString())
						.onChange(async (value) => {
							this.plugin.settings.maxRetries = parseInt(value);
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName('Initial Backoff Delay (ms)')
				.setDesc(
					'Initial delay in milliseconds before the first retry. Subsequent retries will use exponential backoff.'
				)
				.addText((text) =>
					text
						.setPlaceholder('e.g., 1000')
						.setValue(this.plugin.settings.initialBackoffDelay.toString())
						.onChange(async (value) => {
							this.plugin.settings.initialBackoffDelay = parseInt(value);
							await this.plugin.saveSettings();
						})
				);

			// Create temperature setting with dynamic ranges
			await this.createTemperatureSetting(containerEl);

			// Create topP setting with dynamic ranges
			await this.createTopPSetting(containerEl);

			// Model Discovery Settings (visible in developer settings)
			new Setting(containerEl).setName('Model Discovery').setHeading();

			new Setting(containerEl)
				.setName('Enable dynamic model discovery')
				.setDesc("Automatically discover and update available Gemini models from Google's API")
				.addToggle((toggle) =>
					toggle.setValue(this.plugin.settings.modelDiscovery.enabled).onChange(async (value) => {
						this.plugin.settings.modelDiscovery.enabled = value;
						await this.plugin.saveSettings();
						this.display(); // Refresh to show/hide dependent settings
					})
				);

			if (this.plugin.settings.modelDiscovery.enabled) {
				new Setting(containerEl)
					.setName('Auto-update interval (hours)')
					.setDesc('How often to check for new models (0 to disable auto-update)')
					.addSlider((slider) =>
						slider
							.setLimits(0, 168, 1) // 0 to 7 days
							.setValue(this.plugin.settings.modelDiscovery.autoUpdateInterval)
							.setDynamicTooltip()
							.onChange(async (value) => {
								this.plugin.settings.modelDiscovery.autoUpdateInterval = value;
								await this.plugin.saveSettings();
							})
					);

				new Setting(containerEl)
					.setName('Fallback to static models')
					.setDesc('Use built-in model list when API discovery fails')
					.addToggle((toggle) =>
						toggle.setValue(this.plugin.settings.modelDiscovery.fallbackToStatic).onChange(async (value) => {
							this.plugin.settings.modelDiscovery.fallbackToStatic = value;
							await this.plugin.saveSettings();
						})
					);

				// Discovery Status and Controls
				const statusSetting = new Setting(containerEl)
					.setName('Discovery status')
					.setDesc('Current status of model discovery');

				// Add refresh button and status display
				statusSetting.addButton((button) =>
					button
						.setButtonText('Refresh models')
						.setTooltip('Manually refresh the model list from Google API')
						.onClick(async () => {
							button.setButtonText('Refreshing...');
							button.setDisabled(true);

							try {
								const result = await this.plugin.getModelManager().refreshModels();

								if (result.success) {
									button.setButtonText('✓ Refreshed');
									// Show results
									const statusText = `Found ${result.modelsFound} models${result.changes ? ' (changes detected)' : ''}`;
									statusSetting.setDesc(`Last refresh: ${new Date().toLocaleTimeString()} - ${statusText}`);
								} else {
									button.setButtonText('✗ Failed');
									statusSetting.setDesc(`Refresh failed: ${result.error || 'Unknown error'}`);
								}
							} catch (error) {
								button.setButtonText('✗ Error');
								statusSetting.setDesc(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
							}

							setTimeout(() => {
								button.setButtonText('Refresh models');
								button.setDisabled(false);
							}, 2000);
						})
				);

				// Show current status
				this.updateDiscoveryStatus(statusSetting);
			}

			// Tool Execution Settings
			new Setting(containerEl).setName('Tool Execution').setHeading();

			new Setting(containerEl)
				.setName('Stop on tool error')
				.setDesc(
					'Stop agent execution when a tool call fails. If disabled, the agent will continue executing subsequent tools.'
				)
				.addToggle((toggle) =>
					toggle.setValue(this.plugin.settings.stopOnToolError).onChange(async (value) => {
						this.plugin.settings.stopOnToolError = value;
						await this.plugin.saveSettings();
					})
				);

			// Trusted Mode Setting
			const trustedModeSetting = new Setting(containerEl)
				.setName('Trusted Mode')
				.setDesc(
					'Allow the agent to create and edit files without confirmation. Destructive operations (delete, move) always require confirmation.'
				);

			trustedModeSetting.descEl.style.color = 'var(--text-warning)';

			trustedModeSetting.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.alwaysAllowReadWrite ?? false).onChange(async (value) => {
					if (value) {
						// Revert toggle until user confirms
						toggle.setValue(false);
						const { TrustedModeConfirmationModal } = await import('./trusted-mode-modal');
						const modal = new TrustedModeConfirmationModal(this.app, async (confirmed) => {
							if (confirmed) {
								toggle.setValue(true);
								this.plugin.settings.alwaysAllowReadWrite = true;
								await this.plugin.saveSettings();
							}
						});
						modal.open();
					} else {
						this.plugin.settings.alwaysAllowReadWrite = value;
						await this.plugin.saveSettings();
					}
				})
			);

			// Tool Loop Detection Settings
			new Setting(containerEl).setName('Tool Loop Detection').setHeading();

			new Setting(containerEl)
				.setName('Enable loop detection')
				.setDesc('Prevent the AI from repeatedly calling the same tool with identical parameters')
				.addToggle((toggle) =>
					toggle.setValue(this.plugin.settings.loopDetectionEnabled).onChange(async (value) => {
						this.plugin.settings.loopDetectionEnabled = value;
						await this.plugin.saveSettings();
						this.display(); // Refresh to show/hide dependent settings
					})
				);

			if (this.plugin.settings.loopDetectionEnabled) {
				new Setting(containerEl)
					.setName('Loop threshold')
					.setDesc('Number of identical tool calls before considering it a loop (default: 3)')
					.addSlider((slider) =>
						slider
							.setLimits(2, 10, 1)
							.setValue(this.plugin.settings.loopDetectionThreshold)
							.setDynamicTooltip()
							.onChange(async (value) => {
								this.plugin.settings.loopDetectionThreshold = value;
								await this.plugin.saveSettings();
							})
					);

				new Setting(containerEl)
					.setName('Time window (seconds)')
					.setDesc('Time window to check for repeated calls (default: 30 seconds)')
					.addSlider((slider) =>
						slider
							.setLimits(10, 120, 5)
							.setValue(this.plugin.settings.loopDetectionTimeWindowSeconds)
							.setDynamicTooltip()
							.onChange(async (value) => {
								this.plugin.settings.loopDetectionTimeWindowSeconds = value;
								await this.plugin.saveSettings();
							})
					);
			}

			// Vault Search Index (RAG) Settings
			new Setting(containerEl).setName('Vault Search Index (Experimental)').setHeading();

			// Privacy warning
			const privacyWarning = containerEl.createDiv({ cls: 'setting-item' });
			privacyWarning.createEl('div', {
				cls: 'setting-item-description',
				text:
					'⚠️ Privacy Notice: Enabling this feature uploads your vault files to Google Cloud for semantic search. ' +
					'Files are processed and stored by Google. Consider excluding folders with sensitive information.',
			});
			privacyWarning.style.marginBottom = '1em';
			privacyWarning.style.color = 'var(--text-warning)';

			new Setting(containerEl)
				.setName('Enable vault indexing')
				.setDesc('Index your vault files for semantic search using Google File Search.')
				.addToggle((toggle) =>
					toggle.setValue(this.plugin.settings.ragIndexing.enabled).onChange(async (value) => {
						if (!value && this.plugin.settings.ragIndexing.fileSearchStoreName) {
							// Revert toggle immediately - will only change if user confirms
							toggle.setValue(true);

							// Show cleanup modal when disabling
							const { RagCleanupModal } = await import('./rag-cleanup-modal');
							const modal = new RagCleanupModal(this.app, async (deleteData) => {
								if (deleteData && this.plugin.ragIndexing) {
									await this.plugin.ragIndexing.deleteFileSearchStore();
								}
								this.plugin.settings.ragIndexing.enabled = false;
								await this.plugin.saveSettings();
								this.display();
							});
							modal.open();
						} else {
							this.plugin.settings.ragIndexing.enabled = value;
							await this.plugin.saveSettings();
							this.display();
						}
					})
				);

			if (this.plugin.settings.ragIndexing.enabled) {
				// Index status
				const indexCount = this.plugin.ragIndexing?.getIndexedFileCount() ?? 0;
				const statusText = this.plugin.settings.ragIndexing.fileSearchStoreName
					? `${indexCount} files indexed`
					: 'Not yet indexed';

				new Setting(containerEl)
					.setName('Index status')
					.setDesc(statusText)
					.addButton((button) =>
						button.setButtonText('Reindex Vault').onClick(async () => {
							if (!this.plugin.ragIndexing) {
								new Notice('RAG indexing service not initialized');
								return;
							}

							button.setButtonText('Indexing...');
							button.setDisabled(true);

							try {
								const result = await this.plugin.ragIndexing.indexVault((progress) => {
									button.setButtonText(`${progress.current}/${progress.total}`);
								});

								new Notice(`Indexed ${result.indexed} files (${result.skipped} skipped, ${result.failed} failed)`);
								this.display();
							} catch (error) {
								new Notice(`Indexing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
							} finally {
								button.setButtonText('Reindex Vault');
								button.setDisabled(false);
							}
						})
					)
					.addButton((button) =>
						button
							.setButtonText('Delete Index')
							.setWarning()
							.onClick(async () => {
								if (!this.plugin.ragIndexing) {
									new Notice('RAG indexing service not initialized');
									return;
								}

								// Show confirmation modal
								const { RagCleanupModal } = await import('./rag-cleanup-modal');
								const modal = new RagCleanupModal(this.app, async (deleteData) => {
									if (deleteData && this.plugin.ragIndexing) {
										button.setButtonText('Deleting...');
										button.setDisabled(true);

										try {
											await this.plugin.ragIndexing.deleteFileSearchStore();
											new Notice('Index deleted. Use "Reindex Vault" to rebuild.');
											this.display();
										} catch (error) {
											new Notice(`Failed to delete index: ${error instanceof Error ? error.message : 'Unknown error'}`);
										} finally {
											button.setButtonText('Delete Index');
											button.setDisabled(false);
										}
									}
								});
								modal.open();
							})
					);

				// Store name setting
				const currentStoreName = this.plugin.settings.ragIndexing.fileSearchStoreName;
				const storeNameSetting = new Setting(containerEl)
					.setName('Search index name')
					.setDesc(
						currentStoreName
							? `Current: ${currentStoreName}. To change, disable indexing and delete the store first.`
							: 'Will be auto-generated on first index, or enter a custom name.'
					);

				if (currentStoreName) {
					// Store exists - show read-only with copy button
					storeNameSetting
						.addText((text) => {
							text.inputEl.style.width = '30ch';
							text.setValue(currentStoreName);
							text.setDisabled(true);
						})
						.addButton((button) =>
							button
								.setButtonText('Copy')
								.setTooltip('Copy store name to clipboard')
								.onClick(async () => {
									await navigator.clipboard.writeText(currentStoreName);
									new Notice('Store name copied to clipboard');
								})
						);
				} else {
					// No store yet - allow editing
					storeNameSetting.addText((text) => {
						text.inputEl.style.width = '30ch';
						text
							.setPlaceholder('Auto-generated if empty')
							.setValue('')
							.onChange(async (value) => {
								const trimmedValue = value.trim();
								if (trimmedValue) {
									this.plugin.settings.ragIndexing.fileSearchStoreName = trimmedValue;
									await this.plugin.saveSettings();
									new Notice('Store name set. Will be used when indexing starts.');
								}
							});
					});
				}

				new Setting(containerEl)
					.setName('Auto-sync changes')
					.setDesc('Automatically update the index when files are created, modified, or deleted.')
					.addToggle((toggle) =>
						toggle.setValue(this.plugin.settings.ragIndexing.autoSync).onChange(async (value) => {
							this.plugin.settings.ragIndexing.autoSync = value;
							await this.plugin.saveSettings();
						})
					);

				new Setting(containerEl)
					.setName('Include attachments')
					.setDesc('Index PDFs and other supported file types in addition to markdown notes. Requires reindexing.')
					.addToggle((toggle) =>
						toggle.setValue(this.plugin.settings.ragIndexing.includeAttachments).onChange(async (value) => {
							this.plugin.settings.ragIndexing.includeAttachments = value;
							await this.plugin.saveSettings();
							new Notice('Attachment setting changed. Reindex vault to apply changes.');
						})
					);

				// Build the list of excluded folders including system folders
				const systemFolders = [this.plugin.settings.historyFolder, '.obsidian'];
				const userFolders = this.plugin.settings.ragIndexing.excludeFolders.filter((f) => !systemFolders.includes(f)); // Remove duplicates with system folders

				new Setting(containerEl)
					.setName('Exclude folders')
					.setDesc(`Always excluded: ${systemFolders.join(', ')}. Add additional folders below (one per line).`)
					.addTextArea((text) => {
						text.inputEl.rows = 4;
						text.inputEl.cols = 30;
						text
							.setPlaceholder('Additional folders to exclude...')
							.setValue(userFolders.join('\n'))
							.onChange(async (value) => {
								// Filter out system folders to prevent confusion
								this.plugin.settings.ragIndexing.excludeFolders = value
									.split('\n')
									.map((f) => f.trim())
									.filter((f) => f.length > 0 && !systemFolders.includes(f));
								await this.plugin.saveSettings();
							});
					});
			}
		}
	}
}
