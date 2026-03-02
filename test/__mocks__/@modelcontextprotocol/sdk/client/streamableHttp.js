// Auto-mock for StreamableHTTPClientTransport
// Used by moduleNameMapper in jest.config.mjs to prevent import failures
// in tests that transitively import mcp-manager.ts
class StreamableHTTPClientTransport {
	constructor() {}
	async close() {}
}

module.exports = { StreamableHTTPClientTransport };
