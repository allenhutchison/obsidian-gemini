/**
 * Hardcoded timeouts (ms) for MCP operations.
 *
 * These guard against the plugin (or the agent loop) hanging when an MCP
 * server is unreachable — see GitHub discussion #576.
 */

/** Initial `client.connect()` + first `listTools()` during connectServer. */
export const MCP_CONNECT_TIMEOUT_MS = 10_000;

/** `client.listTools()` outside of initial connect (refresh, settings test). */
export const MCP_LIST_TOOLS_TIMEOUT_MS = 10_000;

/** `client.callTool()` for a single agent tool invocation. */
export const MCP_CALL_TOOL_TIMEOUT_MS = 60_000;

/** Per-HTTP-request ceiling inside obsidianFetch. */
export const MCP_FETCH_TIMEOUT_MS = 15_000;

/** Best-effort `transport.close()` during cleanup or disconnect. */
export const MCP_CLOSE_TIMEOUT_MS = 5_000;

/** Wait for OAuth callback after browser redirect. Matches CALLBACK_TIMEOUT_MS. */
export const MCP_OAUTH_WAIT_TIMEOUT_MS = 120_000;
