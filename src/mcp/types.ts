/**
 * Configuration for an MCP server connection
 */
export interface MCPServerConfig {
	/** User-friendly server name (unique key) */
	name: string;

	/** Command to spawn (e.g., "npx", "python") */
	command: string;

	/** Command arguments */
	args: string[];

	/** Optional environment variables */
	env?: Record<string, string>;

	/** Whether to connect on startup */
	enabled: boolean;

	/** Tool names that skip confirmation */
	trustedTools: string[];
}

/**
 * Connection status for an MCP server
 */
export enum MCPConnectionStatus {
	DISCONNECTED = 'disconnected',
	CONNECTING = 'connecting',
	CONNECTED = 'connected',
	ERROR = 'error',
}

/**
 * Runtime state for a connected MCP server
 */
export interface MCPServerState {
	status: MCPConnectionStatus;
	error?: string;
	toolNames: string[];
}
