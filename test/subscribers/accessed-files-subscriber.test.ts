import { AgentEventBus } from '../../src/agent/agent-event-bus';
import { AccessedFilesSubscriber } from '../../src/subscribers/accessed-files-subscriber';
// import { HandlerPriority } from '../../src/types/agent-events';
import { ChatSession, SessionType } from '../../src/types/agent';

vi.mock('obsidian');

// Mock the extractAccessedPaths utility so we control return values
vi.mock('../../src/utils/accessed-files', () => ({
	extractAccessedPaths: vi.fn(() => []),
}));

import { extractAccessedPaths } from '../../src/utils/accessed-files';

const mockedExtractAccessedPaths = vi.mocked(extractAccessedPaths);

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
	return {
		agentEventBus: bus,
		logger: createMockLogger(),
		sessionHistory: {
			updateSessionMetadata: vi.fn().mockResolvedValue(undefined),
		},
	};
}

describe('AccessedFilesSubscriber', () => {
	let bus: AgentEventBus;
	let plugin: any;
	let subscriber: AccessedFilesSubscriber;

	beforeEach(() => {
		vi.clearAllMocks();
		bus = new AgentEventBus(createMockLogger());
		plugin = createMockPlugin(bus);
		subscriber = new AccessedFilesSubscriber(plugin);
	});

	afterEach(() => {
		subscriber.destroy();
	});

	it('should create session.accessedFiles Set when undefined', async () => {
		const session = createMockSession({ accessedFiles: undefined });
		mockedExtractAccessedPaths.mockReturnValue(['notes/foo.md']);

		await bus.emit('toolChainComplete', {
			session,
			toolResults: [],
			toolCount: 0,
		});

		expect(session.accessedFiles).toBeInstanceOf(Set);
		expect(session.accessedFiles!.has('notes/foo.md')).toBe(true);
	});

	it('should deduplicate — only calls updateSessionMetadata when new paths added', async () => {
		const session = createMockSession({
			accessedFiles: new Set(['notes/existing.md']),
		});
		// First emit: returns a path that already exists
		mockedExtractAccessedPaths.mockReturnValue(['notes/existing.md']);

		await bus.emit('toolChainComplete', {
			session,
			toolResults: [],
			toolCount: 0,
		});

		expect(plugin.sessionHistory.updateSessionMetadata).not.toHaveBeenCalled();

		// Second emit: returns a new path
		mockedExtractAccessedPaths.mockReturnValue(['notes/new.md']);

		await bus.emit('toolChainComplete', {
			session,
			toolResults: [],
			toolCount: 0,
		});

		expect(plugin.sessionHistory.updateSessionMetadata).toHaveBeenCalledTimes(1);
		expect(session.accessedFiles!.has('notes/new.md')).toBe(true);
	});

	it('should no-op when accessedPaths.length === 0', async () => {
		const session = createMockSession();
		mockedExtractAccessedPaths.mockReturnValue([]);

		await bus.emit('toolChainComplete', {
			session,
			toolResults: [],
			toolCount: 0,
		});

		expect(session.accessedFiles).toBeUndefined();
		expect(plugin.sessionHistory.updateSessionMetadata).not.toHaveBeenCalled();
	});

	it('should log error but not throw when updateSessionMetadata fails', async () => {
		const session = createMockSession();
		mockedExtractAccessedPaths.mockReturnValue(['notes/foo.md']);
		plugin.sessionHistory.updateSessionMetadata.mockRejectedValue(new Error('persist failed'));

		// Should not throw
		await bus.emit('toolChainComplete', {
			session,
			toolResults: [],
			toolCount: 0,
		});

		expect(plugin.logger.error).toHaveBeenCalledWith('Failed to persist accessed_files:', expect.any(Error));
	});

	it('should not trigger handler after destroy() unsubscribes', async () => {
		const session = createMockSession();
		mockedExtractAccessedPaths.mockReturnValue(['notes/foo.md']);

		subscriber.destroy();

		await bus.emit('toolChainComplete', {
			session,
			toolResults: [],
			toolCount: 0,
		});

		// Session should not be modified after unsubscribe
		expect(session.accessedFiles).toBeUndefined();
		expect(plugin.sessionHistory.updateSessionMetadata).not.toHaveBeenCalled();
	});
});
