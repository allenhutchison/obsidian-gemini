import { Plugin, WorkspaceLeaf, Editor, MarkdownView, TFile } from 'obsidian';
import ObsidianGeminiSettingTab from './ui/settings';
import { AgentView, VIEW_TYPE_AGENT } from './ui/agent-view/agent-view';
import { GeminiSummary } from './summary';
import { ImageGeneration } from './services/image-generation';
import { ModelApi } from './api/index';
import { ScribeFile } from './files';
import { GeminiHistory } from './history/history';
import { GeminiCompletions } from './completions';
import { Notice } from 'obsidian';
import { GEMINI_MODELS, getDefaultModelForRole, getUpdatedModelSettings } from './models';
import { ModelManager } from './services/model-manager';
import { PromptManager, GeminiPrompts } from './prompts';
import { SelectionRewriter } from './rewrite-selection';
import { RewriteInstructionsModal } from './ui/rewrite-modal';
import { V4WelcomeModal } from './ui/v4-welcome-modal';
import { UpdateNotificationModal } from './ui/update-notification-modal';
import { HistoryArchiver } from './migrations/history-archiver';
import { SessionManager } from './agent/session-manager';
import { ToolRegistry } from './tools/tool-registry';
import { ToolExecutionEngine } from './tools/execution-engine';
import { getVaultTools } from './tools/vault-tools';
import { SessionHistory } from './agent/session-history';
import { AgentsMemory } from './services/agents-memory';
import { ExamplePromptsManager } from './services/example-prompts';
import { VaultAnalyzer } from './services/vault-analyzer';
import { DeepResearchService } from './services/deep-research';
import { Logger } from './utils/logger';
import { RagIndexingService } from './services/rag-indexing';
import { SelectionActionService } from './services/selection-action-service';
import { MCPManager } from './mcp/mcp-manager';
import { MCPServerConfig } from './mcp/types';
import { SkillManager } from './services/skill-manager';

// @ts-ignore
import agentsMemoryTemplateContent from '../prompts/agentsMemoryTemplate.hbs';

export interface ModelDiscoverySettings {
	enabled: boolean;
	autoUpdateInterval: number; // hours
	lastUpdate: number;
	fallbackToStatic: boolean;
}

export interface RagIndexingSettings {
	enabled: boolean;
	fileSearchStoreName: string | null;
	excludeFolders: string[];
	autoSync: boolean;
	includeAttachments: boolean;
}

export interface ObsidianGeminiSettings {
	apiKey: string;
	chatModelName: string;
	summaryModelName: string;
	completionsModelName: string;
	imageModelName: string;
	summaryFrontmatterKey: string;
	userName: string;
	chatHistory: boolean;
	historyFolder: string;
	debugMode: boolean;
	maxRetries: number;
	initialBackoffDelay: number;
	streamingEnabled: boolean;
	modelDiscovery: ModelDiscoverySettings;
	allowSystemPromptOverride: boolean;
	temperature: number;
	topP: number;
	stopOnToolError: boolean;
	// Tool loop detection settings
	loopDetectionEnabled: boolean;
	loopDetectionThreshold: number;
	loopDetectionTimeWindowSeconds: number;
	// Trusted Mode
	alwaysAllowReadWrite: boolean;
	// V4 upgrade tracking
	hasSeenV4Welcome: boolean;
	// Version tracking for update notifications
	lastSeenVersion: string;
	// RAG Indexing settings
	ragIndexing: RagIndexingSettings;
	// MCP server settings
	mcpEnabled: boolean;
	mcpServers: MCPServerConfig[];
}

const DEFAULT_SETTINGS: ObsidianGeminiSettings = {
	apiKey: '',
	chatModelName: getDefaultModelForRole('chat'),
	summaryModelName: getDefaultModelForRole('summary'),
	completionsModelName: getDefaultModelForRole('completions'),
	imageModelName: getDefaultModelForRole('image'),
	summaryFrontmatterKey: 'summary',
	userName: 'User',
	chatHistory: false,
	historyFolder: 'gemini-scribe',
	debugMode: false,
	maxRetries: 3,
	initialBackoffDelay: 1000,
	streamingEnabled: true,
	modelDiscovery: {
		enabled: true, // Automatically discover latest Gemini models
		autoUpdateInterval: 24, // Check daily
		lastUpdate: 0,
		fallbackToStatic: true,
	},
	allowSystemPromptOverride: false,
	temperature: 0.7,
	topP: 1,
	stopOnToolError: true,
	// Tool loop detection settings
	loopDetectionEnabled: true,
	loopDetectionThreshold: 3,
	loopDetectionTimeWindowSeconds: 30,
	// Trusted Mode
	alwaysAllowReadWrite: false,
	// V4 upgrade tracking
	hasSeenV4Welcome: false,
	// Version tracking for update notifications
	lastSeenVersion: '0.0.0',
	// RAG Indexing settings
	ragIndexing: {
		enabled: false,
		fileSearchStoreName: null,
		excludeFolders: [],
		autoSync: true,
		includeAttachments: false,
	},
	// MCP server settings
	mcpEnabled: false,
	mcpServers: [],
};

