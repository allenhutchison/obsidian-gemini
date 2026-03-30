import type ObsidianGemini from '../main';
import { HandlerPriority } from '../types/agent-events';

/**
 * Subscribes to agent lifecycle events to manage context tracking:
 * - Resets token high-water mark at turn start
 * - Updates usage metadata from API responses
 * - Resets context manager on session changes
 */
export class ContextTrackingSubscriber {
	private unsubscribers: (() => void)[] = [];

	constructor(plugin: ObsidianGemini) {
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
					if (payload.usageMetadata) {
						plugin.contextManager?.updateUsageMetadata(payload.usageMetadata);
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

	destroy(): void {
		for (const unsub of this.unsubscribers) {
			unsub();
		}
		this.unsubscribers = [];
	}
}
