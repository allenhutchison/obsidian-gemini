import type ObsidianGemini from '../main';
import { HandlerPriority } from '../types/agent-events';
import { extractAccessedPaths } from '../utils/accessed-files';
import { ToolResult } from '../tools/types';

/**
 * Subscribes to toolChainComplete to track which files the agent
 * accessed during tool execution. Updates session.accessedFiles
 * and persists to frontmatter.
 */
export class AccessedFilesSubscriber {
	private unsubscribers: (() => void)[] = [];

	constructor(plugin: ObsidianGemini) {
		this.unsubscribers.push(
			plugin.agentEventBus.on(
				'toolChainComplete',
				async (payload) => {
					const session = payload.session;
					const accessedPaths = extractAccessedPaths(
						payload.toolResults as Array<{
							toolName: string;
							toolArguments: any;
							result: ToolResult;
						}>
					);
					if (accessedPaths.length === 0) return;

					if (!session.accessedFiles) {
						session.accessedFiles = new Set<string>();
					}
					let hasNew = false;
					for (const p of accessedPaths) {
						if (!session.accessedFiles.has(p)) {
							session.accessedFiles.add(p);
							hasNew = true;
						}
					}
					if (hasNew) {
						try {
							await plugin.sessionHistory.updateSessionMetadata(session);
						} catch (error) {
							plugin.logger.error('Failed to persist accessed_files:', error);
						}
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
