import { MCPServerConfig, MCPConnectionStatus, MCP_TRANSPORT_STDIO, MCP_TRANSPORT_HTTP } from '../../src/mcp/types';
import { TimeoutError } from '../../src/utils/timeout';
import { MCP_CONNECT_TIMEOUT_MS, MCP_LIST_TOOLS_TIMEOUT_MS } from '../../src/mcp/mcp-constants';

// --- Mocks ---

// Mock the MCP SDK transports. vi.mock() is hoisted to the top of the module,
// so we use vi.hoisted() to ensure the shared mock fixtures exist before the
// factories run (uppercase identifiers don't match vitest's `mock`-prefix
// auto-hoist heuristic, which is why we hoist explicitly).
const {
	mockStdioTransportClose,
	MockStdioClientTransport,
	mockHttpTransportClose,
	MockStreamableHTTPClientTransport,
	mockListTools,
	mockClientConnect,
	MockClient,
} = vi.hoisted(() => {
	const mockStdioTransportClose = vi.fn();
	const MockStdioClientTransport = vi.fn().mockImplementation(function () {
		return { close: mockStdioTransportClose };
	});

	const mockHttpTransportClose = vi.fn();
	const MockStreamableHTTPClientTransport = vi.fn().mockImplementation(function () {
		return { close: mockHttpTransportClose };
	});

	const mockListTools = vi.fn().mockResolvedValue({ tools: [] });
	const mockClientConnect = vi.fn();

	const MockClient = vi.fn().mockImplementation(function () {
		return { connect: mockClientConnect, listTools: mockListTools };
	});

	return {
		mockStdioTransportClose,
		MockStdioClientTransport,
		mockHttpTransportClose,
		MockStreamableHTTPClientTransport,
		mockListTools,
		mockClientConnect,
		MockClient,
	};
});

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
	Client: MockClient,
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
	StdioClientTransport: MockStdioClientTransport,
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
	StreamableHTTPClientTransport: MockStreamableHTTPClientTransport,
}));

// Mock the OAuth callback server to prevent actual HTTP server creation
vi.mock('../../src/mcp/mcp-oauth-callback', () => ({
	startOAuthCallbackServer: vi.fn().mockResolvedValue({
		waitForCode: new Promise(() => {}), // never resolves — tests don't exercise full OAuth
		close: vi.fn(),
	}),
	waitForOAuthCallback: vi.fn(),
}));

// Import after mocks
import { MCPManager } from '../../src/mcp/mcp-manager';

// Mock plugin
function createMockPlugin(isMobile = false) {
	const secrets = new Map<string, string>();
	return {
		app: {
			isMobile,
			secretStorage: {
				getSecret: vi.fn((id: string) => secrets.get(id) ?? null),
				setSecret: vi.fn((id: string, value: string) => secrets.set(id, value)),
				listSecrets: vi.fn(() => Array.from(secrets.keys())),
			},
		},
		manifest: { version: '1.0.0' },
		settings: {
			mcpServers: [] as MCPServerConfig[],
		},
		logger: {
			log: vi.fn(),
			debug: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		},
		toolRegistry: {
			registerTool: vi.fn(),
			unregisterTool: vi.fn(),
		},
	} as any;
}

function createStdioConfig(overrides?: Partial<MCPServerConfig>): MCPServerConfig {
	return {
		name: 'test-stdio',
		transport: MCP_TRANSPORT_STDIO,
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-test'],
		enabled: true,
		trustedTools: [],
		...overrides,
	};
}

function createHttpConfig(overrides?: Partial<MCPServerConfig>): MCPServerConfig {
	return {
		name: 'test-http',
		transport: MCP_TRANSPORT_HTTP,
		command: '',
		args: [],
		url: 'http://localhost:3000/mcp',
		enabled: true,
		trustedTools: [],
		...overrides,
	};
}

