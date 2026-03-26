import { TFile } from 'obsidian';
import { Notice } from 'obsidian';
import type ObsidianGemini from '../main';
import { ToolRegistrar } from './tool-registrar';
import { GeminiPrompts, PromptManager } from '../prompts';
import { ScribeFile } from '../files';
import { ModelManager } from './model-manager';
import { GeminiHistory } from '../history/history';
import { SessionManager } from '../agent/session-manager';
import { SessionHistory } from '../agent/session-history';
import { AgentsMemory } from './agents-memory';
import { ExamplePromptsManager } from './example-prompts';
import { ToolRegistry } from '../tools/tool-registry';
import { ToolExecutionEngine } from '../tools/execution-engine';
import { SkillManager } from './skill-manager';
import { MCPManager } from '../mcp/mcp-manager';
import { ContextManager } from './context-manager';
import { GeminiCompletions } from '../completions';
import { GeminiSummary } from '../summary';
import { VaultAnalyzer } from './vault-analyzer';
import { DeepResearchService } from './deep-research';
import { ImageGeneration } from './image-generation';
import { SelectionActionService } from './selection-action-service';
import { RagIndexingService } from './rag-indexing';
import { FolderInitializer } from './folder-initializer';
import { UpdateNotificationModal } from '../ui/update-notification-modal';

// @ts-ignore
import agentsMemoryTemplateContent from '../../prompts/agentsMemoryTemplate.hbs';

/**
 * Orchestrates plugin initialization, teardown, and lifecycle events.
 * Keeps main.ts thin by owning service construction order and cleanup.
 */
export class LifecycleService {
	private plugin: ObsidianGemini;
	private toolRegistrar = new ToolRegistrar();
	private persistentServicesCreated = false;
	private ragListenersRegistered = false;

	constructor(plugin: ObsidianGemini) {
		this.plugin = plugin;
	}

	/**
	 * Initialize all plugin services. Replaces setupGeminiScribe().
	 * Can be called multiple times (re-init on settings change).
	 */
	async setup(): Promise<void> {
		const plugin = this.plugin;

		// If re-initializing, cleanup first
		if (plugin.isGeminiInitialized) {
			await this.teardown();
		}

		// Phase A: Core services
		await this.initializeCoreServices();

		// Phase B: Persistent services (only on first init)
		await this.initializePersistentServices();

		// Phase C: Reinitializable services
		await this.initializeReinitializableServices();
	}

	/**
	 * Tear down reinitializable services before re-initialization.
	 */
	async teardown(): Promise<void> {
		const plugin = this.plugin;

		// Unregister all tools
		if (plugin.toolRegistry) {
			await this.toolRegistrar.unregisterAll(plugin.toolRegistry, plugin.logger);
		}

		// Disconnect MCP servers
		if (plugin.mcpManager) {
			await plugin.mcpManager.disconnectAll();
			plugin.mcpManager = null;
		}

		// Null out completions and summarizer for garbage collection
		plugin.completions = null;
		plugin.summarizer = null;

		// Note: We don't clean up history, sessionManager, etc. as they
		// maintain user data that should persist across re-initializations
	}

	/**
	 * Deferred initialization after Obsidian's metadata cache is ready.
	 */
	async onLayoutReady(): Promise<void> {
		const plugin = this.plugin;

		// Create all plugin state folders in one pass now that metadata cache is ready
		await this.initializePluginFolders();

		// Setup prompts directory and commands after layout is ready
		if (plugin.promptManager) {
			await plugin.promptManager.createDefaultPrompts();
			plugin.promptManager.setupPromptCommands();
		}

		await plugin.history?.onLayoutReady();

		// Initialize RAG indexing now that metadata cache is ready
		// (deferred from setup if layout wasn't ready)
		if (!plugin.ragIndexing && plugin.settings.ragIndexing.enabled) {
			await this.initializeRagIndexing();
		}

		// Check for version updates and show notification
		await this.checkForUpdates();
	}

