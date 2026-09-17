import { Notice } from 'obsidian';
import type { ObsidianGemini } from '../types/plugin';
import { t } from '../i18n';
import { HandlerPriority } from '../types/agent-events';
import { EventBusSubscriber } from './event-bus-subscriber';

/**
 * Subscribes to toolLoopDetected to surface the first fire per session as a
 * transient notice, so the user learns the agent is repeating itself before
 * the turn aborts (AgentLoop only surfaces anything at the abort threshold —
 * the first two fires are otherwise invisible outside debug mode).
 *
 * The notice is UI-only, like the `loopAborted` notice — never written to
 * session history. After the first fire the subscriber stays quiet for that
 * session so repeated fires don't stack notices on top of the abort notice
 * that follows. Per-session state is reset on sessionCreated/sessionLoaded,
 * matching how ContextTrackingSubscriber resets its context state.
 */
export class LoopDetectionSubscriber extends EventBusSubscriber {
	/** Session ids that have already seen a loop-detector notice this session. */
	private notifiedSessions = new Set<string>();

	constructor(plugin: ObsidianGemini) {
		super();

		const resetSession = async (payload: { session: { id: string } }) => {
			this.notifiedSessions.delete(payload.session.id);
		};

		this.unsubscribers.push(plugin.agentEventBus.on('toolLoopDetected', this.onLoopDetected, HandlerPriority.NORMAL));
		this.unsubscribers.push(plugin.agentEventBus.on('sessionCreated', resetSession, HandlerPriority.INTERNAL));
		this.unsubscribers.push(plugin.agentEventBus.on('sessionLoaded', resetSession, HandlerPriority.INTERNAL));
	}

	private onLoopDetected = async (payload: { sessionId: string; toolName: string }): Promise<void> => {
		if (this.notifiedSessions.has(payload.sessionId)) return;
		this.notifiedSessions.add(payload.sessionId);
		new Notice(t('agent.loop.notice', { tool: payload.toolName }));
	};
}
