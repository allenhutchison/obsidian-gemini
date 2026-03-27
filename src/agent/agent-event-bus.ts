import {
	AgentEventMap,
	AgentEventName,
	AgentEventHandler,
	HandlerRegistration,
	HandlerPriority,
} from '../types/agent-events';
import { Logger } from '../utils/logger';

/**
 * Typed async event bus for agent lifecycle hooks.
 * Handlers execute sequentially in priority order.
 * Errors in handlers are logged but never propagate.
 */
export class AgentEventBus {
	private handlers = new Map<string, HandlerRegistration<any>[]>();
	private logger: Logger;

	constructor(logger: Logger) {
		this.logger = logger.child('[EventBus]');
	}

	/**
	 * Register a handler for an event. Returns an unsubscribe function.
	 */
	on<E extends AgentEventName>(
		event: E,
		handler: AgentEventHandler<E>,
		priority: number = HandlerPriority.NORMAL
	): () => void {
		if (!this.handlers.has(event)) {
			this.handlers.set(event, []);
		}
		const registration: HandlerRegistration<E> = { handler, priority };
		this.handlers.get(event)!.push(registration);

		return () => this.off(event, handler);
	}

	/**
	 * Remove a specific handler for an event.
	 */
	off<E extends AgentEventName>(event: E, handler: AgentEventHandler<E>): void {
		const registrations = this.handlers.get(event);
		if (!registrations) return;
		const idx = registrations.findIndex((r) => r.handler === handler);
		if (idx !== -1) registrations.splice(idx, 1);
	}

	/**
	 * Emit an event, executing all handlers in priority order.
	 * Errors in handlers are logged but do not propagate.
	 */
	async emit<E extends AgentEventName>(event: E, payload: AgentEventMap[E]): Promise<void> {
		const registrations = this.handlers.get(event);
		if (!registrations || registrations.length === 0) return;

		const sorted = [...registrations].sort((a, b) => a.priority - b.priority);
		const frozenPayload = Object.freeze(payload);

		for (const { handler } of sorted) {
			try {
				await handler(frozenPayload);
			} catch (error) {
				this.logger.error(`Handler error for event "${event}":`, error instanceof Error ? error.message : error);
			}
		}
	}

	/**
	 * Remove all handlers, optionally for a specific event.
	 */
	removeAll(event?: AgentEventName): void {
		if (event) {
			this.handlers.delete(event);
		} else {
			this.handlers.clear();
		}
	}

	/**
	 * Get handler count for an event.
	 */
	handlerCount(event: AgentEventName): number {
		return this.handlers.get(event)?.length ?? 0;
	}
}
