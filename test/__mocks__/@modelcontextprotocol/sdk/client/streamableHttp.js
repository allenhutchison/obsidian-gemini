// Auto-mock for StreamableHTTPClientTransport
// Wired into vitest.config.ts via resolve.alias to prevent import failures
// in tests that transitively import mcp-manager.ts
export class StreamableHTTPClientTransport {
	constructor() {}
	async close() {}
}
