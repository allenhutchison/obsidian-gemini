import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { MCPServerConfig, MCPConnectionStatus, MCPServerState, MCP_TRANSPORT_HTTP } from './types';
import { MCPToolWrapper } from './mcp-tool-wrapper';
import { ObsidianOAuthClientProvider, OAUTH_CALLBACK_PORT } from './mcp-oauth-provider';
import { obsidianFetch } from './mcp-fetch';
import {
	MCP_CLOSE_TIMEOUT_MS,
	MCP_CONNECT_TIMEOUT_MS,
	MCP_LIST_TOOLS_TIMEOUT_MS,
	MCP_OAUTH_WAIT_TIMEOUT_MS,
} from './mcp-constants';
import { withTimeout } from '../utils/timeout';
import type ObsidianGemini from '../main';
import { Logger } from '../utils/logger';
import { Notice } from 'obsidian';

/** Marker on MCPServerState.error so the online listener knows which servers to retry. */
const OFFLINE_ERROR_PREFIX = 'Machine is offline';

// Desktop-only modules loaded dynamically to avoid pulling in Node.js builtins
// (http, child_process) that crash the plugin on iOS/mobile.
type StdioClientTransportType = import('@modelcontextprotocol/sdk/client/stdio.js').StdioClientTransport;
type OAuthCallbackHandle = Awaited<ReturnType<typeof import('./mcp-oauth-callback').startOAuthCallbackServer>>;

/** Check whether a config uses HTTP transport */
function isHttpTransport(config: MCPServerConfig): boolean {
	return config.transport === MCP_TRANSPORT_HTTP;
}

