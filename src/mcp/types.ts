/**
 * Transport type constants for MCP server connections
 */
export const MCP_TRANSPORT_STDIO = 'stdio' as const;
export const MCP_TRANSPORT_HTTP = 'http' as const;
export type MCPTransportType = typeof MCP_TRANSPORT_STDIO | typeof MCP_TRANSPORT_HTTP;

/**
 * Configuration for an MCP server connection
 */
export interface MCPServerConfig {
	/** User-friendly server name (unique key) */
	name: string;

	/** Transport type: "stdio" (local process) or "http" (remote HTTP/SSE). Defaults to "stdio". */
	transport?: MCPTransportType;

	/** Command to spawn (e.g., "npx", "python"). Required for stdio transport. */
	command: string;

	/** Command arguments. Used by stdio transport. */
	args: string[];

	/** URL for HTTP transport (e.g., "http://localhost:3000/mcp") */
	url?: string;

	/**
	 * SecretStorage key holding this server's environment variables as a JSON
	 * blob. The values live in the OS keychain, never in data.json. Absent when
	 * the server has no environment variables configured.
	 */
	envSecretName?: string;

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
