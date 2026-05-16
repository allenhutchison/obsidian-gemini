import { App, Modal, Setting, Notice } from 'obsidian';
import { MCPServerConfig, MCP_TRANSPORT_STDIO, MCP_TRANSPORT_HTTP, MCPTransportType } from '../mcp/types';
import { MCPManager } from '../mcp/mcp-manager';
import { ObsidianOAuthClientProvider } from '../mcp/mcp-oauth-provider';
import { resolveServerEnv, writeServerEnv } from '../mcp/mcp-secrets';

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

		contentEl.createEl('h2', { text: this.isEdit ? 'Edit MCP Server' : 'Add MCP Server' });

		// Server name
		new Setting(contentEl)
			.setName('Server name')
			.setDesc('A unique, friendly name for this server')
			.addText((text) =>
				text
					.setPlaceholder('e.g., filesystem')
					.setValue(this.config.name)
					.onChange((value) => {
						this.config.name = value.trim();
					})
			);

		// Transport type selector
		new Setting(contentEl)
			.setName('Transport')
			.setDesc('How to connect to the server: local process (stdio) or remote URL (HTTP)')
			.addDropdown((dropdown) =>
				dropdown
					.addOption(MCP_TRANSPORT_STDIO, 'Stdio (local process)')
					.addOption(MCP_TRANSPORT_HTTP, 'HTTP (remote server)')
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
				.setName('Server URL')
				.setDesc('The HTTP endpoint of the MCP server')
				.addText((text) => {
					text.inputEl.style.width = '30ch';
					text
						.setPlaceholder('e.g., http://localhost:3000/mcp')
						.setValue(this.config.url || '')
						.onChange((value) => {
							this.config.url = value.trim() || undefined;
						});
				});

			// Clear OAuth credentials (only shown if tokens exist for the original name)
			const oauthProvider = new ObsidianOAuthClientProvider(this.app, this.originalServerName);
			if (oauthProvider.hasTokens()) {
				new Setting(contentEl)
					.setName('OAuth credentials')
					.setDesc('Server has stored OAuth tokens')
					.addButton((btn) =>
						btn
							.setButtonText('Clear credentials')
							.setWarning()
							.onClick(() => {
								oauthProvider.clearAll();
								new Notice('OAuth credentials cleared. You will need to re-authorize.');
								this.onOpen(); // Re-render to hide the button
							})
					);
			}
		} else {
			// Stdio transport: Command, Arguments, Environment

			// Command
			new Setting(contentEl)
				.setName('Command')
				.setDesc('The command to spawn the MCP server process')
				.addText((text) => {
					text.inputEl.style.width = '30ch';
					text
						.setPlaceholder('e.g., npx, python, /usr/local/bin/mcp-server')
						.setValue(this.config.command)
						.onChange((value) => {
							this.config.command = value.trim();
						});
				});

			// Arguments
			new Setting(contentEl)
				.setName('Arguments')
				.setDesc('Command arguments, one per line')
				.addTextArea((text) => {
					text.inputEl.rows = 3;
					text.inputEl.cols = 40;
					text
						.setPlaceholder('e.g.,\n-y\n@modelcontextprotocol/server-filesystem\n/path/to/folder')
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
				.setName('Environment variables')
				.setDesc('Optional KEY=VALUE pairs, one per line. Values are stored in your OS keychain, not in plaintext.')
				.addTextArea((text) => {
					text.inputEl.rows = 2;
					text.inputEl.cols = 40;
					const envStr = this.env
						? Object.entries(this.env)
								.map(([k, v]) => `${k}=${v}`)
								.join('\n')
						: '';
					text
						.setPlaceholder('e.g., API_KEY=abc123')
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
			.setName('Enabled')
			.setDesc('Connect to this server when the plugin loads')
			.addToggle((toggle) =>
				toggle.setValue(this.config.enabled).onChange((value) => {
					this.config.enabled = value;
				})
			);

		// Test connection button
		const testSetting = new Setting(contentEl)
			.setName('Test connection')
			.setDesc('Connect temporarily to discover available tools');

		testSetting.addButton((button) =>
			button.setButtonText('Test Connection').onClick(async () => {
				if (isHttp) {
					if (!this.config.url) {
						new Notice('Please enter a URL first');
						return;
					}
				} else {
					if (!this.config.command) {
						new Notice('Please enter a command first');
						return;
					}
				}

				button.setButtonText('Connecting...');
				button.setDisabled(true);
				testSetting.setDesc('Connecting to server...');

				try {
					const tools = await this.mcpManager.queryToolsForConfig(this.config);
					this.discoveredTools = tools;
					testSetting.setDesc(`Connected successfully! Found ${tools.length} tool(s).`);
					this.renderDiscoveredTools();
				} catch (error) {
					const msg = error instanceof Error ? error.message : String(error);
					testSetting.setDesc(`Connection failed: ${msg}`);
				} finally {
					button.setButtonText('Test Connection');
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
				btn.setButtonText('Cancel').onClick(() => {
					this.close();
				})
			)
			.addButton((btn) =>
				btn
					.setButtonText('Save')
					.setCta()
					.onClick(async () => {
						if (!this.config.name) {
							new Notice('Server name is required');
							return;
						}
						if (isHttp) {
							if (!this.config.url) {
								new Notice('Server URL is required for HTTP transport');
								return;
							}
							// Validate URL
							try {
								new URL(this.config.url);
							} catch {
								new Notice('Invalid URL format');
								return;
							}
						} else {
							if (!this.config.command) {
								new Notice('Command is required for stdio transport');
								return;
							}
							// Persist env vars to SecretStorage; sets config.envSecretName.
							writeServerEnv(this.app, this.config, this.env);
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

		this.discoveredToolsContainer.createEl('h3', { text: 'Discovered Tools' });
		const desc = this.discoveredToolsContainer.createEl('p', {
			text: 'These tools were discovered on the server. Manage their permissions in the Tool Permissions settings.',
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
