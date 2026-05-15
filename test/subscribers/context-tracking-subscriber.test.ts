import { AgentEventBus } from '../../src/agent/agent-event-bus';
import { ContextTrackingSubscriber } from '../../src/subscribers/context-tracking-subscriber';
import { ChatSession, SessionType } from '../../src/types/agent';

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
	return {
		agentEventBus: bus,
		logger: createMockLogger(),
		contextManager: {
			beginTurn: vi.fn(),
			updateUsageMetadata: vi.fn(),
			reset: vi.fn(),
		},
	};
}

describe('ContextTrackingSubscriber', () => {
	let bus: AgentEventBus;
	let plugin: any;
	let subscriber: ContextTrackingSubscriber;

	beforeEach(() => {
		vi.clearAllMocks();
		bus = new AgentEventBus(createMockLogger());
		plugin = createMockPlugin(bus);
		subscriber = new ContextTrackingSubscriber(plugin);
	});

	afterEach(() => {
		subscriber.destroy();
	});

	it('should call contextManager.beginTurn() on turnStart', async () => {
		await bus.emit('turnStart', {
			session: createMockSession(),
			userMessage: 'hello',
		});

		expect(plugin.contextManager.beginTurn).toHaveBeenCalledTimes(1);
	});

	it('should call contextManager.updateUsageMetadata() only when usageMetadata is truthy', async () => {
		const usageMetadata = { totalTokenCount: 100, promptTokenCount: 50, candidatesTokenCount: 50 };

		// Emit with usageMetadata
		await bus.emit('apiResponseReceived', { usageMetadata });
		expect(plugin.contextManager.updateUsageMetadata).toHaveBeenCalledWith(usageMetadata);

		// Emit without usageMetadata
		plugin.contextManager.updateUsageMetadata.mockClear();
		await bus.emit('apiResponseReceived', { usageMetadata: undefined });
		expect(plugin.contextManager.updateUsageMetadata).not.toHaveBeenCalled();
	});

	it('should call contextManager.reset() on sessionCreated and sessionLoaded', async () => {
		const session = createMockSession();

		await bus.emit('sessionCreated', { session });
		expect(plugin.contextManager.reset).toHaveBeenCalledTimes(1);

		await bus.emit('sessionLoaded', { session });
		expect(plugin.contextManager.reset).toHaveBeenCalledTimes(2);
	});

	it('should be null-safe when contextManager is undefined', async () => {
		plugin.contextManager = undefined;

		// None of these should throw
		await expect(
			bus.emit('turnStart', { session: createMockSession(), userMessage: 'hello' })
		).resolves.toBeUndefined();

		await expect(
			bus.emit('apiResponseReceived', {
				usageMetadata: { totalTokenCount: 100, promptTokenCount: 50, candidatesTokenCount: 50 },
			})
		).resolves.toBeUndefined();

		await expect(bus.emit('sessionCreated', { session: createMockSession() })).resolves.toBeUndefined();

		await expect(bus.emit('sessionLoaded', { session: createMockSession() })).resolves.toBeUndefined();
	});

	it('should not trigger handlers after destroy() unsubscribes', async () => {
		subscriber.destroy();

		await bus.emit('turnStart', {
			session: createMockSession(),
			userMessage: 'hello',
		});

		await bus.emit('apiResponseReceived', {
			usageMetadata: { totalTokenCount: 100, promptTokenCount: 50, candidatesTokenCount: 50 },
		});

		await bus.emit('sessionCreated', { session: createMockSession() });
		await bus.emit('sessionLoaded', { session: createMockSession() });

		expect(plugin.contextManager.beginTurn).not.toHaveBeenCalled();
		expect(plugin.contextManager.updateUsageMetadata).not.toHaveBeenCalled();
		expect(plugin.contextManager.reset).not.toHaveBeenCalled();
	});
});
