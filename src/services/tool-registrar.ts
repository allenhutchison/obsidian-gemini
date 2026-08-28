import { ToolRegistry } from '../tools/tool-registry';
import { Tool } from '../tools/types';
import { Logger } from '../utils/logger';
import { getVaultTools } from '../tools/vault';
import type { ObsidianGemini } from '../types/plugin';
import { resolveProvider } from '../api/provider-routing';
import type { ProviderUseCase } from '../api/providers/registry';

interface ToolSource {
	name: string;
	/**
	 * The use case this source's tools belong to. When set, the source is only
	 * registered if some provider is routed to that use case. Omitted means the
	 * tools are provider-independent (vault, memory, skills) and always register.
	 */
	useCase?: ProviderUseCase;
	getTools: () => Tool[] | Promise<Tool[]>;
}

/**
 * Manages the canonical list of tool sources and handles bulk
 * registration/unregistration. Eliminates duplication between
 * setupGeminiScribe() and teardownGeminiScribe().
 *
 * Capability-coupled sources (web tools backed by Gemini search/URL-context,
 * image generation) register only when their use case resolves to a provider
 * that supports it. Since #704 that is a per-use-case question: an
 * Ollama-primary install that routes `search` to Gemini gets the web tools,
 * while one that doesn't stays fully local.
 *
 * RAG tools are excluded — they have independent lifecycle
 * (toggled without full re-init).
 */
export class ToolRegistrar {
	private static readonly CORE_SOURCES: ToolSource[] = [
		{ name: 'vault', getTools: () => getVaultTools() },
		{
			name: 'web',
			useCase: 'webSearch',
			getTools: () => import('../tools/web-tools').then((m) => m.getWebTools()),
		},
		{ name: 'memory', getTools: () => import('../tools/memory-tool').then((m) => m.getMemoryTools()) },
		{
			name: 'image',
			useCase: 'imageGen',
			getTools: () => import('../tools/image-tools').then((m) => m.getImageTools()),
		},
		{ name: 'skill', getTools: () => import('../tools/skill-tools').then((m) => m.getSkillTools()) },
		{
			name: 'session-recall',
			getTools: () => import('../tools/session-recall-tool').then((m) => m.getSessionRecallTools()),
		},
	];

	private static activeSources(plugin: ObsidianGemini): ToolSource[] {
		return ToolRegistrar.CORE_SOURCES.filter((s) => !s.useCase || resolveProvider(plugin.settings, s.useCase) !== null);
	}

	async registerAll(registry: ToolRegistry, logger: Logger, plugin: ObsidianGemini): Promise<void> {
		for (const source of ToolRegistrar.activeSources(plugin)) {
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
		// Unregister every known source, regardless of routing, so a provider
		// change cleanly removes the tools that were registered under the old one.
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
