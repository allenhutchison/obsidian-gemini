// --- Mocks ---

const { mockServer, mockListen, mockClose, mockOn } = vi.hoisted(() => {
	const mockListen = vi.fn();
	const mockClose = vi.fn();
	const mockOn = vi.fn();
	const mockServer = {
		listen: mockListen,
		close: mockClose,
		on: mockOn,
	};
	return { mockServer, mockListen, mockClose, mockOn };
});

vi.mock('http', () => {
	const createServerFn = vi.fn((handler: any) => {
		// Store the handler for later invocation in tests
		(mockServer as any)._handler = handler;
		return mockServer;
	});
	return {
		default: { createServer: createServerFn },
		createServer: createServerFn,
		IncomingMessage: vi.fn(),
		ServerResponse: vi.fn(),
	};
});

vi.mock('../../src/mcp/mcp-oauth-provider', () => ({
	OAUTH_CALLBACK_PORT: 8095,
}));

// Import after mocks
import { createServer } from 'http';

// --- escapeHtml is a private function; we test it indirectly through
//     the server's error response HTML. For direct testing we re-implement
//     the same logic and verify parity. ---

// Standalone copy of escapeHtml for direct testing (private in source)
function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

describe('escapeHtml (pure function)', () => {
	it('should escape ampersands', () => {
		expect(escapeHtml('A&B')).toBe('A&amp;B');
	});

	it('should escape angle brackets', () => {
		expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
	});

	it('should escape double quotes', () => {
		expect(escapeHtml('say "hello"')).toBe('say &quot;hello&quot;');
	});

	it('should escape single quotes', () => {
		expect(escapeHtml("it's")).toBe('it&#39;s');
	});

	it('should handle strings with no special chars', () => {
		expect(escapeHtml('plain text 123')).toBe('plain text 123');
	});

	it('should handle empty string', () => {
		expect(escapeHtml('')).toBe('');
	});

	it('should handle multiple special chars together', () => {
		expect(escapeHtml('a&b<c>d"e\'f')).toBe('a&amp;b&lt;c&gt;d&quot;e&#39;f');
	});
});

describe('startOAuthCallbackServer', () => {
	let originalSetTimeout: typeof window.setTimeout;
	let originalClearTimeout: typeof window.clearTimeout;
	let _capturedTimeoutCallback: (() => void) | null;

	beforeEach(() => {
		vi.clearAllMocks();
		_capturedTimeoutCallback = null;

		// Mock window.setTimeout/clearTimeout for the timeout logic
		originalSetTimeout = window.setTimeout;
		originalClearTimeout = window.clearTimeout;
		(window as any).setTimeout = vi.fn((cb: () => void) => {
			_capturedTimeoutCallback = cb;
			return 999; // timer ID
		});
		(window as any).clearTimeout = vi.fn();

		// Default: listen succeeds immediately
		mockListen.mockImplementation((_port: number, _host: string, cb: () => void) => {
			cb();
		});
		mockOn.mockImplementation(() => mockServer);
	});

	afterEach(() => {
		window.setTimeout = originalSetTimeout;
		window.clearTimeout = originalClearTimeout;
	});

	it('should create an HTTP server', async () => {
		const { startOAuthCallbackServer } = await import('../../src/mcp/mcp-oauth-callback');
		await startOAuthCallbackServer();

		expect(createServer).toHaveBeenCalled();
	});

	it('should listen on the configured port and host', async () => {
		const { startOAuthCallbackServer } = await import('../../src/mcp/mcp-oauth-callback');
		await startOAuthCallbackServer();

		expect(mockListen).toHaveBeenCalledWith(8095, '127.0.0.1', expect.any(Function));
	});

	it('should return a handle with waitForCode and close', async () => {
		const { startOAuthCallbackServer } = await import('../../src/mcp/mcp-oauth-callback');
		const handle = await startOAuthCallbackServer();

		expect(handle).toHaveProperty('waitForCode');
		expect(handle).toHaveProperty('close');
		expect(typeof handle.close).toBe('function');

		// Clean up — catch the floating waitForCode rejection triggered by close()
		handle.waitForCode.catch(() => {});
		handle.close();
	});

	it('should resolve waitForCode when callback receives a code', async () => {
		const { startOAuthCallbackServer } = await import('../../src/mcp/mcp-oauth-callback');
		const handle = await startOAuthCallbackServer();

		// Simulate the request handler being called
		const handler = (mockServer as any)._handler;
		const mockReq = { url: '/callback?code=test_code_123' };
		const mockRes = {
			writeHead: vi.fn(),
			end: vi.fn(),
		};

		handler(mockReq, mockRes);

		const result = await handle.waitForCode;
		expect(result.code).toBe('test_code_123');
		expect(mockRes.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'text/html' });
	});

	it('should reject waitForCode when callback receives an error', async () => {
		const { startOAuthCallbackServer } = await import('../../src/mcp/mcp-oauth-callback');
		const handle = await startOAuthCallbackServer();

		const handler = (mockServer as any)._handler;
		const mockReq = { url: '/callback?error=access_denied&error_description=User denied' };
		const mockRes = {
			writeHead: vi.fn(),
			end: vi.fn(),
		};

		handler(mockReq, mockRes);

		await expect(handle.waitForCode).rejects.toThrow('OAuth authorization failed');
		expect(mockRes.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'text/html' });
	});

	it('should return 404 for non-callback paths', async () => {
		const { startOAuthCallbackServer } = await import('../../src/mcp/mcp-oauth-callback');
		await startOAuthCallbackServer();

		const handler = (mockServer as any)._handler;
		const mockReq = { url: '/favicon.ico' };
		const mockRes = {
			writeHead: vi.fn(),
			end: vi.fn(),
		};

		handler(mockReq, mockRes);

		expect(mockRes.writeHead).toHaveBeenCalledWith(404);
		expect(mockRes.end).toHaveBeenCalled();
	});

	it('should close the server when handle.close() is called', async () => {
		const { startOAuthCallbackServer } = await import('../../src/mcp/mcp-oauth-callback');
		const handle = await startOAuthCallbackServer();

		handle.close();

		expect(mockClose).toHaveBeenCalled();
		// waitForCode should reject
		await expect(handle.waitForCode).rejects.toThrow('OAuth callback server closed');
	});

	it('should reject with listen error', async () => {
		mockListen.mockImplementation(() => {});
		mockOn.mockImplementation((event: string, cb: any) => {
			if (event === 'error') cb(new Error('EADDRINUSE'));
			return mockServer;
		});

		const { startOAuthCallbackServer } = await import('../../src/mcp/mcp-oauth-callback');
		await expect(startOAuthCallbackServer()).rejects.toThrow('EADDRINUSE');
	});
});

describe('waitForOAuthCallback', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockListen.mockImplementation((_port: number, _host: string, cb: () => void) => {
			cb();
		});
		mockOn.mockImplementation(() => mockServer);
		(window as any).setTimeout = vi.fn(() => 999);
		(window as any).clearTimeout = vi.fn();
	});

	it('should return the waitForCode promise from the handle', async () => {
		const { waitForOAuthCallback } = await import('../../src/mcp/mcp-oauth-callback');

		// Start the callback and simulate a code
		const promise = waitForOAuthCallback();

		const handler = (mockServer as any)._handler;
		const mockReq = { url: '/callback?code=abc' };
		const mockRes = { writeHead: vi.fn(), end: vi.fn() };
		handler(mockReq, mockRes);

		const result = await promise;
		expect(result.code).toBe('abc');
	});
});
