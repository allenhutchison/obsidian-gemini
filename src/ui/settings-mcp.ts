import type ObsidianGemini from '../main';
import { App, Setting, Notice, setIcon } from 'obsidian';
import { sanitizeKeySegment } from '../mcp/mcp-oauth-provider';
import { clearServerEnv } from '../mcp/mcp-secrets';
import { getErrorMessage, getRawErrorMessage } from '../utils/error-utils';
import { createCollapsibleSection } from './settings-helpers';
import { t } from '../i18n';
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
		plugin.logger.error('MCP settings rendering error:', getRawErrorMessage(error));
		new Setting(containerEl)
			.setName(t('settings.mcp.sectionTitle'))
			.setDesc(t('settings.mcp.loadErrorDesc', { error: getRawErrorMessage(error) }));
	}
}

async function createMCPSettings(
	outerContainerEl: HTMLElement,
	plugin: ObsidianGemini,
	app: App,
	context: SettingsSectionContext
): Promise<void> {
	const containerEl = createCollapsibleSection(
		plugin,
		outerContainerEl,
		t('settings.mcp.sectionTitle'),
		'mcp-servers',
		{
			description: t('settings.mcp.sectionDesc'),
			advanced: true,
		}
	);

	new Setting(containerEl)
		.setName(t('settings.mcp.enableName'))
		.setDesc(t('settings.mcp.enableDesc'))
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
			text: t('settings.mcp.noServers'),
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
				descParts.push(t('settings.mcp.httpUrl', { url: server.url }));
				// Show OAuth status from SecretStorage
				const oauthKey = `mcp-oauth-tokens-${sanitizeKeySegment(server.name)}`;
				if (app.secretStorage.getSecret(oauthKey)) {
					descParts.push(t('settings.mcp.authorized'));
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
					btn.setButtonText(t('settings.mcp.editButton')).onClick(async () => {
						if (!mcpManager) return;
						try {
							const { MCPServerModal } = await import('./mcp-server-modal');
							const oldName = server.name;
							const modal = new MCPServerModal(app, mcpManager, server, async (updated) => {
								plugin.settings.mcpServers = plugin.settings.mcpServers || [];

								// Reject duplicate names (allow keeping the same name)
								if (updated.name !== oldName && plugin.settings.mcpServers.some((s) => s.name === updated.name)) {
									new Notice(t('settings.mcp.duplicateServerName', { name: updated.name }));
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
												t('settings.mcp.reconnectFailed', {
													name: updated.name,
													error: getRawErrorMessage(error),
												})
											);
										}
									}
								}

								context.redisplay();
							});
							modal.open();
						} catch (error) {
							plugin.logger.error('Failed to load MCP server modal:', error);
							new Notice(t('settings.mcp.openEditorFailed', { error: getErrorMessage(error) }));
						}
					})
				)
				.addButton((btn) =>
					btn
						.setButtonText(t('settings.mcp.deleteButton'))
						.setWarning()
						.onClick(async () => {
							// Disconnect first if connected
							if (mcpManager?.isConnected(server.name)) {
								await mcpManager.disconnectServer(server.name);
							}
							// Remove the server's env vars from the keychain.
							clearServerEnv(app, server);
							plugin.settings.mcpServers = plugin.settings.mcpServers.filter((s) => s.name !== server.name);
							await plugin.saveSettings();
							context.redisplay();
						})
				);
		}
	}

	new Setting(containerEl).addButton((btn) =>
		btn
			.setButtonText(t('settings.mcp.addServerButton'))
			.setCta()
			.onClick(async () => {
				if (!plugin.mcpManager) return;
				try {
					const { MCPServerModal } = await import('./mcp-server-modal');
					const modal = new MCPServerModal(app, plugin.mcpManager, null, async (config) => {
						plugin.settings.mcpServers = plugin.settings.mcpServers || [];
						// Check for duplicate name
						if (plugin.settings.mcpServers.some((s) => s.name === config.name)) {
							new Notice(t('settings.mcp.duplicateServerName', { name: config.name }));
							return;
						}
						plugin.settings.mcpServers.push(config);
						await plugin.saveSettings();

						// Connect if enabled
						if (config.enabled && plugin.mcpManager) {
							try {
								await plugin.mcpManager.connectServer(config);
							} catch (error) {
								new Notice(t('settings.mcp.savedButConnectFailed', { error: getErrorMessage(error) }));
							}
						}

						context.redisplay();
					});
					modal.open();
				} catch (error) {
					plugin.logger.error('Failed to load MCP server modal:', error);
					new Notice(t('settings.mcp.openAddDialogFailed', { error: getErrorMessage(error) }));
				}
			})
	);
}
