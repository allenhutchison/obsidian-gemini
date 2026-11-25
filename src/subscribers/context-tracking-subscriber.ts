import type { ObsidianGemini } from '../types/plugin';
import { HandlerPriority } from '../types/agent-events';
import { EventBusSubscriber } from './event-bus-subscriber';

/**
 * Subscribes to agent lifecycle events to manage context tracking:
 * - Resets token high-water mark at turn start
 * - Updates usage metadata from API responses (the chat's own, not headless runs')
 * - Resets context manager on session changes
 */
export class ContextTrackingSubscriber extends EventBusSubscriber {
	constructor(plugin: ObsidianGemini) {
		super();
		this.unsubscribers.push(
			plugin.agentEventBus.on(
				'turnStart',
				async () => {
					plugin.contextManager?.beginTurn();
				},
				HandlerPriority.INTERNAL
			)
		);

		this.unsubscribers.push(
			plugin.agentEventBus.on(
				'apiResponseReceived',
				async (payload) => {
					// A hook or scheduled task's request isn't part of the chat's
					// context; that run tracks its own usage (#1823).
					if (payload.headless) return;
					if (payload.usageMetadata) {
						plugin.contextManager?.updateUsageMetadata(payload.usageMetadata, payload.modelName);
					}
				},
				HandlerPriority.INTERNAL
			)
		);

		const resetContext = async () => {
			plugin.contextManager?.reset();
		};

		this.unsubscribers.push(plugin.agentEventBus.on('sessionCreated', resetContext, HandlerPriority.INTERNAL));

		this.unsubscribers.push(plugin.agentEventBus.on('sessionLoaded', resetContext, HandlerPriority.INTERNAL));
	}
}
