import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { MCPServerConfig, MCPConnectionStatus, MCPServerState } from './types';
import { MCPToolWrapper } from './mcp-tool-wrapper';
import type ObsidianGemini from '../main';
import { Logger } from '../utils/logger';

/**
 * Runtime connection info for an MCP server
 */
interface ServerConnection {
	client: Client;
	transport: StdioClientTransport;
	toolWrappers: MCPToolWrapper[];
}

/**
 * Manages MCP server connections and tool registration.
 *
 * Follows the existing service pattern: constructor receives plugin instance,
 * tools are registered/unregistered in the plugin's ToolRegistry.
 */
export class MCPManager {
	private plugin: InstanceType<typeof ObsidianGemini>;
	private logger: Logger;
	private connections = new Map<string, ServerConnection>();
	private serverStates = new Map<string, MCPServerState>();

	constructor(plugin: InstanceType<typeof ObsidianGemini>) {
		this.plugin = plugin;
		this.logger = plugin.logger;
	}

	/**
	 * Connect to all enabled MCP servers.
	 * Called during plugin startup. Failures are logged but do not block startup.
	 */
	async connectAllEnabled(): Promise<void> {
		const servers = this.plugin.settings.mcpServers || [];
		const enabledServers = servers.filter((s) => s.enabled);

		if (enabledServers.length === 0) {
			this.logger.log('MCP: No enabled servers to connect');
			return;
		}

		this.logger.log(`MCP: Connecting to ${enabledServers.length} enabled server(s)...`);

		for (const config of enabledServers) {
			try {
				await this.connectServer(config);
			} catch (error) {
				this.logger.warn(
					`MCP: Failed to connect to server "${config.name}":`,
					error instanceof Error ? error.message : error
				);
			}
		}
	}

	/**
	 * Connect to a single MCP server, discover its tools, and register them.
	 */
	async connectServer(config: MCPServerConfig): Promise<void> {
		// Disconnect if already connected
		if (this.connections.has(config.name)) {
			await this.disconnectServer(config.name);
		}

		this.updateState(config.name, { status: MCPConnectionStatus.CONNECTING, toolNames: [] });

		try {
			const transport = new StdioClientTransport({
				command: config.command,
				args: config.args,
				env: config.env
				? { ...(process.env as Record<string, string>), ...config.env }
				: undefined,
			});

			const client = new Client({
				name: 'obsidian-gemini-scribe',
				version: this.plugin.manifest.version,
			});

			await client.connect(transport);

			// Discover tools
			const { tools } = await client.listTools();
			this.logger.log(`MCP: Server "${config.name}" connected with ${tools.length} tool(s)`);

			// Create tool wrappers and register them
			const toolWrappers: MCPToolWrapper[] = [];
			for (const toolDef of tools) {
				const trusted = config.trustedTools.includes(toolDef.name);
				const wrapper = new MCPToolWrapper(client, config.name, toolDef, trusted);
				toolWrappers.push(wrapper);
				this.plugin.toolRegistry.registerTool(wrapper);
			}

			this.connections.set(config.name, { client, transport, toolWrappers });
			this.updateState(config.name, {
				status: MCPConnectionStatus.CONNECTED,
				toolNames: tools.map((t) => t.name),
			});
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			this.updateState(config.name, {
				status: MCPConnectionStatus.ERROR,
				error: errorMsg,
				toolNames: [],
			});
			throw error;
		}
	}

	/**
	 * Disconnect a single MCP server and unregister its tools.
	 */
	async disconnectServer(serverName: string): Promise<void> {
		const conn = this.connections.get(serverName);
		if (!conn) return;

		// Unregister all tools from this server
		for (const wrapper of conn.toolWrappers) {
			this.plugin.toolRegistry.unregisterTool(wrapper.name);
		}

		// Close transport (which kills the spawned process)
		try {
			await conn.transport.close();
		} catch (error) {
			this.logger.debug(`MCP: Error closing transport for "${serverName}":`, error);
		}

		this.connections.delete(serverName);
		this.updateState(serverName, { status: MCPConnectionStatus.DISCONNECTED, toolNames: [] });
		this.logger.log(`MCP: Server "${serverName}" disconnected`);
	}

	/**
	 * Disconnect all connected MCP servers.
	 */
	async disconnectAll(): Promise<void> {
		const serverNames = Array.from(this.connections.keys());
		for (const name of serverNames) {
			try {
				await this.disconnectServer(name);
			} catch (error) {
				this.logger.debug(`MCP: Error disconnecting "${name}":`, error);
			}
		}
	}

	/**
	 * Re-query tools from a connected server. Registers new tools, removes old ones.
	 */
	async refreshTools(serverName: string): Promise<void> {
		const conn = this.connections.get(serverName);
		if (!conn) {
			this.logger.warn(`MCP: Cannot refresh tools for disconnected server "${serverName}"`);
			return;
		}

		const config = this.plugin.settings.mcpServers.find((s) => s.name === serverName);
		if (!config) return;

		// Unregister old tools
		for (const wrapper of conn.toolWrappers) {
			this.plugin.toolRegistry.unregisterTool(wrapper.name);
		}

		// Re-query and re-register
		const { tools } = await conn.client.listTools();
		const newWrappers: MCPToolWrapper[] = [];
		for (const toolDef of tools) {
			const trusted = config.trustedTools.includes(toolDef.name);
			const wrapper = new MCPToolWrapper(conn.client, config.name, toolDef, trusted);
			newWrappers.push(wrapper);
			this.plugin.toolRegistry.registerTool(wrapper);
		}

		conn.toolWrappers = newWrappers;
		this.updateState(serverName, {
			status: MCPConnectionStatus.CONNECTED,
			toolNames: tools.map((t) => t.name),
		});

		this.logger.log(`MCP: Refreshed tools for "${serverName}": ${tools.length} tool(s)`);
	}

	/**
	 * Get the connection status of a server.
	 */
	getServerStatus(serverName: string): MCPServerState {
		return (
			this.serverStates.get(serverName) || {
				status: MCPConnectionStatus.DISCONNECTED,
				toolNames: [],
			}
		);
	}

	/**
	 * Get status for all configured servers.
	 */
	getAllServerStatuses(): Map<string, MCPServerState> {
		return new Map(this.serverStates);
	}

	/**
	 * Temporarily connect to a server to discover its tools, then disconnect.
	 * Used by the settings UI to populate tool trust checkboxes.
	 */
	async queryToolsForConfig(config: MCPServerConfig): Promise<string[]> {
		let transport: StdioClientTransport | null = null;
		try {
			transport = new StdioClientTransport({
				command: config.command,
				args: config.args,
				env: config.env
				? { ...(process.env as Record<string, string>), ...config.env }
				: undefined,
			});

			const client = new Client({
				name: 'obsidian-gemini-scribe',
				version: this.plugin.manifest.version,
			});

			await client.connect(transport);
			const { tools } = await client.listTools();
			const toolNames = tools.map((t) => t.name);

			await transport.close();
			return toolNames;
		} catch (error) {
			if (transport) {
				try {
					await transport.close();
				} catch {
					// Ignore close errors during cleanup
				}
			}
			throw error;
		}
	}

	/**
	 * Check if a server is currently connected.
	 */
	isConnected(serverName: string): boolean {
		return this.connections.has(serverName);
	}

	private updateState(serverName: string, state: MCPServerState): void {
		this.serverStates.set(serverName, state);
	}
}
