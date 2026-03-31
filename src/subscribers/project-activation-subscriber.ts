import type ObsidianGemini from '../main';
import { HandlerPriority } from '../types/agent-events';

/**
 * Subscribes to session lifecycle events to auto-detect and link projects.
 *
 * On sessionCreated: if no explicit project set, infer from context files
 * by checking if any are inside a project root.
 *
 * On sessionLoaded: verify the linked project still exists.
 */
export class ProjectActivationSubscriber {
	private unsubscribers: (() => void)[] = [];

	constructor(plugin: ObsidianGemini) {
		this.unsubscribers.push(
			plugin.agentEventBus.on(
				'sessionCreated',
				async (payload) => {
					const session = payload.session;
					if (session.projectPath) return; // Already linked

					// Try to infer project from context files
					const contextFiles = session.context?.contextFiles ?? [];
					for (const file of contextFiles) {
						const project = plugin.projectManager?.getProjectForPath(file.path);
						if (project) {
							session.projectPath = project.file.path;
							plugin.logger.log(`Project auto-detected for session: ${project.config.name}`);
							try {
								await plugin.sessionHistory.updateSessionMetadata(session);
							} catch (error) {
								plugin.logger.error('Failed to persist project linkage:', error);
							}
							break;
						}
					}
				},
				HandlerPriority.INTERNAL
			)
		);

		this.unsubscribers.push(
			plugin.agentEventBus.on(
				'sessionLoaded',
				async (payload) => {
					const session = payload.session;
					if (!session.projectPath) return;

					// Verify the linked project still exists
					const project = await plugin.projectManager?.getProject(session.projectPath);
					if (!project) {
						plugin.logger.warn(`Project file no longer exists for session: ${session.projectPath}. Unlinking.`);
						session.projectPath = undefined;
					}
				},
				HandlerPriority.INTERNAL
			)
		);
	}

	destroy(): void {
		for (const unsub of this.unsubscribers) {
			unsub();
		}
		this.unsubscribers = [];
	}
}
