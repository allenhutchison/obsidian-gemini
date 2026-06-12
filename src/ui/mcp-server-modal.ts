import { App, Modal, Setting, Notice } from 'obsidian';
import { MCPServerConfig, MCP_TRANSPORT_STDIO, MCP_TRANSPORT_HTTP, MCPTransportType } from '../mcp/types';
import { MCPManager } from '../mcp/mcp-manager';
import { ObsidianOAuthClientProvider } from '../mcp/mcp-oauth-provider';
import { resolveServerEnv, writeServerEnv } from '../mcp/mcp-secrets';
import { getRawErrorMessage } from '../utils/error-utils';
import { t } from '../i18n';

/**
 * Modal for adding or editing an MCP server configuration.
 * Includes test connection and discovered tool display.
 * Supports both stdio (local process) and HTTP (remote) transports.
 */
export class MCPServerModal extends Modal {
	private config: MCPServerConfig;
	/** Working copy of the server's env vars. Persisted to SecretStorage on save. */
	private env: Record<string, string> | undefined;
	private mcpManager: MCPManager;
	private onSave: (config: MCPServerConfig) => Promise<void> | void;
	private isEdit: boolean;
	private discoveredTools: string[] = [];
	private discoveredToolsContainer: HTMLElement | null = null;
	private readonly originalServerName: string;

