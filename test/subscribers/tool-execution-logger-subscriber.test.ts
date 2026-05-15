import { AgentEventBus } from '../../src/agent/agent-event-bus';
import { ToolExecutionLogger } from '../../src/subscribers/tool-execution-logger';
import { ChatSession, SessionType } from '../../src/types/agent';
import { TFile } from 'obsidian';

vi.mock('obsidian');

function createMockLogger(): any {
	return {
		log: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
		child: vi.fn().mockReturnThis(),
	};
}

function createMockSession(overrides: Partial<ChatSession> = {}): ChatSession {
	return {
		id: 'test-session-id',
		type: SessionType.AGENT_SESSION,
		title: 'Test Session',
		context: { contextFiles: [], requireConfirmation: [] },
		created: new Date(),
		lastActive: new Date(),
		historyPath: 'gemini-scribe/Agent-Sessions/test.md',
		...overrides,
	};
}

function createMockPlugin(bus: AgentEventBus): any {
	const mockFile = Object.assign(new TFile(), { path: 'gemini-scribe/Agent-Sessions/test.md' });
	return {
		agentEventBus: bus,
		logger: createMockLogger(),
		settings: {
			logToolExecution: true,
			chatHistory: true,
		},
		app: {
			vault: {
				getAbstractFileByPath: vi.fn().mockReturnValue(mockFile),
				process: vi.fn().mockImplementation(async (_file: any, fn: (content: string) => string) => {
					fn('# Session\n');
					return undefined;
				}),
			},
		},
	};
}

