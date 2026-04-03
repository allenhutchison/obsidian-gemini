import ObsidianGemini from '../main';
import { App, PluginSettingTab, Setting, SettingGroup, Notice, setIcon, SecretComponent } from 'obsidian';
import { selectModelSetting } from './settings-helpers';
import { FolderSuggest } from './folder-suggest';
import { sanitizeKeySegment } from '../mcp/mcp-oauth-provider';
import {
	ToolPermission,
	ToolClassification,
	PolicyPreset,
	PRESET_LABELS,
	PERMISSION_LABELS,
	CLASSIFICATION_LABELS,
	PRESET_PERMISSIONS,
	DEFAULT_TOOL_POLICY,
} from '../types/tool-policy';

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

	/**
	 * Create the Tool Permissions settings section.
	 *
	 * Shows a preset dropdown and per-tool permission dropdowns grouped by classification.
	 */
	private async createToolPermissionsSettings(containerEl: HTMLElement): Promise<void> {
		// Normalize toolPolicy onto the real settings object so handlers can safely write to it
		this.plugin.settings.toolPolicy = {
			activePreset: this.plugin.settings.toolPolicy?.activePreset ?? DEFAULT_TOOL_POLICY.activePreset,
			toolPermissions: { ...(this.plugin.settings.toolPolicy?.toolPermissions ?? {}) },
		};
		const policy = this.plugin.settings.toolPolicy;
		const allTools = this.plugin.toolRegistry?.getAllTools() ?? [];

		// If no tools are registered yet, show a message
		if (allTools.length === 0) {
			new Setting(containerEl)
				.setName('No tools registered')
				.setDesc('Tool permissions will appear here once tools are loaded.');
			return;
		}

		// --- Preset dropdown ---
		new Setting(containerEl)
			.setName('Permission preset')
			.setDesc('Choose a preset that determines default permissions for all tools.')
			.addDropdown((dropdown) => {
				for (const preset of Object.values(PolicyPreset)) {
					dropdown.addOption(preset, PRESET_LABELS[preset]);
				}
				dropdown.setValue(policy.activePreset);
				dropdown.onChange(async (value) => {
					const preset = value as PolicyPreset;

					// YOLO requires confirmation
					if (preset === PolicyPreset.YOLO) {
						const confirmed = await this.showYoloConfirmation();
						if (!confirmed) {
							dropdown.setValue(policy.activePreset);
							return;
						}
					}

					this.plugin.settings.toolPolicy.activePreset = preset;
					if (preset === PolicyPreset.CUSTOM) {
						// Materialize current effective permissions so untouched tools keep their values
						this.plugin.settings.toolPolicy.toolPermissions = Object.fromEntries(
							allTools.map((t) => [t.name, this.plugin.toolRegistry!.getEffectivePermission(t.name)])
						);
					} else {
						// Clear per-tool overrides when switching to a named preset
						this.plugin.settings.toolPolicy.toolPermissions = {};
					}
					await this.plugin.saveSettings();
					this.display();
				});
			});

		// --- Per-tool dropdowns grouped by classification ---
		const classificationOrder: ToolClassification[] = [
			ToolClassification.READ,
			ToolClassification.WRITE,
			ToolClassification.DESTRUCTIVE,
			ToolClassification.EXTERNAL,
		];

		for (const classification of classificationOrder) {
			const toolsInGroup = allTools
				.filter((t) => t.classification === classification)
				.sort((a, b) => a.name.localeCompare(b.name));

			if (toolsInGroup.length === 0) continue;

			const group = new SettingGroup(containerEl).setHeading(CLASSIFICATION_LABELS[classification]);

			for (const tool of toolsInGroup) {
				group.addSetting((setting) => {
					const displayName = tool.displayName || tool.name;
					setting.setName(displayName);

					// toolRegistry is guaranteed non-null — allTools is sourced from it above
					const effectivePermission = this.plugin.toolRegistry!.getEffectivePermission(tool.name);

					setting.addDropdown((dropdown) => {
						for (const perm of Object.values(ToolPermission)) {
							dropdown.addOption(perm, PERMISSION_LABELS[perm]);
						}
						dropdown.setValue(effectivePermission);
						dropdown.onChange(async (value) => {
							const newPerm = value as ToolPermission;
							const presetDefault = PRESET_PERMISSIONS[policy.activePreset][tool.classification];

							if (newPerm === presetDefault) {
								// Remove override — matches preset default
								delete this.plugin.settings.toolPolicy.toolPermissions[tool.name];
							} else {
								// Switching to Custom — materialize all current permissions first
								if (policy.activePreset !== PolicyPreset.CUSTOM) {
									this.plugin.settings.toolPolicy.toolPermissions = Object.fromEntries(
										allTools.map((t) => [t.name, this.plugin.toolRegistry!.getEffectivePermission(t.name)])
									);
									this.plugin.settings.toolPolicy.activePreset = PolicyPreset.CUSTOM;
								}
								// Apply the user's change
								this.plugin.settings.toolPolicy.toolPermissions[tool.name] = newPerm;
							}

							await this.plugin.saveSettings();
							this.display();
						});
					});
				});
			}
		}
	}

	/**
	 * Show YOLO mode confirmation modal.
	 * Returns a Promise that resolves to true if the user confirmed.
	 */
	private showYoloConfirmation(): Promise<boolean> {
		return new Promise((resolve) => {
			const { YoloConfirmationModal } = require('./yolo-confirmation-modal');
			const modal = new YoloConfirmationModal(this.app, (confirmed: boolean) => {
				resolve(confirmed);
			});
			modal.open();
		});
	}

	/**
	 * Create MCP server settings section
	 */
	private async createMCPSettings(containerEl: HTMLElement): Promise<void> {
		new Setting(containerEl).setName('MCP Servers').setHeading();

		new Setting(containerEl)
			.setName('Enable MCP servers')
			.setDesc(
				'Connect to Model Context Protocol servers to extend the agent with external tools. Supports local (stdio) and remote (HTTP) servers.'
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.mcpEnabled).onChange(async (value) => {
					this.plugin.settings.mcpEnabled = value;
					await this.plugin.saveSettings();

					if (value && this.plugin.mcpManager) {
						await this.plugin.mcpManager.connectAllEnabled();
					} else if (!value && this.plugin.mcpManager) {
						await this.plugin.mcpManager.disconnectAll();
					}

					this.display();
				})
			);

		if (!this.plugin.settings.mcpEnabled) return;

		const servers = this.plugin.settings.mcpServers || [];

		if (servers.length === 0) {
			containerEl.createEl('p', {
				text: 'No MCP servers configured. Click "Add Server" to get started.',
				cls: 'setting-item-description',
			});
		} else {
			for (const server of servers) {
				const mcpManager = this.plugin.mcpManager;
				const status = mcpManager?.getServerStatus(server.name);
				const statusText = status?.status || 'disconnected';

				let iconName: string;
				if (status?.status === 'connected') {
					iconName = 'check-circle';
				} else if (status?.status === 'error') {
					iconName = 'alert-circle';
				} else {
					iconName = 'circle';
				}

				const descParts: string[] = [];
				if (server.transport === 'http' && server.url) {
					descParts.push(`HTTP: ${server.url}`);
					// Show OAuth status from SecretStorage
					const oauthKey = `mcp-oauth-tokens-${sanitizeKeySegment(server.name)}`;
					if (this.app.secretStorage.getSecret(oauthKey)) {
						descParts.push('Authorized ✓');
					}
				} else {
					descParts.push(`${server.command} ${server.args.join(' ')}`);
				}
				descParts.push(statusText);

				const setting = new Setting(containerEl).setName(server.name).setDesc(descParts.join(' — '));
				setting.settingEl.addClass('mcp-server-setting');
				setting.descEl.addClass('mcp-server-desc');
				setIcon(setting.nameEl, iconName);

				setting
					.addButton((btn) =>
						btn.setButtonText('Edit').onClick(async () => {
							if (!mcpManager) return;
							const { MCPServerModal } = await import('./mcp-server-modal');
							const oldName = server.name;
							const modal = new MCPServerModal(this.app, mcpManager, server, async (updated) => {
								this.plugin.settings.mcpServers = this.plugin.settings.mcpServers || [];

								// Reject duplicate names (allow keeping the same name)
								if (updated.name !== oldName && this.plugin.settings.mcpServers.some((s) => s.name === updated.name)) {
									new Notice(`A server named "${updated.name}" already exists`);
									return;
								}

								const idx = this.plugin.settings.mcpServers.findIndex((s) => s.name === oldName);
								if (idx >= 0) {
									this.plugin.settings.mcpServers[idx] = updated;
								}
								await this.plugin.saveSettings();

								// Disconnect old name first if it was connected (handles renames)
								if (mcpManager?.isConnected(oldName)) {
									await mcpManager.disconnectServer(oldName);
									if (updated.enabled) {
										try {
											await mcpManager.connectServer(updated);
										} catch (error) {
											new Notice(
												`Failed to reconnect "${updated.name}": ${error instanceof Error ? error.message : error}`
											);
										}
									}
								}

								this.display();
							});
							modal.open();
						})
					)
					.addButton((btn) =>
						btn
							.setButtonText('Delete')
							.setWarning()
							.onClick(async () => {
								// Disconnect first if connected
								if (mcpManager?.isConnected(server.name)) {
									await mcpManager.disconnectServer(server.name);
								}
								this.plugin.settings.mcpServers = this.plugin.settings.mcpServers.filter((s) => s.name !== server.name);
								await this.plugin.saveSettings();
								this.display();
							})
					);
			}
		}

		new Setting(containerEl).addButton((btn) =>
			btn
				.setButtonText('Add Server')
				.setCta()
				.onClick(async () => {
					if (!this.plugin.mcpManager) return;
					const { MCPServerModal } = await import('./mcp-server-modal');
					const modal = new MCPServerModal(this.app, this.plugin.mcpManager, null, async (config) => {
						this.plugin.settings.mcpServers = this.plugin.settings.mcpServers || [];
						// Check for duplicate name
						if (this.plugin.settings.mcpServers.some((s) => s.name === config.name)) {
							new Notice(`A server named "${config.name}" already exists`);
							return;
						}
						this.plugin.settings.mcpServers.push(config);
						await this.plugin.saveSettings();

						// Connect if enabled
						if (config.enabled && this.plugin.mcpManager) {
							try {
								await this.plugin.mcpManager.connectServer(config);
							} catch (error) {
								new Notice(`Server saved but failed to connect: ${error instanceof Error ? error.message : error}`);
							}
						}

						this.display();
					});
					modal.open();
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
			.setDesc(
				'Link your Google Gemini API key. Click "Link..." and Obsidian will ask for a Secret Name (this is just a label — use any name like "gemini-api") and a Secret Value (paste your API key here). Get a key free at https://aistudio.google.com/apikey'
			)
			.addComponent((el) =>
				new SecretComponent(this.app, el)
					.setValue(this.plugin.settings.apiKeySecretName)
					.onChange(async (secretName) => {
						this.plugin.settings.apiKeySecretName = secretName;
						await this.plugin.saveSettings();
					})
			);

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
				new FolderSuggest(this.app, text.inputEl, async (folder) => {
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

		new Setting(containerEl)
			.setName('Always show diff view for file writes')
			.setDesc(
				'Automatically open a diff view when the agent proposes file changes, instead of requiring a button click.'
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.alwaysShowDiffView).onChange(async (value) => {
					this.plugin.settings.alwaysShowDiffView = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('Log tool execution to session history')
			.setDesc(
				'Append a summary of each tool execution to the session history file for auditing. Requires plugin reload to take effect.'
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.logToolExecution).onChange(async (value) => {
					this.plugin.settings.logToolExecution = value;
					await this.plugin.saveSettings();
				})
			);

		// Context Management Settings
		new Setting(containerEl).setName('Context Management').setHeading();

		const thresholdSetting = new Setting(containerEl)
			.setName('Context compaction threshold')
			.setDesc(
				`Automatically summarize older conversation turns when token usage exceeds this percentage of the model context window. Current: ${this.plugin.settings.contextCompactionThreshold}%`
			);

		thresholdSetting.addSlider((slider) =>
			slider
				.setLimits(5, 50, 5)
				.setValue(this.plugin.settings.contextCompactionThreshold)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.contextCompactionThreshold = value;
					thresholdSetting.setDesc(
						`Automatically summarize older conversation turns when token usage exceeds this percentage of the model context window. Current: ${value}%`
					);
					await this.plugin.saveSettings();
				})
		);

		new Setting(containerEl)
			.setName('Show token usage')
			.setDesc('Display estimated token usage in the agent view (for debugging purposes).')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.showTokenUsage).onChange(async (value) => {
					this.plugin.settings.showTokenUsage = value;
					await this.plugin.saveSettings();
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

			// Tool Permissions Settings
			new Setting(containerEl).setName('Tool Permissions').setHeading();

			await this.createToolPermissionsSettings(containerEl);

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

			// MCP Server Settings
			try {
				await this.createMCPSettings(containerEl);
			} catch (error) {
				this.plugin.logger.error(
					'MCP settings rendering error:',
					error instanceof Error ? error.message : String(error)
				);
				new Setting(containerEl)
					.setName('MCP Servers')
					.setDesc(`Error loading MCP settings: ${error instanceof Error ? error.message : String(error)}`);
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