	/**
	 * Final cleanup when the plugin is unloaded.
	 */
	onUnload(): void {
		const plugin = this.plugin;

		plugin.logger.debug('Unloading Gemini Scribe');
		plugin.history?.onUnload();

		// Disconnect MCP servers
		if (plugin.mcpManager) {
			plugin.mcpManager.disconnectAll().catch((error) => {
				plugin.logger.error('Error disconnecting MCP servers:', error);
			});
			plugin.mcpManager = null;
		}

		// Clean up RAG indexing service — unregister tools before destroying
		if (plugin.ragIndexing) {
			import('../tools/rag-search-tool')
				.then(({ getRagTools }) => {
					const ragTools = getRagTools();
					for (const tool of ragTools) {
						plugin.toolRegistry?.unregisterTool(tool.name);
					}
				})
				.catch((error) => {
					plugin.logger.error('Error unregistering RAG tools:', error);
				})
				.finally(() => {
					plugin.ragIndexing?.destroy().catch((error) => {
						plugin.logger.error('Error destroying RAG indexing service:', error);
					});
				});
			plugin.ragIndexing = null;
		}
	}

	/**
	 * Initialize or re-initialize RAG indexing service.
	 * Should only be called when workspace layout is ready.
	 */
	async initializeRagIndexing(): Promise<void> {
		const plugin = this.plugin;

		if (plugin.settings.ragIndexing.enabled) {
			// Clean up existing instance if re-initializing
			if (plugin.ragIndexing) {
				const { getRagTools } = await import('../tools/rag-search-tool');
				const ragTools = getRagTools();
				for (const tool of ragTools) {
					plugin.toolRegistry?.unregisterTool(tool.name);
				}
				await plugin.ragIndexing.destroy();
				plugin.ragIndexing = null;
			}

			try {
				plugin.ragIndexing = new RagIndexingService(plugin);
				await plugin.ragIndexing.initialize();

				// Register RAG search tools
				const { getRagTools } = await import('../tools/rag-search-tool');
				const ragTools = getRagTools();
				for (const tool of ragTools) {
					plugin.toolRegistry?.registerTool(tool);
				}

				// Register file event listeners (only once per plugin lifetime)
				if (!this.ragListenersRegistered) {
					plugin.registerEvent(
						plugin.app.vault.on('create', (file) => {
							if (file instanceof TFile && plugin.ragIndexing) {
								plugin.ragIndexing.onFileCreate(file);
							}
						})
					);
					plugin.registerEvent(
						plugin.app.vault.on('modify', (file) => {
							if (file instanceof TFile && plugin.ragIndexing) {
								plugin.ragIndexing.onFileModify(file);
							}
						})
					);
					plugin.registerEvent(
						plugin.app.vault.on('delete', (file) => {
							if (file instanceof TFile && plugin.ragIndexing) {
								plugin.ragIndexing.onFileDelete(file);
							}
						})
					);
					plugin.registerEvent(
						plugin.app.vault.on('rename', (file, oldPath) => {
							if (file instanceof TFile && plugin.ragIndexing) {
								plugin.ragIndexing.onFileRename(file, oldPath);
							}
						})
					);
					this.ragListenersRegistered = true;
				}
			} catch (error) {
				plugin.logger.error('Failed to initialize RAG indexing:', error);
				new Notice('Failed to initialize vault search index. Check console for details.');

				if (plugin.ragIndexing) {
					await plugin.ragIndexing.destroy().catch(() => {});
					plugin.ragIndexing = null;
				}
			}
		} else if (plugin.ragIndexing) {
			// RAG was disabled - clean up
			const { getRagTools } = await import('../tools/rag-search-tool');
			const ragTools = getRagTools();
			for (const tool of ragTools) {
				plugin.toolRegistry?.unregisterTool(tool.name);
			}
			await plugin.ragIndexing.destroy();
			plugin.ragIndexing = null;
		}
	}

	/**
	 * Update models if auto-update interval has passed.
	 */
	async updateModelsIfNeeded(): Promise<void> {
		const plugin = this.plugin;

		if (!plugin.settings.modelDiscovery.enabled || !plugin.modelManager) {
			return;
		}

		const now = Date.now();
		const lastUpdate = plugin.settings.modelDiscovery.lastUpdate;
		const intervalMs = plugin.settings.modelDiscovery.autoUpdateInterval * 60 * 60 * 1000;

		if (now - lastUpdate > intervalMs) {
			try {
				const result = await plugin.modelManager.updateModels({ preserveUserCustomizations: true });

				if (result.settingsChanged) {
					plugin.settings = result.updatedSettings;
					await plugin.saveData(plugin.settings);

					if (result.changedSettingsInfo.length > 0) {
						plugin.logger.log('Model settings updated:', result.changedSettingsInfo.join(', '));
					}
				}

				plugin.settings.modelDiscovery.lastUpdate = now;
				await plugin.saveData(plugin.settings);
			} catch (error) {
				plugin.logger.warn('Failed to update models during auto-update:', error);
			}
		}
	}

