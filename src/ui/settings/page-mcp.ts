import { Notice, setIcon } from 'obsidian';
import type { SettingDefinitionPage, SettingDefinitionRender } from 'obsidian';
import type { MCPServerConfig } from '../../mcp/types';
import { MCPConnectionStatus } from '../../mcp/types';
import { clearServerEnv } from '../../mcp/mcp-secrets';
import { sanitizeKeySegment } from '../../mcp/mcp-oauth-provider';
import { getErrorMessage } from '../../utils/error-utils';
import { t } from '../../i18n';
import type { SettingsContext } from './context';

/**
 * MCP servers settings sub-page (settings-redesign design doc §5.4/§5.5).
 *
 * Ex-`settings-mcp.ts`. There is no more "enable MCP servers" toggle — an
 * empty `mcpServers` list means off (brief §5's sweep). Rendered as a native
 * `SettingDefinitionList` so add/delete are the framework's own affordances;
 * only the per-row edit action and the row's status line are bespoke.
 */
export function mcpPage(ctx: SettingsContext): SettingDefinitionPage {
	const { plugin } = ctx;
	const servers = () => plugin.settings.mcpServers ?? [];

	return {
		type: 'page',
		name: t('settings.main.mcpServersName'),
		displayValue: () => {
			const count = servers().length;
			return count === 1 ? t('settings.mcp.serverCountSingular', { count }) : t('settings.mcp.serverCount', { count });
		},
		items: [
			{
				type: 'list',
				heading: t('settings.main.mcpServersName'),
				emptyState: t('settings.mcp.noServers'),
				items: servers().map((server, index) => serverRow(ctx, server, index)),
				onDelete: (index: number) => {
					void deleteServer(ctx, index);
				},
				addItem: {
					name: t('settings.mcp.addServerButton'),
					action: () => {
						void addServer(ctx);
					},
				},
			},
		],
	};
}

function serverRow(ctx: SettingsContext, server: MCPServerConfig, index: number): SettingDefinitionRender {
	const { app, plugin } = ctx;
	return {
		name: server.name,
		render: (setting) => {
			const mcpManager = plugin.mcpManager;
			const status = mcpManager?.getServerStatus(server.name);

			let iconName: string;
			if (status?.status === MCPConnectionStatus.CONNECTED) {
				iconName = 'check-circle';
			} else if (status?.status === MCPConnectionStatus.ERROR) {
				iconName = 'alert-circle';
			} else {
				iconName = 'circle';
			}

			const descParts: string[] = [];
			if (server.transport === 'http' && server.url) {
				descParts.push(t('settings.mcp.httpUrl', { url: server.url }));
				const oauthKey = `mcp-oauth-tokens-${sanitizeKeySegment(server.name)}`;
				if (app.secretStorage.getSecret(oauthKey)) {
					descParts.push(t('settings.mcp.authorized'));
				}
			} else {
				descParts.push(`${server.command} ${server.args.join(' ')}`.trim());
			}
			descParts.push(status?.status ?? MCPConnectionStatus.DISCONNECTED);

			setting.setName(server.name);
			setting.setDesc(descParts.join(' — '));
			setIcon(setting.nameEl, iconName);

			setting.addExtraButton((button) => {
				button
					.setIcon('pencil')
					.setTooltip(t('settings.mcp.editButton'))
					.onClick(() => {
						void editServer(ctx, server, index);
					});
			});
		},
	};
}

async function addServer(ctx: SettingsContext): Promise<void> {
	const { app, plugin } = ctx;
	if (!plugin.mcpManager) return;
	try {
		const { MCPServerModal } = await import('../mcp-server-modal');
		const modal = new MCPServerModal(app, plugin.mcpManager, null, async (config) => {
			plugin.settings.mcpServers = plugin.settings.mcpServers ?? [];
			if (plugin.settings.mcpServers.some((s) => s.name === config.name)) {
				new Notice(t('settings.mcp.duplicateServerName', { name: config.name }));
				return;
			}
			plugin.settings.mcpServers.push(config);
			await plugin.saveSettings();

			if (config.enabled && plugin.mcpManager) {
				try {
					await plugin.mcpManager.connectServer(config);
				} catch (error) {
					new Notice(t('settings.mcp.savedButConnectFailed', { error: getErrorMessage(error) }));
				}
			}
			ctx.tab.update();
		});
		modal.open();
	} catch (error) {
		plugin.logger.error('Failed to load MCP server modal:', error);
		new Notice(t('settings.mcp.openAddDialogFailed', { error: getErrorMessage(error) }));
	}
}

async function editServer(ctx: SettingsContext, server: MCPServerConfig, _index: number): Promise<void> {
	const { app, plugin } = ctx;
	const mcpManager = plugin.mcpManager;
	if (!mcpManager) return;
	try {
		const { MCPServerModal } = await import('../mcp-server-modal');
		const oldName = server.name;
		const modal = new MCPServerModal(app, mcpManager, server, async (updated) => {
			plugin.settings.mcpServers = plugin.settings.mcpServers ?? [];

			if (updated.name !== oldName && plugin.settings.mcpServers.some((s) => s.name === updated.name)) {
				new Notice(t('settings.mcp.duplicateServerName', { name: updated.name }));
				return;
			}

			const idx = plugin.settings.mcpServers.findIndex((s) => s.name === oldName);
			if (idx >= 0) {
				plugin.settings.mcpServers[idx] = updated;
			}
			await plugin.saveSettings();

			if (mcpManager.isConnected(oldName)) {
				await mcpManager.disconnectServer(oldName);
				if (updated.enabled) {
					try {
						await mcpManager.connectServer(updated);
					} catch (error) {
						new Notice(t('settings.mcp.reconnectFailed', { name: updated.name, error: getErrorMessage(error) }));
					}
				}
			}
			ctx.tab.update();
		});
		modal.open();
	} catch (error) {
		plugin.logger.error('Failed to load MCP server modal:', error);
		new Notice(t('settings.mcp.openEditorFailed', { error: getErrorMessage(error) }));
	}
}

async function deleteServer(ctx: SettingsContext, index: number): Promise<void> {
	const { app, plugin } = ctx;
	const servers = plugin.settings.mcpServers ?? [];
	const server = servers[index];
	if (!server) return;

	const mcpManager = plugin.mcpManager;
	if (mcpManager?.isConnected(server.name)) {
		await mcpManager.disconnectServer(server.name);
	}
	clearServerEnv(app, server);
	plugin.settings.mcpServers = servers.filter((_, i) => i !== index);
	await plugin.saveSettings();
	ctx.tab.update();
}
