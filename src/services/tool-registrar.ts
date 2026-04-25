import { ToolRegistry } from '../tools/tool-registry';
import { Tool } from '../tools/types';
import { Logger } from '../utils/logger';
import { getVaultTools } from '../tools/vault';
import type ObsidianGemini from '../main';
import type { ModelProvider } from '../models';

interface ToolSource {
	name: string;
	/** Providers this tool source supports. Defaults to all providers if omitted. */
	providers?: ModelProvider[];
	getTools: () => Tool[] | Promise<Tool[]>;
}

/**
 * Manages the canonical list of tool sources and handles bulk
 * registration/unregistration. Eliminates duplication between
 * setupGeminiScribe() and teardownGeminiScribe().
 *
 * Provider-coupled sources (web tools backed by Gemini search/URL-context,
 * image generation) are skipped when the active provider is Ollama.
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
		{
			name: 'web',
			providers: ['gemini'],
			getTools: () => import('../tools/web-tools').then((m) => m.getWebTools()),
		},
		{ name: 'memory', getTools: () => import('../tools/memory-tool').then((m) => m.getMemoryTools()) },
		{
			name: 'image',
			providers: ['gemini'],
			getTools: () => import('../tools/image-tools').then((m) => m.getImageTools()),
		},
		{ name: 'skill', getTools: () => import('../tools/skill-tools').then((m) => m.getSkillTools()) },
		{
			name: 'session-recall',
			getTools: () => import('../tools/session-recall-tool').then((m) => m.getSessionRecallTools()),
		},
	];

	private static activeSources(plugin: ObsidianGemini): ToolSource[] {
		const provider = plugin.settings.provider ?? 'gemini';
		return ToolRegistrar.CORE_SOURCES.filter((s) => !s.providers || s.providers.includes(provider));
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
		// Unregister every known source, regardless of provider, so a provider
		// switch cleanly removes the tools that were registered under the old one.
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