describe('MCPManager', () => {
	let manager: MCPManager;
	let plugin: ReturnType<typeof createMockPlugin>;

	beforeEach(() => {
		vi.clearAllMocks();
		plugin = createMockPlugin();
		manager = new MCPManager(plugin);
	});

	describe('connectServer', () => {
		it('should create StdioClientTransport for stdio config', async () => {
			mockListTools.mockResolvedValueOnce({ tools: [{ name: 'test_tool' }] });

			await manager.connectServer(createStdioConfig());

			expect(MockStdioClientTransport).toHaveBeenCalledWith({
				command: 'npx',
				args: ['-y', '@modelcontextprotocol/server-test'],
				env: undefined,
			});
			expect(MockStreamableHTTPClientTransport).not.toHaveBeenCalled();
			expect(mockClientConnect).toHaveBeenCalled();
		});

		it('should create StreamableHTTPClientTransport for http config', async () => {
			mockListTools.mockResolvedValueOnce({ tools: [{ name: 'test_tool' }] });

			await manager.connectServer(createHttpConfig());

			expect(MockStreamableHTTPClientTransport).toHaveBeenCalledWith(
				new URL('http://localhost:3000/mcp'),
				expect.objectContaining({ authProvider: expect.any(Object) })
			);
			expect(MockStdioClientTransport).not.toHaveBeenCalled();
			expect(mockClientConnect).toHaveBeenCalled();
		});

		it('should default to stdio when transport is undefined', async () => {
			mockListTools.mockResolvedValueOnce({ tools: [] });

			const config = createStdioConfig({ transport: undefined });
			await manager.connectServer(config);

			expect(MockStdioClientTransport).toHaveBeenCalled();
			expect(MockStreamableHTTPClientTransport).not.toHaveBeenCalled();
		});

		it('should throw when http config has no URL', async () => {
			const config = createHttpConfig({ url: undefined });

			await expect(manager.connectServer(config)).rejects.toThrow('HTTP transport requires a URL');
		});

		it('should block stdio on mobile', async () => {
			const mobilePlugin = createMockPlugin(true);
			const mobileManager = new MCPManager(mobilePlugin);

			await mobileManager.connectServer(createStdioConfig());

			expect(MockStdioClientTransport).not.toHaveBeenCalled();
			expect(mobilePlugin.logger.warn).toHaveBeenCalledWith(
				expect.stringContaining('Stdio server connections are not supported on mobile')
			);
		});

		it('should allow HTTP on mobile', async () => {
			const mobilePlugin = createMockPlugin(true);
			const mobileManager = new MCPManager(mobilePlugin);
			mockListTools.mockResolvedValueOnce({ tools: [] });

			await mobileManager.connectServer(createHttpConfig());

			expect(MockStreamableHTTPClientTransport).toHaveBeenCalled();
			expect(mockClientConnect).toHaveBeenCalled();
		});

		it('should register discovered tools', async () => {
			mockListTools.mockResolvedValueOnce({
				tools: [
					{ name: 'tool_a', description: 'Tool A' },
					{ name: 'tool_b', description: 'Tool B' },
				],
			});

			await manager.connectServer(createStdioConfig({ trustedTools: ['tool_a'] }));

			expect(plugin.toolRegistry.registerTool).toHaveBeenCalledTimes(2);

			const status = manager.getServerStatus('test-stdio');
			expect(status.status).toBe(MCPConnectionStatus.CONNECTED);
			expect(status.toolNames).toEqual(['tool_a', 'tool_b']);
		});

		it('should set error state on connection failure', async () => {
			mockClientConnect.mockRejectedValueOnce(new Error('Connection refused'));

			await expect(manager.connectServer(createStdioConfig())).rejects.toThrow('Connection refused');

			const status = manager.getServerStatus('test-stdio');
			expect(status.status).toBe(MCPConnectionStatus.ERROR);
			expect(status.error).toBe('Connection refused');
		});
	});

	describe('queryToolsForConfig', () => {
		it('should use StdioClientTransport for stdio config', async () => {
			mockListTools.mockResolvedValueOnce({ tools: [{ name: 'tool1' }] });

			const tools = await manager.queryToolsForConfig(createStdioConfig());

			expect(tools).toEqual(['tool1']);
			expect(MockStdioClientTransport).toHaveBeenCalled();
			expect(MockStreamableHTTPClientTransport).not.toHaveBeenCalled();
		});

		it('should use StreamableHTTPClientTransport for http config', async () => {
			mockListTools.mockResolvedValueOnce({ tools: [{ name: 'tool1' }] });

			const tools = await manager.queryToolsForConfig(createHttpConfig());

			expect(tools).toEqual(['tool1']);
			expect(MockStreamableHTTPClientTransport).toHaveBeenCalled();
			expect(MockStdioClientTransport).not.toHaveBeenCalled();
		});

		it('should throw for stdio on mobile', async () => {
			const mobilePlugin = createMockPlugin(true);
			const mobileManager = new MCPManager(mobilePlugin);

			await expect(mobileManager.queryToolsForConfig(createStdioConfig())).rejects.toThrow(
				'Stdio MCP server connections are not supported on mobile'
			);
		});

		it('should allow HTTP queries on mobile', async () => {
			const mobilePlugin = createMockPlugin(true);
			const mobileManager = new MCPManager(mobilePlugin);
			mockListTools.mockResolvedValueOnce({ tools: [{ name: 'remote_tool' }] });

			const tools = await mobileManager.queryToolsForConfig(createHttpConfig());

			expect(tools).toEqual(['remote_tool']);
			expect(MockStreamableHTTPClientTransport).toHaveBeenCalled();
		});

		it('should throw when http config has no URL', async () => {
			const config = createHttpConfig({ url: undefined });

			await expect(manager.queryToolsForConfig(config)).rejects.toThrow('HTTP transport requires a URL');
		});
	});

	describe('connectAllEnabled', () => {
		it('should connect only enabled servers', async () => {
			mockListTools.mockResolvedValue({ tools: [] });
			plugin.settings.mcpServers = [
				createStdioConfig({ name: 'enabled', enabled: true }),
				createStdioConfig({ name: 'disabled', enabled: false }),
			];

			await manager.connectAllEnabled();

			expect(MockStdioClientTransport).toHaveBeenCalledTimes(1);
		});

		it('should connect mix of stdio and http servers', async () => {
			mockListTools.mockResolvedValue({ tools: [] });
			plugin.settings.mcpServers = [createStdioConfig(), createHttpConfig()];

			await manager.connectAllEnabled();

			expect(MockStdioClientTransport).toHaveBeenCalledTimes(1);
			expect(MockStreamableHTTPClientTransport).toHaveBeenCalledTimes(1);
		});
	});

	describe('disconnectServer', () => {
		it('should close transport and unregister tools', async () => {
			mockListTools.mockResolvedValueOnce({ tools: [{ name: 'tool1' }] });
			await manager.connectServer(createStdioConfig());

			await manager.disconnectServer('test-stdio');

			expect(mockStdioTransportClose).toHaveBeenCalled();
			expect(plugin.toolRegistry.unregisterTool).toHaveBeenCalled();
			expect(manager.isConnected('test-stdio')).toBe(false);
		});
	});

	describe('getServerStatus', () => {
		it('should return disconnected for unknown servers', () => {
			const status = manager.getServerStatus('unknown');
			expect(status.status).toBe(MCPConnectionStatus.DISCONNECTED);
			expect(status.toolNames).toEqual([]);
		});
	});

	describe('timeouts', () => {
		// These tests use fake timers so a stuck connect/listTools rejects on a
		// schedule, not in real wall-clock time.
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it('rejects with TimeoutError when client.connect() never settles', async () => {
			mockClientConnect.mockImplementationOnce(() => new Promise(() => {}));

			const settled = manager.connectServer(createHttpConfig());
			// Attach assertion BEFORE advancing time so the rejection has a handler.
			const assertion = expect(settled).rejects.toBeInstanceOf(TimeoutError);
			await vi.advanceTimersByTimeAsync(MCP_CONNECT_TIMEOUT_MS + 50);
			await assertion;

			const status = manager.getServerStatus('test-http');
			expect(status.status).toBe(MCPConnectionStatus.ERROR);
			expect(status.error).toMatch(/timed out/);
		});

		it('rejects with TimeoutError when listTools() never settles', async () => {
			mockClientConnect.mockResolvedValueOnce(undefined);
			mockListTools.mockImplementationOnce(() => new Promise(() => {}));

			const settled = manager.connectServer(createHttpConfig());
			const assertion = expect(settled).rejects.toBeInstanceOf(TimeoutError);
			await vi.advanceTimersByTimeAsync(MCP_LIST_TOOLS_TIMEOUT_MS + 50);
			await assertion;

			const status = manager.getServerStatus('test-http');
			expect(status.status).toBe(MCPConnectionStatus.ERROR);
		});

		it('queryToolsForConfig also times out a hung listTools()', async () => {
			mockClientConnect.mockResolvedValueOnce(undefined);
			mockListTools.mockImplementationOnce(() => new Promise(() => {}));

			const settled = manager.queryToolsForConfig(createHttpConfig());
			const assertion = expect(settled).rejects.toBeInstanceOf(TimeoutError);
			await vi.advanceTimersByTimeAsync(MCP_LIST_TOOLS_TIMEOUT_MS + 50);
			await assertion;
		});
	});

	describe('offline behaviour', () => {
		let originalOnLine: PropertyDescriptor | undefined;

		beforeEach(() => {
			originalOnLine = Object.getOwnPropertyDescriptor(navigator, 'onLine');
		});

		afterEach(() => {
			if (originalOnLine) {
				Object.defineProperty(navigator, 'onLine', originalOnLine);
			}
		});

		function setOnline(value: boolean): void {
			Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value });
		}

		it('marks HTTP servers as offline without attempting connect when navigator.onLine is false', async () => {
			setOnline(false);

			await manager.connectServer(createHttpConfig());

			expect(MockStreamableHTTPClientTransport).not.toHaveBeenCalled();
			expect(mockClientConnect).not.toHaveBeenCalled();

			const status = manager.getServerStatus('test-http');
			expect(status.status).toBe(MCPConnectionStatus.ERROR);
			expect(status.error).toContain('offline');
		});

		it('still attempts stdio connections when navigator.onLine is false', async () => {
			setOnline(false);
			mockListTools.mockResolvedValueOnce({ tools: [{ name: 'tool1' }] });

			await manager.connectServer(createStdioConfig());

			expect(MockStdioClientTransport).toHaveBeenCalled();
			expect(mockClientConnect).toHaveBeenCalled();

			const status = manager.getServerStatus('test-stdio');
			expect(status.status).toBe(MCPConnectionStatus.CONNECTED);
		});

		it('queryToolsForConfig fails fast for HTTP when offline', async () => {
			setOnline(false);

			await expect(manager.queryToolsForConfig(createHttpConfig())).rejects.toThrow(/offline/);
			expect(MockStreamableHTTPClientTransport).not.toHaveBeenCalled();
		});

		it("reconnects offline-marked HTTP servers when the 'online' event fires", async () => {
			setOnline(false);
			plugin.settings.mcpServers = [createHttpConfig()];

			// connectAllEnabled registers the online listener and marks the server offline.
			await manager.connectAllEnabled();
			expect(manager.getServerStatus('test-http').status).toBe(MCPConnectionStatus.ERROR);
			expect(MockStreamableHTTPClientTransport).not.toHaveBeenCalled();

			// Network returns; the listener should reconnect.
			setOnline(true);
			mockClientConnect.mockResolvedValueOnce(undefined);
			mockListTools.mockResolvedValueOnce({ tools: [{ name: 'tool1' }] });

			window.dispatchEvent(new Event('online'));

			// Let microtasks drain so the async handler completes.
			await new Promise((r) => window.setTimeout(r, 0));

			expect(MockStreamableHTTPClientTransport).toHaveBeenCalled();
			expect(manager.getServerStatus('test-http').status).toBe(MCPConnectionStatus.CONNECTED);
		});

		it('disconnectAll removes the online listener', async () => {
			plugin.settings.mcpServers = [createHttpConfig()];
			setOnline(true);
			mockListTools.mockResolvedValueOnce({ tools: [] });

			await manager.connectAllEnabled();
			await manager.disconnectAll();

			// After disconnectAll, an online event should not trigger a reconnect.
			setOnline(false);
			setOnline(true);
			window.dispatchEvent(new Event('online'));
			await new Promise((r) => window.setTimeout(r, 0));

			// HTTP transport was created only once (during the initial connect).
			expect(MockStreamableHTTPClientTransport).toHaveBeenCalledTimes(1);
		});
	});
});
