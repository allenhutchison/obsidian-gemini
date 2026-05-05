import type ObsidianGemini from '../main';
import { App, Setting, Notice, setIcon } from 'obsidian';
import { sanitizeKeySegment } from '../mcp/mcp-oauth-provider';
import { getErrorMessage } from '../utils/error-utils';
import { createCollapsibleSection } from './settings-helpers';
import type { SettingsSectionContext } from './settings';

export async function renderMCPSettings(
	containerEl: HTMLElement,
	plugin: ObsidianGemini,
	app: App,
	context: SettingsSectionContext
): Promise<void> {
	try {
		await createMCPSettings(containerEl, plugin, app, context);
	} catch (error) {
		plugin.logger.error('MCP settings rendering error:', error instanceof Error ? error.message : String(error));
		new Setting(containerEl)
			.setName('MCP Servers')
			.setDesc(`Error loading MCP settings: ${error instanceof Error ? error.message : String(error)}`);
	}
}

async function createMCPSettings(
	outerContainerEl: HTMLElement,
	plugin: ObsidianGemini,
	app: App,
	context: SettingsSectionContext
): Promise<void> {
	const containerEl = createCollapsibleSection(plugin, outerContainerEl, 'MCP Servers', 'mcp-servers', {
		description: 'Connect external Model Context Protocol servers to extend the agent with additional tools.',
		advanced: true,
	});

	new Setting(containerEl)
		.setName('Enable MCP servers')
		.setDesc(
			'Connect to Model Context Protocol servers to extend the agent with external tools. Supports local (stdio) and remote (HTTP) servers.'
		)
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.mcpEnabled).onChange(async (value) => {
				plugin.settings.mcpEnabled = value;
				await plugin.saveSettings();

				if (value && plugin.mcpManager) {
					await plugin.mcpManager.connectAllEnabled();
				} else if (!value && plugin.mcpManager) {
					await plugin.mcpManager.disconnectAll();
				}

				context.redisplay();
			})
		);

	if (!plugin.settings.mcpEnabled) return;

	const servers = plugin.settings.mcpServers || [];

	if (servers.length === 0) {
		containerEl.createEl('p', {
			text: 'No MCP servers configured. Click "Add Server" to get started.',
			cls: 'setting-item-description',
		});
	} else {
		for (const server of servers) {
			const mcpManager = plugin.mcpManager;
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
				if (app.secretStorage.getSecret(oauthKey)) {
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
						try {
							const { MCPServerModal } = await import('./mcp-server-modal');
							const oldName = server.name;
							const modal = new MCPServerModal(app, mcpManager, server, async (updated) => {
								plugin.settings.mcpServers = plugin.settings.mcpServers || [];

								// Reject duplicate names (allow keeping the same name)
								if (updated.name !== oldName && plugin.settings.mcpServers.some((s) => s.name === updated.name)) {
									new Notice(`A server named "${updated.name}" already exists`);
									return;
								}

								const idx = plugin.settings.mcpServers.findIndex((s) => s.name === oldName);
								if (idx >= 0) {
									plugin.settings.mcpServers[idx] = updated;
								}
								await plugin.saveSettings();

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

								context.redisplay();
							});
							modal.open();
						} catch (error) {
							plugin.logger.error('Failed to load MCP server modal:', error);
							new Notice(`Failed to open server editor: ${getErrorMessage(error)}`);
						}
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
							plugin.settings.mcpServers = plugin.settings.mcpServers.filter((s) => s.name !== server.name);
							await plugin.saveSettings();
							context.redisplay();
						})
				);
		}
	}

	new Setting(containerEl).addButton((btn) =>
		btn
			.setButtonText('Add Server')
			.setCta()
			.onClick(async () => {
				if (!plugin.mcpManager) return;
				try {
					const { MCPServerModal } = await import('./mcp-server-modal');
					const modal = new MCPServerModal(app, plugin.mcpManager, null, async (config) => {
						plugin.settings.mcpServers = plugin.settings.mcpServers || [];
						// Check for duplicate name
						if (plugin.settings.mcpServers.some((s) => s.name === config.name)) {
							new Notice(`A server named "${config.name}" already exists`);
							return;
						}
						plugin.settings.mcpServers.push(config);
						await plugin.saveSettings();

						// Connect if enabled
						if (config.enabled && plugin.mcpManager) {
							try {
								await plugin.mcpManager.connectServer(config);
							} catch (error) {
								new Notice(`Server saved but failed to connect: ${getErrorMessage(error)}`);
							}
						}

						context.redisplay();
					});
					modal.open();
				} catch (error) {
					plugin.logger.error('Failed to load MCP server modal:', error);
					new Notice(`Failed to open Add Server dialog: ${getErrorMessage(error)}`);
				}
			})
	);
}