export default class ObsidianGemini extends Plugin {
	settings: ObsidianGeminiSettings;

	// Public members
	// Note: geminiApi removed - API clients are now created on-demand by features
	public gfile: ScribeFile;
	public agentView: AgentView;
	public history: GeminiHistory;
	public sessionHistory: SessionHistory;
	public promptManager: PromptManager;
	public prompts: GeminiPrompts;
	public sessionManager: SessionManager;
	public toolRegistry: ToolRegistry;
	public toolExecutionEngine: ToolExecutionEngine;
	public agentsMemory: AgentsMemory;
	public examplePrompts: ExamplePromptsManager;
	public vaultAnalyzer: VaultAnalyzer;
	public deepResearch: DeepResearchService;
	public imageGeneration: ImageGeneration;
	public logger: Logger;
	public ragIndexing: RagIndexingService | null = null;
	public selectionActionService: SelectionActionService;
	public mcpManager: MCPManager | null = null;
	public skillManager: SkillManager;

	// Private members
	private summarizer: GeminiSummary;
	private ribbonIcon: HTMLElement;
	private completions: GeminiCompletions;
	private modelManager: ModelManager;
	private ragListenersRegistered: boolean = false;
	private isGeminiInitialized: boolean = false;
	private previousApiKey: string = '';

	async onload() {
		// Initialize logger early so it's available during setup
		this.logger = new Logger(this);

		// Load settings early
		await this.loadSettings();

		// Add settings tab early so users can configure API key even if plugin fails to fully initialize
		this.addSettingTab(new ObsidianGeminiSettingTab(this.app, this));

		// Try to setup the plugin, but don't fail if API key is missing
		try {
			await this.setupGeminiScribe();
			this.isGeminiInitialized = true;
			this.previousApiKey = this.settings.apiKey;
		} catch (error) {
			this.logger.error('Failed to initialize Gemini Scribe:', error);
			// Show a helpful notice if it's an API key error
			if (error instanceof Error && error.message.includes('API key')) {
				new Notice('Gemini Scribe: Please configure your API key in settings to enable the plugin.');
			} else {
				new Notice('Gemini Scribe failed to initialize. Please check the console for details.');
			}
			this.isGeminiInitialized = false;
		}

		// Always register UI components and commands
		this.registerUIAndCommands();

		this.app.workspace.onLayoutReady(() => this.onLayoutReady());
	}

	/**
	 * Check if the plugin is initialized and show a notice if not
	 * @returns true if initialized, false otherwise
	 */
	private checkInitialized(): boolean {
		if (!this.isGeminiInitialized) {
			new Notice('Please configure your API key in Gemini Scribe settings first.');
			return false;
		}
		return true;
	}

	/**
	 * Register UI components and commands
	 * This runs regardless of whether Gemini initialization succeeded
	 */
	private registerUIAndCommands() {
		// Add ribbon icon
		this.ribbonIcon = this.addRibbonIcon('sparkles', 'Gemini Scribe: Agent Mode', () => {
			if (!this.checkInitialized()) return;
			this.activateAgentView();
		});

		// Register view
		this.registerView(VIEW_TYPE_AGENT, (leaf) => (this.agentView = new AgentView(leaf, this)));

		// Add command
		this.addCommand({
			id: 'gemini-scribe-open-agent-view',
			name: 'Open Gemini Chat',
			callback: () => {
				if (!this.checkInitialized()) return;
				this.activateAgentView();
			},
		});

		// Add rewrite command (works with selection or full file)
		this.addCommand({
			id: 'gemini-scribe-rewrite-selection',
			name: 'Rewrite text with AI',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				if (!this.checkInitialized()) return;
				const selection = editor.getSelection();
				const hasSelection = selection.length > 0;

				// Use selection if available, otherwise use entire file
				const textToRewrite = hasSelection ? selection : editor.getValue();
				const isFullFile = !hasSelection;

				// Show modal for instructions
				const modal = new RewriteInstructionsModal(
					this.app,
					textToRewrite,
					async (instructions) => {
						const rewriter = new SelectionRewriter(this);
						if (isFullFile) {
							await rewriter.rewriteFullFile(editor, instructions);
						} else {
							await rewriter.rewriteSelection(editor, selection, instructions);
						}
					},
					isFullFile
				);
				modal.open();
			},
		});