	// --- Private init phases ---

	private async initializeCoreServices(): Promise<void> {
		const plugin = this.plugin;

		plugin.prompts = new GeminiPrompts(plugin);
		plugin.promptManager = new PromptManager(plugin, plugin.app.vault);
		plugin.gfile = new ScribeFile(plugin);

		plugin.modelManager = new ModelManager(plugin);
		await plugin.modelManager.initialize();

		if (plugin.settings.modelDiscovery.enabled) {
			this.updateModelsIfNeeded();
		}
	}

	private async initializePersistentServices(): Promise<void> {
		if (this.persistentServicesCreated) return;

		const plugin = this.plugin;

		plugin.history = new GeminiHistory(plugin);
		await plugin.history.setupHistoryCommands();

		plugin.sessionManager = new SessionManager(plugin);
		plugin.sessionHistory = new SessionHistory(plugin);

		plugin.agentsMemory = new AgentsMemory(plugin, agentsMemoryTemplateContent);
		plugin.examplePrompts = new ExamplePromptsManager(plugin);

		if (plugin.app.workspace.layoutReady) {
			await plugin.history.onLayoutReady();
		}

		this.persistentServicesCreated = true;
	}

	private async initializeReinitializableServices(): Promise<void> {
		const plugin = this.plugin;

		// Tool system
		plugin.toolRegistry = new ToolRegistry(plugin);
		plugin.toolExecutionEngine = new ToolExecutionEngine(plugin, plugin.toolRegistry);
		await this.toolRegistrar.registerAll(plugin.toolRegistry, plugin.logger);

		// Folder and skill management
		plugin.folderInitializer = new FolderInitializer(plugin);
		if (plugin.app.workspace.layoutReady) {
			await this.initializePluginFolders();
		}
		plugin.skillManager = new SkillManager(plugin);

		// MCP server connections
		plugin.mcpManager = new MCPManager(plugin);
		if (plugin.settings.mcpEnabled) {
			await plugin.mcpManager.connectAllEnabled();
		}

		// Context management
		plugin.contextManager = new ContextManager(plugin, plugin.logger);

		// Completions
		plugin.completions = new GeminiCompletions(plugin);
		await plugin.completions.setupCompletions();
		await plugin.completions.setupCompletionsCommands();

		// Summarization
		plugin.summarizer = new GeminiSummary(plugin);
		await plugin.summarizer.setupSummarizationCommand();

		// Vault analyzer
		plugin.vaultAnalyzer = new VaultAnalyzer(plugin);
		plugin.vaultAnalyzer.setupInitCommand();

		// Deep research
		plugin.deepResearch = new DeepResearchService(plugin);

		// Image generation
		plugin.imageGeneration = new ImageGeneration(plugin);
		await plugin.imageGeneration.setupImageGenerationCommand();

		// Selection actions
		plugin.selectionActionService = new SelectionActionService(plugin);

		// RAG indexing (deferred to onLayoutReady if layout not ready)
		if (plugin.app.workspace.layoutReady) {
			await this.initializeRagIndexing();
		}
	}

	async initializePluginFolders(): Promise<void> {
		if (this.plugin.folderInitializer) {
			await this.plugin.folderInitializer.initializeAll();
		}
	}

	private async checkForUpdates(): Promise<void> {
		const plugin = this.plugin;
		try {
			const currentVersion = plugin.manifest.version;
			const lastSeenVersion = plugin.settings.lastSeenVersion;

			if (currentVersion !== lastSeenVersion) {
				if (lastSeenVersion !== '0.0.0') {
					const modal = new UpdateNotificationModal(plugin.app, currentVersion);
					modal.open();
				}

				plugin.settings.lastSeenVersion = currentVersion;
				await plugin.saveData(plugin.settings);
			}
		} catch (error) {
			plugin.logger.error('Error checking for updates:', error);
		}
	}
}
