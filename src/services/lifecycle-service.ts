import { TFile } from 'obsidian';
import { Notice } from 'obsidian';
import type ObsidianGemini from '../main';
import { AgentEventBus } from '../agent/agent-event-bus';
import { ContextTrackingSubscriber } from '../subscribers/context-tracking-subscriber';
import { AccessedFilesSubscriber } from '../subscribers/accessed-files-subscriber';
import { ToolExecutionLogger } from '../subscribers/tool-execution-logger';
import { ProjectActivationSubscriber } from '../subscribers/project-activation-subscriber';
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
import { ProjectManager } from './project-manager';
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
import { BackgroundTaskManager } from './background-task-manager';
import { BackgroundStatusBar } from './background-status-bar';
import { ScheduledTaskManager } from './scheduled-task-manager';

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
	private contextTrackingSubscriber: ContextTrackingSubscriber | null = null;
	private accessedFilesSubscriber: AccessedFilesSubscriber | null = null;
	private projectActivationSubscriber: ProjectActivationSubscriber | null = null;
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

		// If layout is already ready (i.e. this is a re-init triggered by a
		// settings save), refresh the scheduled task manager so it picks up any
		// historyFolder or other setting changes without requiring a restart.
		if (plugin.app.workspace.layoutReady && plugin.scheduledTaskManager) {
			// Cancel any in-flight scheduled-task background jobs before reinitialising,
			// then drain them so we are certain every executeTask callback has finished
			// before initialize() reloads state.  Without the drain, a cancelled task
			// that resumes after initialize() could still call saveState() against the
			// freshly-loaded state, corrupting it (e.g. writing lastRunAt to a stale
			// historyFolder path).  cancel() only sets a flag — it does not await; the
			// task cooperative-cancels at its next isCancelled() poll.  drain() gives us
			// the guarantee that all such tasks have fully settled before we proceed.
			if (plugin.backgroundTaskManager) {
				for (const task of plugin.backgroundTaskManager.getActiveTasks()) {
					if (task.type === 'scheduled-task') {
						plugin.backgroundTaskManager.cancel(task.id);
					}
				}
				await plugin.backgroundTaskManager.drain('scheduled-task');
			}
			await plugin.scheduledTaskManager.initialize({ refresh: true });
			plugin.scheduledTaskManager.start();
		}
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

		// Null out completions, summarizer, and image generation for gc.
		// Nulling imageGeneration here is what allows a Gemini → Ollama provider
		// switch to drop the old Gemini-only instance; the new setup() phase
		// then creates one only if the active provider supports it.
		plugin.completions = null;
		plugin.summarizer = null;
		plugin.imageGeneration = null;

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

		// Discover project files now that metadata cache is ready
		if (plugin.projectManager) {
			await plugin.projectManager.initialize();
			plugin.projectManager.registerVaultEvents();
		}

		// Initialize RAG indexing now that metadata cache is ready
		// (deferred from setup if layout wasn't ready)
		if (!plugin.ragIndexing && plugin.settings.ragIndexing.enabled) {
			await this.initializeRagIndexing();
		}

		// Initialise and start the scheduled task engine now that the vault is ready.
		// initialize() is idempotent so it is safe to call again if onLayoutReady
		// fires a second time (shouldn't happen, but guards against regressions).
		if (plugin.scheduledTaskManager) {
			await plugin.scheduledTaskManager.initialize();
			plugin.scheduledTaskManager.start();
		}

		// Check for version updates and show notification
		await this.checkForUpdates();
	}

	/**
	 * Final cleanup when the plugin is unloaded.
	 * Obsidian awaits async `onunload` implementations, so we await async cleanup
	 * here to ensure RAG / MCP shutdown completes before the plugin host tears down.
	 */
	async onUnload(): Promise<void> {
		const plugin = this.plugin;

		plugin.logger.debug('Unloading Gemini Scribe');
		plugin.backgroundTaskManager?.destroy();
		plugin.backgroundTaskManager = null;
		plugin.backgroundStatusBar?.destroy();
		plugin.backgroundStatusBar = null;
		plugin.scheduledTaskManager?.destroy();
		plugin.scheduledTaskManager = null;
		plugin.history?.onUnload();
		plugin.projectManager?.destroy();
		plugin.toolExecutionLogger?.destroy();
		plugin.toolExecutionLogger = null;
		this.contextTrackingSubscriber?.destroy();
		this.accessedFilesSubscriber?.destroy();
		this.projectActivationSubscriber?.destroy();
		plugin.agentEventBus?.removeAll();

		// Disconnect MCP servers
		if (plugin.mcpManager) {
			try {
				await plugin.mcpManager.disconnectAll();
			} catch (error) {
				plugin.logger.error('Error disconnecting MCP servers:', error);
			}
			plugin.mcpManager = null;
		}

		// Clean up RAG indexing service — unregister tools, then destroy
		if (plugin.ragIndexing) {
			const rag = plugin.ragIndexing;
			plugin.ragIndexing = null;

			try {
				const { getRagTools } = await import('../tools/rag-search-tool');
				const ragTools = getRagTools();
				for (const tool of ragTools) {
					plugin.toolRegistry?.unregisterTool(tool.name);
				}
			} catch (error) {
				plugin.logger.error('Error unregistering RAG tools:', error);
			}
			try {
				await rag.destroy();
			} catch (error) {
				plugin.logger.error('Error destroying RAG indexing service:', error);
			}
		}

		// Flush and destroy file log writer last so it captures logs from all other cleanup
		if (plugin.fileLogWriter) {
			await plugin.fileLogWriter.destroy();
			plugin.fileLogWriter = null;
		}
	}

	/**
	 * Initialize or re-initialize RAG indexing service.
	 * Should only be called when workspace layout is ready.
	 */
	async initializeRagIndexing(): Promise<void> {
		const plugin = this.plugin;

		// RAG uses Gemini's File Search Store cloud API — not available on Ollama in Phase 1.
		if (plugin.settings.provider === 'ollama') {
			if (plugin.ragIndexing) {
				const { getRagTools } = await import('../tools/rag-search-tool');
				for (const tool of getRagTools()) {
					plugin.toolRegistry?.unregisterTool(tool.name);
				}
				await plugin.ragIndexing.destroy();
				plugin.ragIndexing = null;
			}
			return;
		}

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

				// Register file event listeners (only once per plugin lifetime).
				// Set the flag eagerly so that a throw mid-registration cannot cause
				// a second attempt on the next init to double-register handlers.
				// (Obsidian auto-unregisters on unload via plugin.registerEvent.)
				if (!this.ragListenersRegistered) {
					this.ragListenersRegistered = true;
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
	 * Sync model list from provider and update settings if any configured models are stale.
	 */
	async syncModels(): Promise<void> {
		const plugin = this.plugin;

		if (!plugin.modelManager) {
			return;
		}

		try {
			const result = await plugin.modelManager.updateModels();

			if (result.settingsChanged) {
				plugin.settings = result.updatedSettings;
				await plugin.saveData(plugin.settings);

				if (result.changedSettingsInfo.length > 0) {
					plugin.logger.log('Model settings updated:', result.changedSettingsInfo.join(', '));
				}
			}
		} catch (error) {
			plugin.logger.warn('Failed to sync models:', error);
		}
	}

	// --- Private init phases ---

	private async initializeCoreServices(): Promise<void> {
		const plugin = this.plugin;

		// Event bus and subscribers are created once and persist across re-initialization
		if (!plugin.agentEventBus) {
			plugin.agentEventBus = new AgentEventBus(plugin.logger);
			this.contextTrackingSubscriber = new ContextTrackingSubscriber(plugin);
			this.accessedFilesSubscriber = new AccessedFilesSubscriber(plugin);
			this.projectActivationSubscriber = new ProjectActivationSubscriber(plugin);
		}

		// Background task manager + status bar are created once and persist.
		// The status bar is the single coordinated surface for both RAG and background tasks.
		if (!plugin.backgroundTaskManager) {
			plugin.backgroundTaskManager = new BackgroundTaskManager(plugin, plugin.agentEventBus);
			plugin.backgroundStatusBar = new BackgroundStatusBar(plugin, plugin.backgroundTaskManager);
			plugin.backgroundStatusBar.setup();
		}

		// Scheduled task manager is created once and persists alongside the background infrastructure.
		if (!plugin.scheduledTaskManager) {
			plugin.scheduledTaskManager = new ScheduledTaskManager(plugin);
		}

		plugin.prompts = new GeminiPrompts(plugin);
		plugin.promptManager = new PromptManager(plugin, plugin.app.vault);
		plugin.gfile = new ScribeFile(plugin);

		plugin.modelManager = new ModelManager(plugin);
		await plugin.modelManager.initialize();

		// Sync global model list and fix any stale settings before later startup steps read them
		await this.syncModels();
	}

	/**
	 * Persistent services are created once and survive re-initialization.
	 *
	 * Limitation: Some services (e.g., AgentsMemory) capture settings like
	 * historyFolder at construction time. If those settings change, the cached
	 * paths become stale. This is a pre-existing limitation — a full fix would
	 * require adding refresh() methods to these services.
	 */
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

		plugin.projectManager = new ProjectManager(plugin);

		// Tool execution logger subscribes to event bus hooks
		if (plugin.settings.logToolExecution && plugin.agentEventBus) {
			plugin.toolExecutionLogger = new ToolExecutionLogger(plugin);
		}

		this.persistentServicesCreated = true;
	}

	private async initializeReinitializableServices(): Promise<void> {
		const plugin = this.plugin;

		// Tool system
		plugin.toolRegistry = new ToolRegistry(plugin);
		plugin.toolExecutionEngine = new ToolExecutionEngine(plugin, plugin.toolRegistry);
		await this.toolRegistrar.registerAll(plugin.toolRegistry, plugin.logger, plugin);

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

		// Deep research
		plugin.deepResearch = new DeepResearchService(plugin);

		// Image generation service is Gemini-only — Ollama has no image-gen API.
		// The command-palette entry is registered unconditionally in main.ts so
		// it shows a clear "not available" notice on the Ollama path instead of
		// silently disappearing or pointing at an orphaned closure after a
		// runtime provider switch.
		if (plugin.settings.provider !== 'ollama') {
			plugin.imageGeneration = new ImageGeneration(plugin);
		}

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

	/**
	 * Create or destroy the ToolExecutionLogger to match the current
	 * `logToolExecution` setting. Called from saveSettings so the logger
	 * starts/stops in real time when the user toggles the preference.
	 */
	syncToolExecutionLogger(): void {
		const plugin = this.plugin;
		const shouldRun = !!plugin.settings.logToolExecution && !!plugin.agentEventBus;

		if (shouldRun && !plugin.toolExecutionLogger) {
			plugin.toolExecutionLogger = new ToolExecutionLogger(plugin);
		} else if (!shouldRun && plugin.toolExecutionLogger) {
			plugin.toolExecutionLogger.destroy();
			plugin.toolExecutionLogger = null;
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
