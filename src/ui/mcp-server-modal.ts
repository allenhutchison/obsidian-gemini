import { App, Modal, Setting, Notice } from 'obsidian';
import { MCPServerConfig } from '../mcp/types';
import { MCPManager } from '../mcp/mcp-manager';

/**
 * Modal for adding or editing an MCP server configuration.
 * Includes test connection and per-tool trust settings.
 */
export class MCPServerModal extends Modal {
	private config: MCPServerConfig;
	private mcpManager: MCPManager;
	private onSave: (config: MCPServerConfig) => void;
	private isEdit: boolean;
	private discoveredTools: string[] = [];
	private toolTrustContainer: HTMLElement | null = null;

	constructor(
		app: App,
		mcpManager: MCPManager,
		config: MCPServerConfig | null,
		onSave: (config: MCPServerConfig) => void
	) {
		super(app);
		this.mcpManager = mcpManager;
		this.onSave = onSave;
		this.isEdit = config !== null;

		// Clone or create default config
		this.config = config
			? { ...config, args: [...config.args], trustedTools: [...config.trustedTools], env: config.env ? { ...config.env } : undefined }
			: {
					name: '',
					command: '',
					args: [],
					env: undefined,
					enabled: true,
					trustedTools: [],
				};

		if (this.isEdit) {
			this.discoveredTools = [...this.config.trustedTools];
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
			.setDesc('Optional KEY=VALUE pairs, one per line')
			.addTextArea((text) => {
				text.inputEl.rows = 2;
				text.inputEl.cols = 40;
				const envStr = this.config.env
					? Object.entries(this.config.env)
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
						this.config.env = entries.length > 0 ? Object.fromEntries(entries) : undefined;
					});
			});

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
		const testSetting = new Setting(contentEl).setName('Test connection').setDesc('Connect temporarily to discover available tools');

		testSetting.addButton((button) =>
			button.setButtonText('Test Connection').onClick(async () => {
				if (!this.config.command) {
					new Notice('Please enter a command first');
					return;
				}

				button.setButtonText('Connecting...');
				button.setDisabled(true);
				testSetting.setDesc('Connecting to server...');

				try {
					const tools = await this.mcpManager.queryToolsForConfig(this.config);
					this.discoveredTools = tools;
					testSetting.setDesc(`Connected successfully! Found ${tools.length} tool(s).`);
					this.renderToolTrust(contentEl);
				} catch (error) {
					const msg = error instanceof Error ? error.message : String(error);
					testSetting.setDesc(`Connection failed: ${msg}`);
				} finally {
					button.setButtonText('Test Connection');
					button.setDisabled(false);
				}
			})
		);

		// Tool trust section placeholder
		this.toolTrustContainer = contentEl.createDiv({ cls: 'mcp-tool-trust-container' });
		if (this.discoveredTools.length > 0) {
			this.renderToolTrust(contentEl);
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
					.onClick(() => {
						if (!this.config.name) {
							new Notice('Server name is required');
							return;
						}
						if (!this.config.command) {
							new Notice('Command is required');
							return;
						}
						this.onSave(this.config);
						this.close();
					})
			);
	}

	private renderToolTrust(_containerEl: HTMLElement) {
		if (!this.toolTrustContainer) return;
		this.toolTrustContainer.empty();

		if (this.discoveredTools.length === 0) return;

		this.toolTrustContainer.createEl('h3', { text: 'Tool Trust Settings' });
		const desc = this.toolTrustContainer.createEl('p', {
			text: 'Trusted tools skip the confirmation dialog. Untrusted tools require approval before each execution.',
			cls: 'setting-item-description',
		});
		desc.style.marginBottom = '0.5em';

		for (const toolName of this.discoveredTools) {
			const isTrusted = this.config.trustedTools.includes(toolName);

			new Setting(this.toolTrustContainer)
				.setName(toolName)
				.addToggle((toggle) =>
					toggle.setValue(isTrusted).onChange((value) => {
						if (value) {
							if (!this.config.trustedTools.includes(toolName)) {
								this.config.trustedTools.push(toolName);
							}
						} else {
							this.config.trustedTools = this.config.trustedTools.filter((t) => t !== toolName);
						}
					})
				);
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