/** Union type for supported MCP transports */
type MCPTransport = StdioClientTransportType | StreamableHTTPClientTransport;

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
	const origSetTimeout = window.setTimeout;
	if (typeof origSetTimeout === 'function') {
		// Test if unref already works (true Node.js environment)
		const testTimer = origSetTimeout(() => {}, 0);
		if (typeof (testTimer as any).unref === 'function') {
			// Already has .unref() — no patch needed
			window.clearTimeout(testTimer as any);
			return;
		}
		window.clearTimeout(testTimer as any);

		// Patch: wrap return value to add .unref() and .ref() as no-ops
		(window as any).setTimeout = function patchedSetTimeout(
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
		const origClearTimeout = window.clearTimeout;
		(window as any).clearTimeout = function patchedClearTimeout(id: any): void {
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
	transport: MCPTransport;
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
	// process.env is only available in Node.js (desktop Electron), not on mobile
	if (typeof process !== 'undefined' && process.env) {
		for (const [k, v] of Object.entries(process.env)) {
			if (v !== undefined) base[k] = v;
		}
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
	private plugin: ObsidianGemini;
	private logger: Logger;
	private connections = new Map<string, ServerConnection>();
	private serverStates = new Map<string, MCPServerState>();
	private onlineHandler: (() => void) | null = null;

	constructor(plugin: ObsidianGemini) {
		this.plugin = plugin;
		this.logger = plugin.logger;
	}

	/**
	 * True when the browser/Electron reports the machine is offline.
	 * `navigator.onLine` is a hint, not a guarantee — a working LAN with no
	 * upstream still reports online — but it lets us fail fast in the common
	 * "Wi-Fi is off" case without waiting for a 10-second timeout.
	 */
	private isMachineOffline(): boolean {
		return typeof navigator !== 'undefined' && navigator.onLine === false;
	}

	/**
	 * Install a window 'online' listener (once) so HTTP servers marked offline
	 * are retried automatically when the network returns. Idempotent.
	 */
	private setupOnlineListener(): void {
		if (this.onlineHandler) return;
		if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
		this.onlineHandler = () => {
			void this.handleOnline();
		};
		window.addEventListener('online', this.onlineHandler);
	}

	private teardownOnlineListener(): void {
		if (!this.onlineHandler) return;
		if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
			window.removeEventListener('online', this.onlineHandler);
		}
		this.onlineHandler = null;
	}

	/**
	 * Network came back: reconnect HTTP servers that were skipped because
	 * the machine was offline. Errors are logged but not surfaced — this is
	 * a background best-effort retry.
	 */
	private async handleOnline(): Promise<void> {
		const servers = this.plugin.settings.mcpServers || [];
		for (const config of servers) {
			if (!config.enabled || config.transport !== MCP_TRANSPORT_HTTP) continue;
			const state = this.serverStates.get(config.name);
			if (!state || state.status !== MCPConnectionStatus.ERROR) continue;
			if (!state.error?.startsWith(OFFLINE_ERROR_PREFIX)) continue;

			this.logger.log(`MCP: Network online — reconnecting "${config.name}"`);
			try {
				await this.connectServer(config);
			} catch (error) {
				this.logger.warn(
					`MCP: Reconnect on online event failed for "${config.name}":`,
					error instanceof Error ? error.message : error
				);
			}
		}
	}

	/**
	 * Connect to all enabled MCP servers.
	 * Called during plugin startup (deferred to onLayoutReady; fire-and-forget).
	 * Failures are logged but do not block startup.
	 */
	async connectAllEnabled(): Promise<void> {
		// Set up the online listener once, regardless of whether any HTTP
		// servers are currently configured — the user may add one mid-session.
		this.setupOnlineListener();

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
	 * Stdio servers require child_process and are desktop-only.
	 * HTTP servers work on all platforms including mobile.
	 */
	async connectServer(config: MCPServerConfig): Promise<void> {
		const useHttp = isHttpTransport(config);

		// Stdio transport requires process spawning — desktop only
		if (!useHttp && (this.plugin.app as any).isMobile) {
			this.logger.warn('MCP: Stdio server connections are not supported on mobile');
			return;
		}

		// HTTP servers can't reach anywhere when the machine is offline. Skip
		// fast and let the online listener retry when the network returns.
		// Stdio servers are local processes and unaffected by network state.
		if (useHttp && this.isMachineOffline()) {
			this.logger.log(
				`MCP: Skipping HTTP server "${config.name}" — machine is offline, will retry when network returns`
			);
			this.updateState(config.name, {
				status: MCPConnectionStatus.ERROR,
				error: `${OFFLINE_ERROR_PREFIX} — will retry when network returns`,
				toolNames: [],
			});
			this.setupOnlineListener();
			return;
		}

		// Disconnect if already connected
		if (this.connections.has(config.name)) {
			await this.disconnectServer(config.name);
		}

		this.updateState(config.name, { status: MCPConnectionStatus.CONNECTING, toolNames: [] });

		if (useHttp) {
			this.logger.debug(`MCP: Connecting to "${config.name}" — url: ${config.url}`);
		} else {
			this.logger.debug(
				`MCP: Connecting to "${config.name}" — command: ${config.command}, args: [${config.args.join(', ')}]`
			);
		}

		let transport: MCPTransport | null = null;
		try {
			const result = await this.createTransportAndConnect(config);
			transport = result.transport;
			const client = result.client;

			this.logger.debug(`MCP: client.connect() succeeded for "${config.name}"`);

			// Discover tools (bounded — a server can accept the connection but
			// hang forever on listTools, which would freeze the agent setup).
			this.logger.debug(`MCP: Listing tools for "${config.name}"...`);
			const { tools } = await withTimeout(
				client.listTools(),
				MCP_LIST_TOOLS_TIMEOUT_MS,
				`MCP listTools for "${config.name}"`
			);
			this.logger.log(`MCP: Server "${config.name}" connected with ${tools.length} tool(s)`);

			// Create tool wrappers and register them
			const toolWrappers: MCPToolWrapper[] = [];
			for (const toolDef of tools) {
				const wrapper = new MCPToolWrapper(client, config.name, toolDef);
				toolWrappers.push(wrapper);
				this.plugin.toolRegistry.registerTool(wrapper);
				this.logger.debug(`MCP: Registered tool "${wrapper.name}"`);
			}

			this.connections.set(config.name, { client, transport, toolWrappers });
			this.updateState(config.name, {
				status: MCPConnectionStatus.CONNECTED,
				toolNames: tools.map((t) => t.name),
			});
		} catch (error) {
			// Close the transport if it was created (best-effort, bounded so a
			// hung server can't keep us in the catch block indefinitely).
			if (transport) {
				try {
					await withTimeout(transport.close(), MCP_CLOSE_TIMEOUT_MS, 'MCP transport close');
				} catch {
					// Ignore close errors during cleanup
				}
			}

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

		// Close transport (which kills the spawned process). Bounded so a hung
		// server can't make plugin teardown hang.
		try {
			await withTimeout(conn.transport.close(), MCP_CLOSE_TIMEOUT_MS, `MCP transport close for "${serverName}"`);
		} catch (error) {
			this.logger.debug(`MCP: Error closing transport for "${serverName}":`, error);
		}

		this.connections.delete(serverName);
		this.updateState(serverName, { status: MCPConnectionStatus.DISCONNECTED, toolNames: [] });
		this.logger.log(`MCP: Server "${serverName}" disconnected`);
	}

	/**
	 * Disconnect all connected MCP servers and stop listening for network changes.
	 */
	async disconnectAll(): Promise<void> {
		this.teardownOnlineListener();
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
		if (!config) {
			this.logger.warn(`MCP: Cannot refresh tools — config not found for "${serverName}"`);
			return;
		}

		// Re-query and build new wrappers first so a listTools() failure
		// doesn't leave us with no tools registered.
		const { tools } = await withTimeout(
			conn.client.listTools(),
			MCP_LIST_TOOLS_TIMEOUT_MS,
			`MCP listTools (refresh) for "${serverName}"`
		);
		const newWrappers: MCPToolWrapper[] = [];
		for (const toolDef of tools) {
			const wrapper = new MCPToolWrapper(conn.client, config.name, toolDef);
			newWrappers.push(wrapper);
		}

		// Swap registrations
		for (const wrapper of conn.toolWrappers) {
			this.plugin.toolRegistry.unregisterTool(wrapper.name);
		}
		for (const wrapper of newWrappers) {
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
		const useHttp = isHttpTransport(config);

		// Stdio transport requires process spawning — desktop only
		if (!useHttp && (this.plugin.app as any).isMobile) {
			throw new Error('Stdio MCP server connections are not supported on mobile');
		}

		// HTTP test can't possibly succeed when offline — fail fast with a
		// clear message instead of waiting out the connect timeout.
		if (useHttp && this.isMachineOffline()) {
			throw new Error(`${OFFLINE_ERROR_PREFIX} — cannot test HTTP MCP server`);
		}

		if (useHttp) {
			this.logger.debug(`MCP: Test connection to "${config.name}" — url: ${config.url}`);
		} else {
			this.logger.debug(
				`MCP: Test connection to "${config.name}" — command: ${config.command}, args: [${config.args.join(', ')}]`
			);
		}

		let transport: MCPTransport | null = null;
		try {
			const result = await this.createTransportAndConnect(config);
			transport = result.transport;

			this.logger.debug(`MCP: Test — connected, listing tools...`);
			const { tools } = await withTimeout(
				result.client.listTools(),
				MCP_LIST_TOOLS_TIMEOUT_MS,
				`MCP listTools (test) for "${config.name}"`
			);
			const toolNames = tools.map((t) => t.name);
			this.logger.debug(`MCP: Test — found ${toolNames.length} tool(s): ${toolNames.join(', ')}`);

			await withTimeout(transport.close(), MCP_CLOSE_TIMEOUT_MS, 'MCP transport close (test)');
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
					await withTimeout(transport.close(), MCP_CLOSE_TIMEOUT_MS, 'MCP transport close (test cleanup)');
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

	/**
	 * Create a transport for the given config, start an OAuth callback server
	 * if needed, create a Client, connect (handling OAuth retry), and return
	 * the connected client + transport. The caller owns closing the transport.
	 */
	private async createTransportAndConnect(
		config: MCPServerConfig
	): Promise<{ client: Client; transport: MCPTransport }> {
		const useHttp = isHttpTransport(config);

		// Patch setTimeout for Electron compatibility before any MCP SDK calls
		patchSetTimeoutForElectron();

		let transport: MCPTransport;
		let authProvider: ObsidianOAuthClientProvider | undefined;
		let callbackHandle: OAuthCallbackHandle | null = null;

		if (useHttp) {
			if (!config.url) {
				throw new Error('HTTP transport requires a URL');
			}
			this.logger.debug(`MCP: Creating StreamableHTTPClientTransport for "${config.name}"`);
			authProvider = new ObsidianOAuthClientProvider(this.plugin.app, config.name);
			transport = new StreamableHTTPClientTransport(new URL(config.url), { authProvider, fetch: obsidianFetch });

			// Start the callback server BEFORE connect so it's already listening
			// when the SDK opens the browser for OAuth authorization.
			// Desktop-only: mobile won't have http.createServer.
			if (!(this.plugin.app as any).isMobile) {
				try {
					const { startOAuthCallbackServer } = await import('./mcp-oauth-callback');
					callbackHandle = await startOAuthCallbackServer();
					this.logger.debug(`MCP: OAuth callback server listening on port ${OAUTH_CALLBACK_PORT}`);
				} catch (serverErr) {
					// Non-fatal: if the port is busy, OAuth just won't work
					this.logger.warn(`MCP: Could not start OAuth callback server: ${serverErr}`);
				}
			}
		} else {
			this.logger.debug(`MCP: Creating StdioClientTransport for "${config.name}"`);
			const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
			transport = new StdioClientTransport({
				command: config.command,
				args: config.args,
				env: buildEnv(config.env),
			});
		}

		const client = new Client({
			name: 'obsidian-gemini-scribe',
			version: this.plugin.manifest.version,
		});

		try {
			await withTimeout(client.connect(transport), MCP_CONNECT_TIMEOUT_MS, `MCP connect to "${config.name}"`);
		} catch (connectError) {
			if (connectError instanceof UnauthorizedError && useHttp && transport instanceof StreamableHTTPClientTransport) {
				this.logger.log(`MCP: OAuth required for "${config.name}", waiting for authorization...`);
				new Notice(`MCP: Authorizing "${config.name}" — check your browser`);

				if (!callbackHandle) {
					throw new Error('OAuth required but callback server is not available (mobile or port conflict)');
				}

				// Wait for OAuth callback — server is already listening. Bound this
				// to the OAuth window so an abandoned browser tab can't hang us
				// indefinitely (the callback server itself also enforces this, but
				// belt-and-braces avoids drift if that ever changes).
				const { code } = await withTimeout(
					callbackHandle.waitForCode,
					MCP_OAUTH_WAIT_TIMEOUT_MS,
					`MCP OAuth callback for "${config.name}"`
				);
				callbackHandle = null; // Server auto-closes after receiving the code
				await transport.finishAuth(code);
				this.logger.log(`MCP: OAuth token exchange complete for "${config.name}", reconnecting...`);

				// Reconnect with the now-authenticated provider
				await transport.close().catch(() => {});
				transport = new StreamableHTTPClientTransport(new URL(config.url!), { authProvider, fetch: obsidianFetch });
				await withTimeout(
					client.connect(transport),
					MCP_CONNECT_TIMEOUT_MS,
					`MCP connect (post-OAuth) to "${config.name}"`
				);
			} else {
				throw connectError;
			}
		} finally {
			// Clean up the callback server if OAuth wasn't needed
			if (callbackHandle) {
				callbackHandle.waitForCode.catch(() => undefined);
				callbackHandle.close();
			}
		}

		return { client, transport };
	}

	private updateState(serverName: string, state: MCPServerState): void {
		this.serverStates.set(serverName, state);
	}
}
