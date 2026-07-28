/**
 * Base class for agent-event-bus subscribers.
 *
 * Every subscriber in this directory registers one or more handlers on
 * `plugin.agentEventBus` in its constructor, keeps the returned unsubscribe
 * callbacks, and tears them all down in `destroy()`. That teardown was
 * repeated verbatim in each subscriber; it lives here once instead.
 *
 * Subclasses push their unsubscribe callbacks onto {@link unsubscribers} and
 * override `destroy()` only when they own additional state to release (calling
 * `super.destroy()` first).
 */
export abstract class EventBusSubscriber {
	protected unsubscribers: (() => void)[] = [];

	/** Unsubscribe from every registered event-bus handler. */
	destroy(): void {
		for (const unsub of this.unsubscribers) {
			unsub();
		}
		this.unsubscribers = [];
	}
}
