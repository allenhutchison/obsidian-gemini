import { AgentEventBus } from '../../src/agent/agent-event-bus';
import { HandlerPriority } from '../../src/types/agent-events';

function createMockLogger(): any {
	return {
		log: jest.fn(),
		debug: jest.fn(),
		error: jest.fn(),
		warn: jest.fn(),
		child: jest.fn().mockReturnThis(),
	};
}

describe('AgentEventBus', () => {
	let bus: AgentEventBus;
	let mockLogger: any;

	beforeEach(() => {
		mockLogger = createMockLogger();
		bus = new AgentEventBus(mockLogger);
	});

	describe('on and emit', () => {
		it('should call handler with correct payload', async () => {
			const handler = jest.fn().mockResolvedValue(undefined);
			bus.on('turnStart', handler);

			const payload = { session: {} as any, userMessage: 'hello' };
			await bus.emit('turnStart', payload);

			expect(handler).toHaveBeenCalledTimes(1);
			expect(handler).toHaveBeenCalledWith(expect.objectContaining({ userMessage: 'hello' }));
		});

		it('should call multiple handlers for the same event', async () => {
			const handler1 = jest.fn().mockResolvedValue(undefined);
			const handler2 = jest.fn().mockResolvedValue(undefined);
			bus.on('turnEnd', handler1);
			bus.on('turnEnd', handler2);

			await bus.emit('turnEnd', { session: {} as any, toolCallCount: 3 });

			expect(handler1).toHaveBeenCalledTimes(1);
			expect(handler2).toHaveBeenCalledTimes(1);
		});

		it('should not call handlers for different events', async () => {
			const handler = jest.fn().mockResolvedValue(undefined);
			bus.on('turnStart', handler);

			await bus.emit('turnEnd', { session: {} as any, toolCallCount: 0 });

			expect(handler).not.toHaveBeenCalled();
		});

		it('should be a no-op when no handlers are registered', async () => {
			await expect(bus.emit('turnStart', { session: {} as any, userMessage: 'test' })).resolves.toBeUndefined();
		});
	});

	describe('priority ordering', () => {
		it('should execute handlers in priority order (lower first)', async () => {
			const order: string[] = [];

			bus.on(
				'turnStart',
				async () => {
					order.push('external');
				},
				HandlerPriority.EXTERNAL
			);
			bus.on(
				'turnStart',
				async () => {
					order.push('internal');
				},
				HandlerPriority.INTERNAL
			);
			bus.on(
				'turnStart',
				async () => {
					order.push('normal');
				},
				HandlerPriority.NORMAL
			);

			await bus.emit('turnStart', { session: {} as any, userMessage: 'test' });

			expect(order).toEqual(['internal', 'normal', 'external']);
		});
	});

	describe('error isolation', () => {
		it('should continue executing handlers after one throws', async () => {
			const handler1 = jest.fn().mockRejectedValue(new Error('boom'));
			const handler2 = jest.fn().mockResolvedValue(undefined);
			bus.on('turnStart', handler1);
			bus.on('turnStart', handler2);

			await bus.emit('turnStart', { session: {} as any, userMessage: 'test' });

			expect(handler1).toHaveBeenCalled();
			expect(handler2).toHaveBeenCalled();
		});

		it('should log errors from failing handlers', async () => {
			bus.on('turnStart', async () => {
				throw new Error('handler failed');
			});

			await bus.emit('turnStart', { session: {} as any, userMessage: 'test' });

			expect(mockLogger.error).toHaveBeenCalledWith('Handler error for event "turnStart":', 'handler failed');
		});

		it('should not propagate handler errors to the caller', async () => {
			bus.on('turnStart', async () => {
				throw new Error('should not propagate');
			});

			await expect(bus.emit('turnStart', { session: {} as any, userMessage: 'test' })).resolves.toBeUndefined();
		});
	});

	describe('unsubscribe', () => {
		it('should remove handler via returned unsubscribe function', async () => {
			const handler = jest.fn().mockResolvedValue(undefined);
			const unsub = bus.on('turnStart', handler);

			unsub();

			await bus.emit('turnStart', { session: {} as any, userMessage: 'test' });
			expect(handler).not.toHaveBeenCalled();
		});

		it('should remove handler via off()', async () => {
			const handler = jest.fn().mockResolvedValue(undefined);
			bus.on('turnStart', handler);

			bus.off('turnStart', handler);

			await bus.emit('turnStart', { session: {} as any, userMessage: 'test' });
			expect(handler).not.toHaveBeenCalled();
		});

		it('should not error when removing non-existent handler', () => {
			expect(() => bus.off('turnStart', async () => {})).not.toThrow();
		});
	});

	describe('removeAll', () => {
		it('should remove all handlers for a specific event', async () => {
			const handler1 = jest.fn().mockResolvedValue(undefined);
			const handler2 = jest.fn().mockResolvedValue(undefined);
			bus.on('turnStart', handler1);
			bus.on('turnEnd', handler2);

			bus.removeAll('turnStart');

			await bus.emit('turnStart', { session: {} as any, userMessage: 'test' });
			await bus.emit('turnEnd', { session: {} as any, toolCallCount: 0 });

			expect(handler1).not.toHaveBeenCalled();
			expect(handler2).toHaveBeenCalled();
		});

		it('should remove all handlers when called without argument', async () => {
			bus.on('turnStart', jest.fn().mockResolvedValue(undefined));
			bus.on('turnEnd', jest.fn().mockResolvedValue(undefined));

			bus.removeAll();

			expect(bus.handlerCount('turnStart')).toBe(0);
			expect(bus.handlerCount('turnEnd')).toBe(0);
		});
	});

	describe('handlerCount', () => {
		it('should return 0 for events with no handlers', () => {
			expect(bus.handlerCount('turnStart')).toBe(0);
		});

		it('should return correct count after registrations', () => {
			bus.on('turnStart', async () => {});
			bus.on('turnStart', async () => {});
			bus.on('turnEnd', async () => {});

			expect(bus.handlerCount('turnStart')).toBe(2);
			expect(bus.handlerCount('turnEnd')).toBe(1);
		});
	});

	describe('payload immutability', () => {
		it('should freeze the payload passed to handlers', async () => {
			let receivedPayload: any;
			bus.on('turnStart', async (payload) => {
				receivedPayload = payload;
			});

			await bus.emit('turnStart', { session: {} as any, userMessage: 'test' });

			expect(Object.isFrozen(receivedPayload)).toBe(true);
		});
	});
});