describe('ToolExecutionLogger (class event wiring)', () => {
	let bus: AgentEventBus;
	let plugin: any;
	let logger: ToolExecutionLogger;

	beforeEach(() => {
		vi.clearAllMocks();
		bus = new AgentEventBus(createMockLogger());
		plugin = createMockPlugin(bus);
		logger = new ToolExecutionLogger(plugin);
	});

	afterEach(() => {
		logger.destroy();
	});

	it('should push to pending logs on toolExecutionComplete when logToolExecution is true', async () => {
		await bus.emit('toolExecutionComplete', {
			toolName: 'read_file',
			args: { path: 'notes/test.md' },
			result: { success: true, data: { path: 'notes/test.md' } },
			durationMs: 100,
		});

		// Trigger toolChainComplete to flush and verify entries were collected
		const session = createMockSession();
		await bus.emit('toolChainComplete', {
			session,
			toolResults: [],
			toolCount: 0,
		});

		// vault.process should have been called, meaning there was a pending log
		expect(plugin.app.vault.process).toHaveBeenCalledTimes(1);
	});

	it('should not push to pending logs when logToolExecution is false', async () => {
		plugin.settings.logToolExecution = false;

		await bus.emit('toolExecutionComplete', {
			toolName: 'read_file',
			args: { path: 'notes/test.md' },
			result: { success: true, data: { path: 'notes/test.md' } },
			durationMs: 100,
		});

		// Trigger toolChainComplete — should have nothing to flush
		const session = createMockSession();
		await bus.emit('toolChainComplete', {
			session,
			toolResults: [],
			toolCount: 0,
		});

		// No pending logs → no vault.process call
		expect(plugin.app.vault.process).not.toHaveBeenCalled();
	});

	it('should format and append pending logs on toolChainComplete', async () => {
		// Add two pending entries
		await bus.emit('toolExecutionComplete', {
			toolName: 'read_file',
			args: { path: 'a.md' },
			result: { success: true, data: { path: 'a.md' } },
			durationMs: 50,
		});
		await bus.emit('toolExecutionComplete', {
			toolName: 'write_file',
			args: { path: 'b.md', content: 'hello' },
			result: { success: true, data: { path: 'b.md' } },
			durationMs: 120,
		});

		const session = createMockSession();
		await bus.emit('toolChainComplete', {
			session,
			toolResults: [],
			toolCount: 0,
		});

		expect(plugin.app.vault.process).toHaveBeenCalledTimes(1);
		// Verify the content transform fn was passed a function
		const processFn = plugin.app.vault.process.mock.calls[0][1];
		const result = processFn('# Session\n');
		expect(result).toContain('[!tools]- Tool Execution');
		expect(result).toContain('read_file');
		expect(result).toContain('write_file');
	});

	it('should early return (drain queue) when chatHistory is disabled', async () => {
		plugin.settings.chatHistory = false;

		await bus.emit('toolExecutionComplete', {
			toolName: 'read_file',
			args: { path: 'test.md' },
			result: { success: true, data: { path: 'test.md' } },
			durationMs: 10,
		});

		const session = createMockSession();
		await bus.emit('toolChainComplete', {
			session,
			toolResults: [],
			toolCount: 0,
		});

		// chatHistory disabled → appendToHistory returns true without vault.process
		expect(plugin.app.vault.process).not.toHaveBeenCalled();

		// After another toolChainComplete the queue should be empty (drained)
		await bus.emit('toolChainComplete', {
			session,
			toolResults: [],
			toolCount: 0,
		});
		expect(plugin.app.vault.process).not.toHaveBeenCalled();
	});

	it('should early return (drain queue) when history file is missing', async () => {
		plugin.app.vault.getAbstractFileByPath.mockReturnValue(null);

		await bus.emit('toolExecutionComplete', {
			toolName: 'read_file',
			args: { path: 'test.md' },
			result: { success: true, data: { path: 'test.md' } },
			durationMs: 10,
		});

		const session = createMockSession();
		await bus.emit('toolChainComplete', {
			session,
			toolResults: [],
			toolCount: 0,
		});

		expect(plugin.app.vault.process).not.toHaveBeenCalled();
		expect(plugin.logger.warn).toHaveBeenCalledWith(expect.stringContaining('history file not found'));
	});

	it('should snapshot pending logs then clear after successful append', async () => {
		await bus.emit('toolExecutionComplete', {
			toolName: 'read_file',
			args: { path: 'first.md' },
			result: { success: true, data: { path: 'first.md' } },
			durationMs: 10,
		});

		const session = createMockSession();
		await bus.emit('toolChainComplete', {
			session,
			toolResults: [],
			toolCount: 0,
		});

		// First chain should write
		expect(plugin.app.vault.process).toHaveBeenCalledTimes(1);

		// Second chain with no new entries should be a no-op
		await bus.emit('toolChainComplete', {
			session,
			toolResults: [],
			toolCount: 0,
		});
		expect(plugin.app.vault.process).toHaveBeenCalledTimes(1); // Still 1
	});

	it('should not clear pending logs when vault.process throws', async () => {
		plugin.app.vault.process.mockRejectedValue(new Error('vault locked'));

		await bus.emit('toolExecutionComplete', {
			toolName: 'read_file',
			args: { path: 'test.md' },
			result: { success: true, data: { path: 'test.md' } },
			durationMs: 10,
		});

		const session = createMockSession();
		await bus.emit('toolChainComplete', {
			session,
			toolResults: [],
			toolCount: 0,
		});

		expect(plugin.logger.error).toHaveBeenCalledWith(
			'ToolExecutionLogger: Failed to append to history:',
			expect.any(Error)
		);

		// Reset process to succeed, and the entry should still be pending
		plugin.app.vault.process.mockImplementation(async (_file: any, fn: (content: string) => string) => {
			fn('# Session\n');
			return undefined;
		});

		await bus.emit('toolChainComplete', {
			session,
			toolResults: [],
			toolCount: 0,
		});

		// Should attempt to write again since the previous entries weren't drained
		expect(plugin.app.vault.process).toHaveBeenCalledTimes(2);
	});

	it('should not trigger handlers after destroy() unsubscribes', async () => {
		logger.destroy();

		await bus.emit('toolExecutionComplete', {
			toolName: 'read_file',
			args: { path: 'test.md' },
			result: { success: true, data: { path: 'test.md' } },
			durationMs: 10,
		});

		const session = createMockSession();
		await bus.emit('toolChainComplete', {
			session,
			toolResults: [],
			toolCount: 0,
		});

		expect(plugin.app.vault.process).not.toHaveBeenCalled();
	});
});