	constructor(
		app: App,
		mcpManager: MCPManager,
		config: MCPServerConfig | null,
		onSave: (config: MCPServerConfig) => Promise<void> | void
	) {
		super(app);
		this.mcpManager = mcpManager;
		this.onSave = onSave;
		this.isEdit = config !== null;
		this.originalServerName = config?.name ?? '';

		// Clone or create default config
		this.config = config
			? {
					...config,
					transport: config.transport ?? MCP_TRANSPORT_STDIO,
					args: [...config.args],
					// Legacy field — kept for migration compatibility, no longer used in UI
					trustedTools: config.trustedTools ? [...config.trustedTools] : [],
				}
			: {
					name: '',
					transport: MCP_TRANSPORT_STDIO,
					command: '',
					args: [],
					url: undefined,
					enabled: true,
					trustedTools: [],
				};

		// Env values live in SecretStorage, not on the config object. Load them
		// into a working copy; writeServerEnv() persists them back on save.
		this.env = config ? resolveServerEnv(app, config) : undefined;

		if (this.isEdit) {
			// Pre-populate from the connected server's tool list if available.
			const serverState = mcpManager.getServerStatus(this.config.name);
			this.discoveredTools = serverState?.toolNames ? [...serverState.toolNames] : [];
		}
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('mcp-server-modal');

		contentEl.createEl('h2', { text: this.isEdit ? t('mcpServer.titleEdit') : t('mcpServer.titleAdd') });

		// Server name
		new Setting(contentEl)
			.setName(t('mcpServer.nameSetting'))
			.setDesc(t('mcpServer.nameDesc'))
			.addText((text) =>
				text
					.setPlaceholder(t('mcpServer.namePlaceholder'))
					.setValue(this.config.name)
					.onChange((value) => {
						this.config.name = value.trim();
					})
			);

		// Transport type selector
		new Setting(contentEl)
			.setName(t('mcpServer.transportSetting'))
			.setDesc(t('mcpServer.transportDesc'))
			.addDropdown((dropdown) =>
				dropdown
					.addOption(MCP_TRANSPORT_STDIO, t('mcpServer.transportStdio'))
					.addOption(MCP_TRANSPORT_HTTP, t('mcpServer.transportHttp'))
					.setValue(this.config.transport ?? MCP_TRANSPORT_STDIO)
					.onChange((value) => {
						this.config.transport = value as MCPTransportType;
						// Re-render to show/hide transport-specific fields
						this.onOpen();
					})
			);

		// Transport-specific fields container
		const isHttp = this.config.transport === MCP_TRANSPORT_HTTP;

		if (isHttp) {
			// HTTP transport: URL field
			new Setting(contentEl)
				.setName(t('mcpServer.urlSetting'))
				.setDesc(t('mcpServer.urlDesc'))
				.addText((text) => {
					text.inputEl.style.width = '30ch';
					text
						.setPlaceholder(t('mcpServer.urlPlaceholder'))
						.setValue(this.config.url || '')
						.onChange((value) => {
							this.config.url = value.trim() || undefined;
						});
				});

			// Clear OAuth credentials (only shown if tokens exist for the original name)
			const oauthProvider = new ObsidianOAuthClientProvider(this.app, this.originalServerName);
			if (oauthProvider.hasTokens()) {
				new Setting(contentEl)
					.setName(t('mcpServer.oauthSetting'))
					.setDesc(t('mcpServer.oauthDesc'))
					.addButton((btn) =>
						btn
							.setButtonText(t('mcpServer.oauthClearButton'))
							.setWarning()
							.onClick(() => {
								oauthProvider.clearAll();
								new Notice(t('mcpServer.oauthClearedNotice'));
								this.onOpen(); // Re-render to hide the button
							})
					);
			}
		} else {
			// Stdio transport: Command, Arguments, Environment

			// Command
			new Setting(contentEl)
				.setName(t('mcpServer.commandSetting'))
				.setDesc(t('mcpServer.commandDesc'))
				.addText((text) => {
					text.inputEl.style.width = '30ch';
					text
						.setPlaceholder(t('mcpServer.commandPlaceholder'))
						.setValue(this.config.command)
						.onChange((value) => {
							this.config.command = value.trim();
						});
				});

			// Arguments
			new Setting(contentEl)
				.setName(t('mcpServer.argsSetting'))
				.setDesc(t('mcpServer.argsDesc'))
				.addTextArea((text) => {
					text.inputEl.rows = 3;
					text.inputEl.cols = 40;
					text
						.setPlaceholder(t('mcpServer.argsPlaceholder'))
						.setValue(this.config.args.join('\n'))
						.onChange((value) => {
							this.config.args = value
								.split('\n')
								.map((a) => a.trim())
								.filter((a) => a.length > 0);
						});
				});

			// Environment variables
			new Setting(contentEl)
				.setName(t('mcpServer.envSetting'))
				.setDesc(t('mcpServer.envDesc'))
				.addTextArea((text) => {
					text.inputEl.rows = 2;
					text.inputEl.cols = 40;
					const envStr = this.env
						? Object.entries(this.env)
								.map(([k, v]) => `${k}=${v}`)
								.join('\n')
						: '';
					text
						.setPlaceholder(t('mcpServer.envPlaceholder'))
						.setValue(envStr)
						.onChange((value) => {
							const entries = value
								.split('\n')
								.map((line) => line.trim())
								.filter((line) => line.includes('='))
								.map((line) => {
									const eqIndex = line.indexOf('=');
									return [line.substring(0, eqIndex).trim(), line.substring(eqIndex + 1).trim()] as [string, string];
								});
							this.env = entries.length > 0 ? Object.fromEntries(entries) : undefined;
						});
				});
		}

		// Enabled toggle
		new Setting(contentEl)
			.setName(t('mcpServer.enabledSetting'))
			.setDesc(t('mcpServer.enabledDesc'))
			.addToggle((toggle) =>
				toggle.setValue(this.config.enabled).onChange((value) => {
					this.config.enabled = value;
				})
			);

		// Test connection button
		const testSetting = new Setting(contentEl).setName(t('mcpServer.testSetting')).setDesc(t('mcpServer.testDesc'));

		testSetting.addButton((button) =>
			button.setButtonText(t('mcpServer.testButton')).onClick(async () => {
				if (isHttp) {
					if (!this.config.url) {
						new Notice(t('mcpServer.urlRequiredFirst'));
						return;
					}
				} else {
					if (!this.config.command) {
						new Notice(t('mcpServer.commandRequiredFirst'));
						return;
					}
				}

				button.setButtonText(t('mcpServer.connecting'));
				button.setDisabled(true);
				testSetting.setDesc(t('mcpServer.connectingDesc'));

				try {
					const tools = await this.mcpManager.queryToolsForConfig(this.config);
					this.discoveredTools = tools;
					testSetting.setDesc(t('mcpServer.connectedDesc', { count: tools.length }));
					this.renderDiscoveredTools();
				} catch (error) {
					const msg = getRawErrorMessage(error);
					testSetting.setDesc(t('mcpServer.connectionFailedDesc', { message: msg }));
				} finally {
					button.setButtonText(t('mcpServer.testButton'));
					button.setDisabled(false);
				}
			})
		);

		// Discovered tools section
		this.discoveredToolsContainer = contentEl.createDiv({ cls: 'mcp-discovered-tools-container' });
		if (this.discoveredTools.length > 0) {
			this.renderDiscoveredTools();
		}

		// Action buttons
		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText(t('mcpServer.cancelButton')).onClick(() => {
					this.close();
				})
			)
			.addButton((btn) =>
				btn
					.setButtonText(t('mcpServer.saveButton'))
					.setCta()
					.onClick(async () => {
						if (!this.config.name) {
							new Notice(t('mcpServer.nameRequired'));
							return;
						}
						if (isHttp) {
							if (!this.config.url) {
								new Notice(t('mcpServer.urlRequired'));
								return;
							}
							// Validate URL
							try {
								new URL(this.config.url);
							} catch {
								new Notice(t('mcpServer.invalidUrl'));
								return;
							}
						} else {
							if (!this.config.command) {
								new Notice(t('mcpServer.commandRequired'));
								return;
							}
							// Persist env vars to SecretStorage; sets config.envSecretName.
							try {
								writeServerEnv(this.app, this.config, this.env);
							} catch (error) {
								new Notice(error instanceof Error ? error.message : t('mcpServer.envStoreFailed'));
								return;
							}
						}
						await this.onSave(this.config);
						this.close();
					})
			);
	}

	private renderDiscoveredTools() {
		if (!this.discoveredToolsContainer) return;
		this.discoveredToolsContainer.empty();

		if (this.discoveredTools.length === 0) return;

		this.discoveredToolsContainer.createEl('h3', { text: t('mcpServer.discoveredToolsTitle') });
		const desc = this.discoveredToolsContainer.createEl('p', {
			text: t('mcpServer.discoveredToolsDesc'),
			cls: 'setting-item-description',
		});
		desc.style.marginBottom = '0.5em';

		const toolList = this.discoveredToolsContainer.createEl('ul');
		for (const toolName of this.discoveredTools) {
			toolList.createEl('li', { text: toolName });
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
