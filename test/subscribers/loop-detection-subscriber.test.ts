import { AgentEventBus } from '../../src/agent/agent-event-bus';
import { LoopDetectionSubscriber } from '../../src/subscribers/loop-detection-subscriber';
import type { Logger } from '../../src/utils/logger';
import { ChatSession, SessionType } from '../../src/types/agent';

vi.mock('obsidian', () => ({
	Notice: vi.fn(),
	getLanguage: vi.fn(() => 'en'),
}));

import { Notice } from 'obsidian';

const NoticeMock = vi.mocked(Notice);

function createMockLogger(): Logger {
	return {
		log: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
		child: vi.fn().mockReturnThis(),
	} as unknown as Logger;
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

function loopPayload(sessionId: string, toolName = 'read_file') {
	return {
		sessionId,
		toolName,
		args: { path: 'notes/a.md' },
		identicalCallCount: 2,
		timeWindowMs: 30000,
	};
}

describe('LoopDetectionSubscriber', () => {
	let bus: AgentEventBus;
	let subscriber: LoopDetectionSubscriber;

	beforeEach(() => {
		vi.clearAllMocks();
		bus = new AgentEventBus(createMockLogger());
		subscriber = new LoopDetectionSubscriber({ agentEventBus: bus } as unknown as never);
	});

	afterEach(() => {
		subscriber.destroy();
	});

	it('surfaces a notice on the first fire for a session', async () => {
		await bus.emit('toolLoopDetected', loopPayload('session-1'));

		expect(NoticeMock).toHaveBeenCalledTimes(1);
		expect(NoticeMock).toHaveBeenCalledWith('The agent is repeating the same "read_file" call — it may be stuck.');
	});

	it('stays quiet on later fires in the same session', async () => {
		await bus.emit('toolLoopDetected', loopPayload('session-1'));
		await bus.emit('toolLoopDetected', loopPayload('session-1'));
		await bus.emit('toolLoopDetected', loopPayload('session-1'));

		expect(NoticeMock).toHaveBeenCalledTimes(1);
	});

	it('notifies independently per session', async () => {
		await bus.emit('toolLoopDetected', loopPayload('session-1'));
		await bus.emit('toolLoopDetected', loopPayload('session-2'));

		expect(NoticeMock).toHaveBeenCalledTimes(2);
	});

	it('notifies again after sessionCreated resets the session', async () => {
		await bus.emit('toolLoopDetected', loopPayload('session-1'));
		await bus.emit('sessionCreated', { session: createMockSession({ id: 'session-1' }) });
		await bus.emit('toolLoopDetected', loopPayload('session-1'));

		expect(NoticeMock).toHaveBeenCalledTimes(2);
	});

	it('notifies again after sessionLoaded resets the session', async () => {
		await bus.emit('toolLoopDetected', loopPayload('session-1'));
		await bus.emit('sessionLoaded', { session: createMockSession({ id: 'session-1' }) });
		await bus.emit('toolLoopDetected', loopPayload('session-1'));

		expect(NoticeMock).toHaveBeenCalledTimes(2);
	});

	it('does not propagate a throwing Notice back into the emitter', async () => {
		NoticeMock.mockImplementationOnce(() => {
			throw new Error('toast exploded');
		});

		// The bus catches handler errors, so emit resolves without throwing.
		await expect(bus.emit('toolLoopDetected', loopPayload('session-1'))).resolves.toBeUndefined();
		expect(NoticeMock).toHaveBeenCalledTimes(1);
	});

	it('does not trigger handlers after destroy() unsubscribes', async () => {
		subscriber.destroy();
		await bus.emit('toolLoopDetected', loopPayload('session-1'));

		expect(NoticeMock).not.toHaveBeenCalled();
	});
});
