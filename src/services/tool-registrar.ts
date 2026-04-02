import { ToolRegistry } from '../tools/tool-registry';
import { Tool } from '../tools/types';
import { Logger } from '../utils/logger';
import { getVaultTools } from '../tools/vault-tools';

interface ToolSource {
	name: string;
	getTools: () => Tool[] | Promise<Tool[]>;
}

/**
 * Manages the canonical list of tool sources and handles bulk
 * registration/unregistration. Eliminates duplication between
 * setupGeminiScribe() and teardownGeminiScribe().
 *
 * RAG tools are excluded — they have independent lifecycle
 * (toggled without full re-init).
 */
export class ToolRegistrar {
	private static readonly CORE_SOURCES: ToolSource[] = [
		{ name: 'vault', getTools: () => getVaultTools() },
		{
			name: 'vault-extended',
			getTools: () => import('../tools/vault-tools-extended').then((m) => m.getExtendedVaultTools()),
		},
		{ name: 'web', getTools: () => import('../tools/web-tools').then((m) => m.getWebTools()) },
		{ name: 'memory', getTools: () => import('../tools/memory-tool').then((m) => m.getMemoryTools()) },
		{ name: 'image', getTools: () => import('../tools/image-tools').then((m) => m.getImageTools()) },
		{ name: 'skill', getTools: () => import('../tools/skill-tools').then((m) => m.getSkillTools()) },
		{
			name: 'session-recall',
			getTools: () => import('../tools/session-recall-tool').then((m) => m.getSessionRecallTools()),
		},
	];

	async registerAll(registry: ToolRegistry, logger: Logger): Promise<void> {
		for (const source of ToolRegistrar.CORE_SOURCES) {
			try {
				const tools = await source.getTools();
				for (const tool of tools) {
					registry.registerTool(tool);
				}
			} catch (error) {
				logger.error(`Failed to register ${source.name} tools:`, error);
			}
		}
	}

	async unregisterAll(registry: ToolRegistry, logger: Logger): Promise<void> {
		for (const source of ToolRegistrar.CORE_SOURCES) {
			try {
				const tools = await source.getTools();
				for (const tool of tools) {
					registry.unregisterTool(tool.name);
				}
			} catch (error) {
				logger.debug(`Failed to unregister ${source.name} tools:`, error);
			}
		}
	}
}
