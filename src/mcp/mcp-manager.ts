import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { MCPServerConfig, MCPConnectionStatus, MCPServerState } from './types';
import { MCPToolWrapper } from './mcp-tool-wrapper';
import type ObsidianGemini from '../main';
import { Logger } from '../utils/logger';

/**
 * Patch the global setTimeout to return objects with .unref() in Electron's renderer.
 *
 * The MCP SDK internally calls setTimeout(...).unref(), which works in Node.js
 * (where setTimeout returns a Timeout object) but fails in Electron's renderer
 * (where setTimeout returns a number, like in browsers).
 *
 * This polyfill wraps the return value so .unref() is a safe no-op.
 */
function patchSetTimeoutForElectron(): void {
	const origSetTimeout = globalThis.setTimeout;
	if (typeof origSetTimeout === 'function') {
		// Test if unref already works (true Node.js environment)
		const testTimer = origSetTimeout(() => {}, 0);
		if (typeof (testTimer as any).unref === 'function') {
			// Already has .unref() — no patch needed
			clearTimeout(testTimer as any);
			return;
		}
		clearTimeout(testTimer as any);

		// Patch: wrap return value to add .unref() and .ref() as no-ops
		(globalThis as any).setTimeout = function patchedSetTimeout(
			callback: (...args: any[]) => void,
			ms?: number,
			...args: any[]
		): any {
			const id = origSetTimeout(callback, ms, ...args);
			return {
				[Symbol.toPrimitive]() {
					return id;
				},
				unref() {
					return this;
				},
				ref() {
					return this;
				},
				// Preserve the raw id so clearTimeout still works
				__timerId: id,
			};
		} as any;

		// Also patch clearTimeout to handle our wrapper objects
		const origClearTimeout = globalThis.clearTimeout;
		(globalThis as any).clearTimeout = function patchedClearTimeout(id: any): void {
			if (id && typeof id === 'object' && '__timerId' in id) {
				origClearTimeout(id.__timerId);
			} else {
				origClearTimeout(id);
			}
		} as any;
	}
}

/**
 * Runtime connection info for an MCP server
 */
interface ServerConnection {
	client: Client;
	transport: StdioClientTransport;
	toolWrappers: MCPToolWrapper[];
}

/**
 * Build a clean Record<string, string> from process.env by filtering
 * out entries whose value is undefined, then merge any user-supplied
 * env vars on top.
 */
function buildEnv(extra?: Record<string, string>): Record<string, string> | undefined {
	if (!extra) return undefined;
	const base: Record<string, string> = {};
	for (const [k, v] of Object.entries(process.env)) {
		if (v !== undefined) base[k] = v;
	}
	return { ...base, ...extra };
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
		// Patch setTimeout for Electron compatibility before any MCP SDK calls
		patchSetTimeoutForElectron();

		// Disconnect if already connected
		if (this.connections.has(config.name)) {
			await this.disconnectServer(config.name);
		}

		this.updateState(config.name, { status: MCPConnectionStatus.CONNECTING, toolNames: [] });
		this.logger.debug(`MCP: Connecting to "${config.name}" — command: ${config.command}, args: [${config.args.join(', ')}]`);

		try {
			this.logger.debug(`MCP: Creating StdioClientTransport for "${config.name}"`);
			const transport = new StdioClientTransport({
				command: config.command,
				args: config.args,
				env: buildEnv(config.env),
			});

			const client = new Client({
				name: 'obsidian-gemini-scribe',
				version: this.plugin.manifest.version,
			});

			this.logger.debug(`MCP: Calling client.connect() for "${config.name}"...`);
			await client.connect(transport);
			this.logger.debug(`MCP: client.connect() succeeded for "${config.name}"`);

			// Discover tools
			this.logger.debug(`MCP: Listing tools for "${config.name}"...`);
			const { tools } = await client.listTools();
			this.logger.log(`MCP: Server "${config.name}" connected with ${tools.length} tool(s)`);

			// Create tool wrappers and register them
			const toolWrappers: MCPToolWrapper[] = [];
			for (const toolDef of tools) {
				const trusted = config.trustedTools.includes(toolDef.name);
				const wrapper = new MCPToolWrapper(client, config.name, toolDef, trusted);
				toolWrappers.push(wrapper);
				this.plugin.toolRegistry.registerTool(wrapper);
				this.logger.debug(`MCP: Registered tool "${wrapper.name}" (trusted: ${trusted})`);
			}

			this.connections.set(config.name, { client, transport, toolWrappers });
			this.updateState(config.name, {
				status: MCPConnectionStatus.CONNECTED,
				toolNames: tools.map((t) => t.name),
			});
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			const errorStack = error instanceof Error ? error.stack : undefined;
			this.logger.error(`MCP: Connection failed for "${config.name}": ${errorMsg}`);
			if (errorStack) {
				this.logger.debug(`MCP: Stack trace:`, errorStack);
			}
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
		// Patch setTimeout for Electron compatibility before any MCP SDK calls
		patchSetTimeoutForElectron();

		let transport: StdioClientTransport | null = null;
		this.logger.debug(`MCP: Test connection to "${config.name}" — command: ${config.command}, args: [${config.args.join(', ')}]`);
		try {
			transport = new StdioClientTransport({
				command: config.command,
				args: config.args,
				env: buildEnv(config.env),
			});

			const client = new Client({
				name: 'obsidian-gemini-scribe',
				version: this.plugin.manifest.version,
			});

			this.logger.debug(`MCP: Test — calling client.connect()...`);
			await client.connect(transport);
			this.logger.debug(`MCP: Test — connected, listing tools...`);
			const { tools } = await client.listTools();
			const toolNames = tools.map((t) => t.name);
			this.logger.debug(`MCP: Test — found ${toolNames.length} tool(s): ${toolNames.join(', ')}`);

			await transport.close();
			return toolNames;
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			const errorStack = error instanceof Error ? error.stack : undefined;
			this.logger.error(`MCP: Test connection failed: ${errorMsg}`);
			if (errorStack) {
				this.logger.debug(`MCP: Stack trace:`, errorStack);
			}
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