		// Add explain selection command
		this.addCommand({
			id: 'gemini-scribe-explain-selection',
			name: 'Explain selection with AI',
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				if (!this.checkInitialized()) return;
				await this.selectionActionService.handleExplainSelection(editor, view.file);
			},
		});

		// Add ask about selection command
		this.addCommand({
			id: 'gemini-scribe-ask-selection',
			name: 'Ask about selection',
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				if (!this.checkInitialized()) return;
				await this.selectionActionService.handleAskAboutSelection(editor, view.file);
			},
		});

		// Add context menu items for selection actions
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu, editor, view) => {
				const selection = editor.getSelection();
				if (selection) {
					// Rewrite with Gemini
					menu.addItem((item) => {
						item
							.setTitle('Rewrite with Gemini')
							.setIcon('bot-message-square')
							.onClick(() => {
								if (!this.checkInitialized()) return;
								const modal = new RewriteInstructionsModal(
									this.app,
									selection,
									async (instructions) => {
										const rewriter = new SelectionRewriter(this);
										await rewriter.rewriteSelection(editor, selection, instructions);
									},
									false // Context menu is always for selection, not full file
								);
								modal.open();
							});
					});

					// Explain Selection
					menu.addItem((item) => {
						item
							.setTitle('Explain Selection')
							.setIcon('help-circle')
							.onClick(async () => {
								if (!this.checkInitialized()) return;
								const sourceFile = view.file;
								await this.selectionActionService.handleExplainSelection(editor, sourceFile);
							});
					});

					// Ask about Selection
					menu.addItem((item) => {
						item
							.setTitle('Ask about Selection')
							.setIcon('message-circle')
							.onClick(async () => {
								if (!this.checkInitialized()) return;
								const sourceFile = view.file;
								await this.selectionActionService.handleAskAboutSelection(editor, sourceFile);
							});
					});
				}
			})
		);

		// Add command to view release notes
		this.addCommand({
			id: 'gemini-scribe-view-release-notes',
			name: 'View Release Notes',
			callback: () => {
				const modal = new UpdateNotificationModal(this.app, this.manifest.version);
				modal.open();
			},
		});

		// RAG indexing commands
		this.addCommand({
			id: 'gemini-scribe-rag-pause',
			name: 'Pause RAG Sync',
			callback: () => {
				if (!this.ragIndexing) {
					new Notice('RAG indexing is not enabled');
					return;
				}
				if (this.ragIndexing.isPaused()) {
					new Notice('RAG sync is already paused');
					return;
				}
				if (this.ragIndexing.isIndexing()) {
					new Notice('Cannot pause while indexing is in progress');
					return;
				}
				this.ragIndexing.pause();
				new Notice('RAG sync paused');
			},
		});

		this.addCommand({
			id: 'gemini-scribe-rag-resume',
			name: 'Resume RAG Sync',
			callback: () => {
				if (!this.ragIndexing) {
					new Notice('RAG indexing is not enabled');
					return;
				}
				if (!this.ragIndexing.isPaused()) {
					new Notice('RAG sync is not paused');
					return;
				}
				this.ragIndexing.resume();
				new Notice('RAG sync resumed');
			},
		});

		this.addCommand({
			id: 'gemini-scribe-rag-status',
			name: 'Show RAG Status',
			callback: async () => {
				if (!this.ragIndexing) {
					new Notice('RAG indexing is not enabled');
					return;
				}
				// Trigger the same modal as clicking the status bar
				const { RagStatusModal } = await import('./ui/rag-status-modal');
				const modal = new RagStatusModal(
					this.app,
					this.ragIndexing.getDetailedStatus(),
					() => {
						// Open settings to RAG section
						// @ts-expect-error - Obsidian's setting API
						this.app.setting.open();
						// @ts-expect-error - Obsidian's setting API
						this.app.setting.openTabById('gemini-scribe');
					},
					async () => {
						// Reindex
						const { RagProgressModal } = await import('./ui/rag-progress-modal');
						const progressModal = new RagProgressModal(this.app, this.ragIndexing!, (result) => {
							new Notice(`RAG Indexing complete: ${result.indexed} indexed, ${result.skipped} unchanged`);
						});
						progressModal.open();
						this.ragIndexing!.indexVault().catch((error) => {
							new Notice(`RAG Indexing failed: ${error.message}`);
						});
					},
					async () => {
						// Sync now
						const synced = await this.ragIndexing!.syncPendingChanges();
						if (synced) {
							new Notice('RAG Index: Syncing pending changes...');
						}
						return synced;
					}
				);
				modal.open();
			},
		});
	}

	/**
	 * Cleanup existing instances before re-initialization
	 */
	private async teardownGeminiScribe() {
		// Unregister all tools
		if (this.toolRegistry) {
			// Unregister vault tools
			const vaultTools = getVaultTools();
			for (const tool of vaultTools) {
				this.toolRegistry.unregisterTool(tool.name);
			}

			// Unregister extended vault tools
			try {
				const { getExtendedVaultTools } = await import('./tools/vault-tools-extended');
				const extendedTools = getExtendedVaultTools();
				for (const tool of extendedTools) {
					this.toolRegistry.unregisterTool(tool.name);
				}
			} catch (e) {
				this.logger.debug('Failed to unregister extended vault tools:', e);
			}

			// Unregister web tools
			try {
				const { getWebTools } = await import('./tools/web-tools');
				const webTools = getWebTools();
				for (const tool of webTools) {
					this.toolRegistry.unregisterTool(tool.name);
				}
			} catch (e) {
				this.logger.debug('Failed to unregister web tools:', e);
			}

			// Unregister memory tools
			try {
				const { getMemoryTools } = await import('./tools/memory-tool');
				const memoryTools = getMemoryTools();
				for (const tool of memoryTools) {
					this.toolRegistry.unregisterTool(tool.name);
				}
			} catch (e) {
				this.logger.debug('Failed to unregister memory tools:', e);
			}

			// Unregister image tools
			try {
				const { getImageTools } = await import('./tools/image-tools');
				const imageTools = getImageTools();
				for (const tool of imageTools) {
					this.toolRegistry.unregisterTool(tool.name);
				}
			} catch (e) {
				this.logger.debug('Failed to unregister image tools:', e);
			}

			// Unregister skill tools
			try {
				const { getSkillTools } = await import('./tools/skill-tools');
				const skillTools = getSkillTools();
				for (const tool of skillTools) {
					this.toolRegistry.unregisterTool(tool.name);
				}
			} catch (e) {
				this.logger.debug('Failed to unregister skill tools:', e);
			}
		}

		// Disconnect MCP servers
		if (this.mcpManager) {
			await this.mcpManager.disconnectAll();
			this.mcpManager = null;
		}

		// Clean up completions
		if (this.completions) {
			// Note: GeminiCompletions doesn't have a cleanup method currently
			// but we'll null it out to ensure garbage collection
			this.completions = null as any;
		}

		// Clean up summarizer
		if (this.summarizer) {
			this.summarizer = null as any;
		}

		// Note: We don't clean up history, sessionManager, etc. as they
		// maintain user data that should persist across re-initializations
	}

	async setupGeminiScribe() {
		// Settings are already loaded in onload()

		// If re-initializing, cleanup first
		if (this.isGeminiInitialized) {
			await this.teardownGeminiScribe();
		}

		// Initialize prompts
		this.prompts = new GeminiPrompts(this);

		// Initialize prompt manager
		this.promptManager = new PromptManager(this, this.app.vault);

		// Note: API clients are now created on-demand by features using GeminiClientFactory
		this.gfile = new ScribeFile(this);

		// Initialize model manager
		this.modelManager = new ModelManager(this);
		await this.modelManager.initialize();

		// Update models if discovery is enabled
		if (this.settings.modelDiscovery.enabled) {
			this.updateModelsIfNeeded();
		}

		// Initialize history
		// Getting the vault folder for the import and export of history has to wait for the layout
		// to be ready, otherwise it throws an error when trying to access the vault.
		this.history = new GeminiHistory(this);
		await this.history.setupHistoryCommands();

		// Initialize session manager and session history
		this.sessionManager = new SessionManager(this);
		this.sessionHistory = new SessionHistory(this);

		// Initialize agents memory and example prompts
		this.agentsMemory = new AgentsMemory(this, agentsMemoryTemplateContent);
		this.examplePrompts = new ExamplePromptsManager(this);
		if (this.app.workspace.layoutReady) {
			await this.history.onLayoutReady;
		}

		// Initialize tool system
		this.toolRegistry = new ToolRegistry(this);
		this.toolExecutionEngine = new ToolExecutionEngine(this, this.toolRegistry);

		// Register vault tools
		const vaultTools = getVaultTools();
		for (const tool of vaultTools) {
			this.toolRegistry.registerTool(tool);
		}

		// Register extended vault tools (Frontmatter & Append)
		const { getExtendedVaultTools } = await import('./tools/vault-tools-extended');
		const extendedVaultTools = getExtendedVaultTools();
		for (const tool of extendedVaultTools) {
			this.toolRegistry.registerTool(tool);
		}

		// Register web tools (Google Search and Web Fetch)
		const { getWebTools } = await import('./tools/web-tools');
		const webTools = getWebTools();
		for (const tool of webTools) {
			this.toolRegistry.registerTool(tool);
		}

		// Register memory tools
		const { getMemoryTools } = await import('./tools/memory-tool');
		const memoryTools = getMemoryTools();
		for (const tool of memoryTools) {
			this.toolRegistry.registerTool(tool);
		}

		// Register image generation tools
		const { getImageTools } = await import('./tools/image-tools');
		const imageTools = getImageTools();
		for (const tool of imageTools) {
			this.toolRegistry.registerTool(tool);
		}

		// Initialize skill manager and register skill tools
		this.skillManager = new SkillManager(this);
		await this.skillManager.ensureSkillsDirectory();
		const { getSkillTools } = await import('./tools/skill-tools');
		const skillTools = getSkillTools();
		for (const tool of skillTools) {
			this.toolRegistry.registerTool(tool);
		}

		// Initialize MCP server connections (desktop only)
		this.mcpManager = new MCPManager(this);
		if (this.settings.mcpEnabled && !(this.app as any).isMobile) {
			await this.mcpManager.connectAllEnabled();
		}

		// Initialize completions
		this.completions = new GeminiCompletions(this);
		await this.completions.setupCompletions();
		await this.completions.setupCompletionsCommands();

		// Initialize summarization
		this.summarizer = new GeminiSummary(this);
		await this.summarizer.setupSummarizationCommand();

		// Initialize vault analyzer for AGENTS.md
		this.vaultAnalyzer = new VaultAnalyzer(this);
		this.vaultAnalyzer.setupInitCommand();

		// Initialize deep research service
		this.deepResearch = new DeepResearchService(this);

		// Initialize image generation
		this.imageGeneration = new ImageGeneration(this);
		await this.imageGeneration.setupImageGenerationCommand();

		// Initialize selection action service
		this.selectionActionService = new SelectionActionService(this);

		// Initialize RAG indexing if enabled
		// On startup, defer to onLayoutReady() to ensure metadata cache is ready
		// On settings change (layout already ready), initialize immediately
		if (this.app.workspace.layoutReady) {
			await this.initializeRagIndexing();
		}
		// If layout not ready, onLayoutReady() will call initializeRagIndexing()
	}

	/**
	 * Initialize or re-initialize RAG indexing service
	 * Should only be called when workspace layout is ready
	 */
	async initializeRagIndexing(): Promise<void> {
		if (this.settings.ragIndexing.enabled) {
			// Clean up existing instance if re-initializing (e.g., from saveSettings)
			if (this.ragIndexing) {
				// Unregister existing tools
				const { getRagTools } = await import('./tools/rag-search-tool');
				const ragTools = getRagTools();
				for (const tool of ragTools) {
					this.toolRegistry?.unregisterTool(tool.name);
				}

				// Destroy existing service
				await this.ragIndexing.destroy();
				this.ragIndexing = null;
			}

			try {
				this.ragIndexing = new RagIndexingService(this);
				await this.ragIndexing.initialize();

				// Register RAG search tools
				const { getRagTools } = await import('./tools/rag-search-tool');
				const ragTools = getRagTools();
				for (const tool of ragTools) {
					this.toolRegistry.registerTool(tool);
				}

				// Register file event listeners for auto-sync (only once per plugin lifetime)
				// These use optional chaining so they're safe even if ragIndexing is null
				if (!this.ragListenersRegistered) {
					this.registerEvent(
						this.app.vault.on('create', (file) => {
							if (file instanceof TFile && this.ragIndexing) {
								this.ragIndexing.onFileCreate(file);
							}
						})
					);
					this.registerEvent(
						this.app.vault.on('modify', (file) => {
							if (file instanceof TFile && this.ragIndexing) {
								this.ragIndexing.onFileModify(file);
							}
						})
					);
					this.registerEvent(
						this.app.vault.on('delete', (file) => {
							if (file instanceof TFile && this.ragIndexing) {
								this.ragIndexing.onFileDelete(file);
							}
						})
					);
					this.registerEvent(
						this.app.vault.on('rename', (file, oldPath) => {
							if (file instanceof TFile && this.ragIndexing) {
								this.ragIndexing.onFileRename(file, oldPath);
							}
						})
					);
					this.ragListenersRegistered = true;
				}
			} catch (error) {
				this.logger.error('Failed to initialize RAG indexing:', error);
				new Notice('Failed to initialize vault search index. Check console for details.');

				// Clean up partial initialization
				if (this.ragIndexing) {
					await this.ragIndexing.destroy().catch(() => {});
					this.ragIndexing = null;
				}
			}
		} else if (this.ragIndexing) {
			// RAG was disabled - clean up
			const { getRagTools } = await import('./tools/rag-search-tool');
			const ragTools = getRagTools();
			for (const tool of ragTools) {
				this.toolRegistry?.unregisterTool(tool.name);
			}

			await this.ragIndexing.destroy();
			this.ragIndexing = null;
		}
	}

	async activateAgentView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_AGENT);

		if (leaves.length > 0) {
			// A leaf with our view already exists, use that
			leaf = leaves[0];
			await workspace.revealLeaf(leaf);
		} else {
			// Our view could not be found in the workspace, create a new leaf
			// in the right sidebar for it
			leaf = workspace.getRightLeaf(false);
			if (leaf) {
				await leaf.setViewState({ type: VIEW_TYPE_AGENT, active: true });
				// "Reveal" the leaf in case it is in a collapsed sidebar
				await workspace.revealLeaf(leaf);
			} else {
				this.logger.error('Could not find a leaf to open the agent view');
			}
		}
	}

	async onLayoutReady() {
		// Setup prompts directory and commands after layout is ready
		if (this.promptManager) {
			await this.promptManager.ensurePromptsDirectory();
			await this.promptManager.createDefaultPrompts();
			// Setup prompt commands
			this.promptManager.setupPromptCommands();
		}

		await this.history.onLayoutReady();

		// Initialize RAG indexing now that metadata cache is ready
		// (deferred from setupGeminiScribe if layout wasn't ready)
		if (!this.ragIndexing && this.settings.ragIndexing.enabled) {
			await this.initializeRagIndexing();
		}

		// Check if history migration is needed
		await this.checkAndOfferMigration();

		// Check for version updates and show notification
		await this.checkForUpdates();
	}

	/**
	 * Check if this is a v4.0 upgrade and show welcome modal
	 */
	private async checkAndOfferMigration(): Promise<void> {
		try {
			// Only show modal once
			if (this.settings.hasSeenV4Welcome) {
				return;
			}

			const archiver = new HistoryArchiver(this);
			const needsArchiving = await archiver.needsArchiving();

			// Show welcome modal on first run after upgrade to 4.0
			if (needsArchiving) {
				// Show v4 welcome modal with archiving option
				const modal = new V4WelcomeModal(this.app, this);
				modal.open();
			}

			// Mark as seen so we don't perform this check again
			this.settings.hasSeenV4Welcome = true;
			await this.saveData(this.settings);
		} catch (error) {
			this.logger.error('Error checking for archiving:', error);
			// Don't show error to user - archiving is optional
		}
	}

	/**
	 * Check for version updates and show notification
	 */
	private async checkForUpdates(): Promise<void> {
		try {
			const currentVersion = this.manifest.version;
			const lastSeenVersion = this.settings.lastSeenVersion;

			// If this is a new version, show update notification
			if (currentVersion !== lastSeenVersion) {
				// Don't show notification for first-time installs (0.0.0)
				if (lastSeenVersion !== '0.0.0') {
					const modal = new UpdateNotificationModal(this.app, currentVersion);
					modal.open();
				}

				// Update the last seen version
				this.settings.lastSeenVersion = currentVersion;
				await this.saveData(this.settings);
			}
		} catch (error) {
			this.logger.error('Error checking for updates:', error);
			// Don't show error to user - update notifications are optional
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

		// Only run model version updates if dynamic discovery is disabled
		// When dynamic discovery is enabled, user model selections should be preserved
		if (!this.settings.modelDiscovery?.enabled) {
			await this.updateModelVersions();
		}
	}

	async updateModelVersions() {
		const { updatedSettings, settingsChanged, changedSettingsInfo } = getUpdatedModelSettings(this.settings);

		if (settingsChanged) {
			this.settings = updatedSettings as ObsidianGeminiSettings; // Cast back to specific type
			this.logger.log('ObsidianGemini: Updating model versions in settings...');
			changedSettingsInfo.forEach((info) => this.logger.log(`- ${info}`));
			await this.saveData(this.settings);
			new Notice('Gemini model settings updated to current defaults.');
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);

		// Check if we need to re-initialize
		const apiKeyChanged = this.previousApiKey !== this.settings.apiKey;
		const needsInit = !this.isGeminiInitialized && this.settings.apiKey;

		// Only re-initialize if API key changed or if not initialized but now have key
		if (apiKeyChanged || needsInit) {
			try {
				await this.setupGeminiScribe();
				this.isGeminiInitialized = true;
				this.previousApiKey = this.settings.apiKey;

				// If this is the first successful initialization, we may need to
				// re-register UI components to make them functional
				if (needsInit && !apiKeyChanged) {
					new Notice('Gemini Scribe is now ready to use!');
				}
			} catch (error) {
				this.logger.error('Failed to re-initialize after settings change:', error);
				this.isGeminiInitialized = false;
				// Don't show notice here as it may be annoying during normal settings changes
			}
		}

		// If model discovery settings changed, update models
		if (this.settings.modelDiscovery.enabled && this.modelManager) {
			this.updateModelsIfNeeded();
		}
	}

	/**
	 * Update models if auto-update interval has passed
	 */
	private async updateModelsIfNeeded(): Promise<void> {
		if (!this.settings.modelDiscovery.enabled || !this.modelManager) {
			return;
		}

		const now = Date.now();
		const lastUpdate = this.settings.modelDiscovery.lastUpdate;
		const intervalMs = this.settings.modelDiscovery.autoUpdateInterval * 60 * 60 * 1000; // hours to ms

		if (now - lastUpdate > intervalMs) {
			try {
				const result = await this.modelManager.updateModels({ preserveUserCustomizations: true });

				if (result.settingsChanged) {
					// Update settings with new model assignments
					this.settings = result.updatedSettings;
					await this.saveData(this.settings);

					// Notify user of changes
					if (result.changedSettingsInfo.length > 0) {
						this.logger.log('Model settings updated:', result.changedSettingsInfo.join(', '));
					}
				}

				// Update last update time
				this.settings.modelDiscovery.lastUpdate = now;
				await this.saveData(this.settings);
			} catch (error) {
				this.logger.warn('Failed to update models during auto-update:', error);
			}
		}
	}

	/**
	 * Get the model manager instance
	 */
	getModelManager(): ModelManager {
		return this.modelManager;
	}

	// Clean up resources on unload
	onunload() {
		this.logger.debug('Unloading Gemini Scribe');
		this.history?.onUnload();
		this.ribbonIcon?.remove();

		// Disconnect MCP servers
		if (this.mcpManager) {
			this.mcpManager.disconnectAll().catch((error) => {
				this.logger.error('Error disconnecting MCP servers:', error);
			});
			this.mcpManager = null;
		}

		// Clean up RAG indexing service
		if (this.ragIndexing) {
			// Unregister all RAG tools from the tool registry
			// Import dynamically to get tool names, then unregister
			import('./tools/rag-search-tool')
				.then(({ getRagTools }) => {
					const ragTools = getRagTools();
					for (const tool of ragTools) {
						this.toolRegistry?.unregisterTool(tool.name);
					}
				})
				.catch((error) => {
					this.logger.error('Error unregistering RAG tools:', error);
				});

			// Destroy the service (async but we don't need to await in onunload)
			this.ragIndexing.destroy().catch((error) => {
				this.logger.error('Error destroying RAG indexing service:', error);
			});
			this.ragIndexing = null;
		}
	}
}
