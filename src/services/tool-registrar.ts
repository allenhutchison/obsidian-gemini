import { ToolRegistry } from '../tools/tool-registry';
import { Tool } from '../tools/types';
import { Logger } from '../utils/logger';
import { getVaultTools } from '../tools/vault';
import type { ObsidianGemini } from '../types/plugin';
import { featureProvider } from '../api/feature-routing';
import { apiKeySecretNameFor } from '../api/provider-credentials';
import type { ObsidianGeminiSettings } from '../types/settings';

interface ToolSource {
	name: string;
	/**
	 * Whether this source's tools should register, given the current settings.
	 * Omitted means the tools are provider-independent (vault, memory, skills)
	 * and always register.
	 */
	gate?: (settings: ObsidianGeminiSettings) => boolean;
	getTools: () => Tool[] | Promise<Tool[]>;
}

/**
 * Manages the canonical list of tool sources and handles bulk
 * registration/unregistration. Eliminates duplication between
 * setupGeminiScribe() and teardownGeminiScribe().
 *
 * Capability-coupled sources (web search/fetch, maps, deep research, image
 * generation) register only when their `gate` passes: web/deep-research/image
 * are gated on the routed feature resolving to a provider that supports it
 * (settings redesign — each is its own feature, not one shared use case), and
 * maps is provider-bound (gated on the Gemini provider being configured,
 * regardless of routing).
 *
 * RAG tools are excluded — they have independent lifecycle
 * (toggled without full re-init).
 */
export class ToolRegistrar {
	private static readonly CORE_SOURCES: ToolSource[] = [
		{ name: 'vault', getTools: () => getVaultTools() },
		{
			name: 'web',
			gate: (settings) => featureProvider(settings, 'webSearch') !== null,
			getTools: () => import('../tools/web-tools').then((m) => m.getWebTools()),
		},
		{
			name: 'maps',
			// Provider-bound (§2.7): registered iff the Gemini provider is
			// configured, regardless of which provider webSearch/chat route to.
			gate: (settings) => Boolean(apiKeySecretNameFor(settings, 'gemini')),
			getTools: () => import('../tools/web-tools').then((m) => m.getMapsTools()),
		},
		{
			name: 'deep-research',
			gate: (settings) => featureProvider(settings, 'deepResearch') !== null,
			getTools: () => import('../tools/web-tools').then((m) => m.getDeepResearchTools()),
		},
		{ name: 'memory', getTools: () => import('../tools/memory-tool').then((m) => m.getMemoryTools()) },
		{
			name: 'image',
			gate: (settings) => featureProvider(settings, 'imageGen') !== null,
			getTools: () => import('../tools/image-tools').then((m) => m.getImageTools()),
		},
		{ name: 'skill', getTools: () => import('../tools/skill-tools').then((m) => m.getSkillTools()) },
		{
			name: 'session-recall',
			getTools: () => import('../tools/session-recall-tool').then((m) => m.getSessionRecallTools()),
		},
	];

	private static activeSources(plugin: ObsidianGemini): ToolSource[] {
		return ToolRegistrar.CORE_SOURCES.filter((s) => !s.gate || s.gate(plugin.settings));
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
