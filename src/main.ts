import { Plugin, WorkspaceLeaf, Platform } from 'obsidian';
import ObsidianGeminiSettingTab from './ui/settings';
import { AgentView, VIEW_TYPE_AGENT } from './ui/agent-view/agent-view';
import { GeminiDiffView, VIEW_TYPE_DIFF } from './ui/agent-view/gemini-diff-view';
import { GeminiSummary } from './summary';
import { ImageGeneration } from './services/image-generation';
import { ScribeFile } from './files';
import { GeminiHistory } from './history/history';
import { GeminiCompletions } from './completions';
import { Notice } from 'obsidian';
import { getDefaultModelForRole, migrateOllamaModelSetting, ModelProvider } from './models';
import { ModelManager } from './services/model-manager';
import { PromptManager, GeminiPrompts } from './prompts';
import { SelectionRewriter } from './rewrite-selection';
import { RewriteInstructionsModal } from './ui/rewrite-modal';
import { registerCommands } from './commands/register-commands';
import { SessionManager } from './agent/session-manager';
import { ToolRegistry } from './tools/tool-registry';
import { ToolExecutionEngine } from './tools/execution-engine';
import { SessionHistory } from './agent/session-history';
import { AgentsMemory } from './services/agents-memory';
import { ExamplePromptsManager } from './services/example-prompts';
import { VaultAnalyzer } from './services/vault-analyzer';
import { DeepResearchService } from './services/deep-research';
import { Logger } from './utils/logger';
import { FileLogWriter } from './utils/file-log-writer';
import { getApiKeyErrorMessage as buildApiKeyErrorMessage } from './utils/init-error-message';
import { RagIndexingService } from './services/rag-indexing';
import { SelectionActionService } from './services/selection-action-service';
import { MCPManager } from './mcp/mcp-manager';
import { migrateServerEnvToSecretStorage } from './mcp/mcp-secrets';
import { ContextManager } from './services/context-manager';
import { SkillManager } from './services/skill-manager';
import { FolderInitializer } from './services/folder-initializer';
import { DEFAULT_TOOL_POLICY, PolicyPreset } from './types/tool-policy';
import { ProjectManager } from './services/project-manager';
import { AgentEventBus } from './agent/agent-event-bus';
import { ToolExecutionLogger } from './subscribers/tool-execution-logger';
import { LifecycleService } from './services/lifecycle-service';
import { BackgroundTaskManager } from './services/background-task-manager';
import { BackgroundStatusBar } from './services/background-status-bar';
import { ScheduledTaskManager } from './services/scheduled-task-manager';
import { HookManager } from './services/hook-manager';
import { asRecord, getRawErrorMessage } from './utils/error-utils';
import { t } from './i18n';

// Settings interfaces live in a leaf module so the rest of the codebase can
// reference them without importing this hub file (see #1155).
import type { ObsidianGeminiSettings } from './types/settings';
export type { ObsidianGeminiSettings, RagIndexingSettings } from './types/settings';
// The interface the rest of the codebase depends on instead of this class; the
// `implements` clause below keeps it (and its ./types/plugin-services.ts
// augmentation) in sync with the real plugin surface.
import type { ObsidianGemini as ObsidianGeminiApi } from './types/plugin';

const DEFAULT_SETTINGS: ObsidianGeminiSettings = {
	provider: 'gemini',
	ollamaBaseUrl: 'http://localhost:11434',
	customBaseUrl: '',
	apiKeySecretName: '',
	chatModelName: getDefaultModelForRole('chat'),
	summaryModelName: getDefaultModelForRole('summary'),
	completionsModelName: getDefaultModelForRole('completions'),
	imageModelName: getDefaultModelForRole('image'),
	ollamaModelName: getDefaultModelForRole('chat', 'ollama'),
	summaryFrontmatterKey: 'summary',
	userName: 'User',
	chatHistory: false,
	historyFolder: 'gemini-scribe',
	debugMode: false,
	fileLogging: false,
	maxRetries: 3,
	initialBackoffDelay: 1000,
	streamingEnabled: true,
	useInteractionsApi: false,
	allowSystemPromptOverride: false,
	temperature: 0.7,
	topP: 1,
	stopOnToolError: true,
	// Tool loop detection settings
	loopDetectionEnabled: true,
	loopDetectionThreshold: 3,
	loopDetectionTimeWindowSeconds: 30,
	// Trusted Mode (legacy — migrated to toolPolicy)
	alwaysAllowReadWrite: false,
	// Tool policy settings
	toolPolicy: { ...DEFAULT_TOOL_POLICY },
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
	// Context management
	contextCompactionThreshold: 20,
	showTokenUsage: false,
	// Diff review
	alwaysShowDiffView: false,
	// Tool execution logging
	logToolExecution: true,
	// Scheduled task catch-up
	autoRunCatchUp: false,
	// Lifecycle hooks default off (opt-in)
	hooksEnabled: false,
	// All settings sections start collapsed
	expandedSettingsSections: [],
};

const MIGRATION_SECRET_NAME = 'gemini-scribe-api-key';

export default class ObsidianGemini extends Plugin implements ObsidianGeminiApi {
	settings!: ObsidianGeminiSettings;

	get apiKey(): string {
		// Ollama runs locally with no auth, so no key is required.
		if (this.settings?.provider === 'ollama') return '';
		const secretName = this.settings?.apiKeySecretName;
		if (!secretName) return '';
		return this.app.secretStorage.getSecret(secretName) ?? '';
	}

	// Public service properties — assigned by LifecycleService
	public gfile!: ScribeFile;
	public agentView!: AgentView;
	public history!: GeminiHistory;
	public sessionHistory!: SessionHistory;
	public promptManager!: PromptManager;
	public prompts!: GeminiPrompts;
	public sessionManager!: SessionManager;
	public toolRegistry!: ToolRegistry;
	public toolExecutionEngine!: ToolExecutionEngine;
	public agentsMemory!: AgentsMemory;
	public examplePrompts!: ExamplePromptsManager;
	public vaultAnalyzer!: VaultAnalyzer;
	public deepResearch!: DeepResearchService;
	public imageGeneration: ImageGeneration | null = null;
	public logger!: Logger;
	public fileLogWriter: FileLogWriter | null = null;
	public ragIndexing: RagIndexingService | null = null;
	public selectionActionService!: SelectionActionService;
	public mcpManager: MCPManager | null = null;
	public skillManager!: SkillManager;
	public contextManager!: ContextManager;
	public folderInitializer: FolderInitializer | null = null;
	public modelManager!: ModelManager;
	public completions: GeminiCompletions | null = null;
	public summarizer: GeminiSummary | null = null;
	public projectManager!: ProjectManager;
	public agentEventBus!: AgentEventBus;
	public toolExecutionLogger: ToolExecutionLogger | null = null;
	public backgroundTaskManager: BackgroundTaskManager | null = null;
	public backgroundStatusBar: BackgroundStatusBar | null = null;
	public scheduledTaskManager: ScheduledTaskManager | null = null;
	public hookManager: HookManager | null = null;

	// Snapshot of the last non-empty editor selection at the moment the user
	// engaged the agent input. Used as a fallback in GetWorkspaceStateTool,
	// whose live read of view.editor.getSelection() returns empty once focus
	// has moved to the agent chat input.
	public lastEditorSelection: { path: string; text: string } | null = null;

	// Private members
	private ribbonIcon!: HTMLElement;
	public isGeminiInitialized: boolean = false;
	private previousApiKey: string = '';
	private previousRagEnabled: boolean = false;
	private previousProvider: ModelProvider = 'gemini';
	private previousOllamaBaseUrl: string = '';
	private previousCustomBaseUrl: string = '';
	private previousHooksEnabled: boolean = false;
	private lifecycle!: LifecycleService;
	// Captures the last initialization failure so guarded commands can surface
	// the actual cause (e.g. "model not pulled") instead of the ephemeral Notice
	// the user may have missed. Cleared on a subsequent successful init.
	private lastInitError: string | null = null;

	async onload() {
		// Initialize logger early so it's available during setup
		this.logger = new Logger(this);

		// Load settings early
		await this.loadSettings();

		// Initialize file log writer if enabled
		if (this.settings.fileLogging) {
			this.fileLogWriter = new FileLogWriter(this);
		}

		// Add settings tab early so users can configure API key even if plugin fails to fully initialize
		this.addSettingTab(new ObsidianGeminiSettingTab(this.app, this));

		// Initialize lifecycle service
		this.lifecycle = new LifecycleService(this);

		// Try to setup the plugin, but don't fail if API key is missing
		try {
			await this.lifecycle.setup();
			this.isGeminiInitialized = true;
			this.lastInitError = null;
			this.previousApiKey = this.apiKey;
			this.previousRagEnabled = this.settings.ragIndexing.enabled;
			this.previousProvider = this.settings.provider;
			this.previousOllamaBaseUrl = this.settings.ollamaBaseUrl;
			this.previousCustomBaseUrl = this.settings.customBaseUrl;
			this.previousHooksEnabled = this.settings.hooksEnabled;
		} catch (error) {
			this.logger.error('Failed to initialize Gemini Scribe:', error);
			this.lastInitError = getRawErrorMessage(error);
			new Notice(this.getInitErrorMessage(error));
			this.isGeminiInitialized = false;
		}

		// Always register UI components and commands
		this.registerUIAndCommands();

		this.app.workspace.onLayoutReady(() => this.lifecycle.onLayoutReady());
	}

	/**
	 * Check if the plugin is initialized and show a notice if not
	 * @returns true if initialized, false otherwise
	 */
	public checkInitialized(): boolean {
		if (!this.isGeminiInitialized) {
			new Notice(this.getApiKeyErrorMessage());
			return false;
		}
		return true;
	}

	/**
	 * Get an appropriate error message based on the current API key state.
	 * Distinguishes between "never configured" and "storage retrieval failure".
	 */
	private getApiKeyErrorMessage(): string {
		return buildApiKeyErrorMessage({
			provider: this.settings.provider,
			lastInitError: this.lastInitError,
			apiKeySecretName: this.settings.apiKeySecretName,
			ollamaBaseUrl: this.settings.ollamaBaseUrl,
		});
	}

	/**
	 * Get an appropriate error message for initialization failures.
	 * Provides specific guidance depending on whether the error is API-key-related.
	 */
	private getInitErrorMessage(error: unknown): string {
		if (error instanceof Error && error.message.includes('API key')) {
			return this.getApiKeyErrorMessage();
		}
		const detail = getRawErrorMessage(error);
		return t('notice.main.initFailedConsole', { error: detail });
	}

	/**
	 * Register UI components and commands
	 * This runs regardless of whether Gemini initialization succeeded
	 */
	private registerUIAndCommands() {
		// Add ribbon icon
		this.ribbonIcon = this.addRibbonIcon('sparkles', t('ribbon.agentMode'), () => {
			if (!this.checkInitialized()) return;
			// Fire-and-forget: opening the view is a UI action; errors surface via Obsidian.
			void this.activateAgentView();
		});

		// Register views
		// eslint-disable-next-line obsidianmd/no-view-references-in-plugin -- TODO: replace `this.agentView` reads with `app.workspace.getLeavesOfType(VIEW_TYPE_AGENT)`
		this.registerView(VIEW_TYPE_AGENT, (leaf) => (this.agentView = new AgentView(leaf, this)));
		this.registerView(VIEW_TYPE_DIFF, (leaf) => new GeminiDiffView(leaf, this));

		// Register all command-palette commands (extracted to ./commands/register-commands)
		registerCommands(this);

		// Add context menu items for selection actions
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu, editor, view) => {
				const selection = editor.getSelection();
				if (selection) {
					// Rewrite with Gemini
					menu.addItem((item) => {
						item
							.setTitle(t('menu.main.rewriteText'))
							.setIcon('bot-message-square')
							.onClick(() => {
								if (!this.checkInitialized()) return;

								if (!selection || selection.trim().length === 0) {
									new Notice(t('notice.main.selectTextFirst'));
									return;
								}

								const modal = new RewriteInstructionsModal(
									this.app,
									selection,
									(instructions) => {
										void (async () => {
											const rewriter = new SelectionRewriter(this);
											await rewriter.rewriteSelection(editor, selection, instructions);
										})();
									},
									false // Context menu is always for selection, not full file
								);
								modal.open();
							});
					});

					// Ask Question
					menu.addItem((item) => {
						item
							.setTitle(t('menu.main.askQuestion'))
							.setIcon('message-circle')
							.onClick(async () => {
								if (!this.checkInitialized()) return;
								const sourceFile = view.file;
								await this.selectionActionService.handleAskAboutSelection(editor, sourceFile);
							});
					});

					// Apply Prompt
					menu.addItem((item) => {
						item
							.setTitle(t('menu.main.applyPrompt'))
							.setIcon('help-circle')
							.onClick(async () => {
								if (!this.checkInitialized()) return;
								const sourceFile = view.file;
								await this.selectionActionService.handleExplainSelection(editor, sourceFile);
							});
					});
				}
			})
		);
	}

	async activateAgentView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_AGENT);

		// On mobile, prefer a main-area tab so the agent view gets the full screen
		// instead of a cramped slide-out drawer. If an existing leaf lives in a
		// sidebar (leftover from a prior install), detach it so we can create a
		// fresh main-area leaf.
		if (Platform.isMobile) {
			const rootSplit = workspace.rootSplit;
			const mainLeaf = leaves.find((l) => l.getRoot() === rootSplit) ?? null;
			if (mainLeaf) {
				leaf = mainLeaf;
				await workspace.revealLeaf(leaf);
			} else {
				for (const sidebarLeaf of leaves) sidebarLeaf.detach();
				leaf = workspace.getLeaf('tab');
				if (leaf) {
					await leaf.setViewState({ type: VIEW_TYPE_AGENT, active: true });
					await workspace.revealLeaf(leaf);
				} else {
					this.logger.error('Could not find a leaf to open the agent view');
				}
			}
			return;
		}

		if (leaves.length > 0) {
			// A leaf with our view already exists, use that
			leaf = leaves[0];
			await workspace.revealLeaf(leaf);
		} else {
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

	async loadSettings() {
		const rawData: unknown = await this.loadData();
		const data = asRecord(rawData);
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);

		// One-time migration: split the Ollama model out of the shared chatModelName
		// field so switching providers no longer clobbers either choice. See
		// migrateOllamaModelSetting for the full rationale.
		if (migrateOllamaModelSetting(this.settings, data)) {
			await this.saveData(this.settings);
			this.logger?.log('Migrated Ollama model into its own setting (ollamaModelName)');
		}

		// One-time migration: move API key from data.json to secret storage
		const legacyApiKey = data.apiKey;
		if (!this.settings.apiKeySecretName && typeof legacyApiKey === 'string' && legacyApiKey) {
			this.app.secretStorage.setSecret(MIGRATION_SECRET_NAME, legacyApiKey);
			// Verify the secret was stored before deleting the original
			const stored = this.app.secretStorage.getSecret(MIGRATION_SECRET_NAME);
			if (stored === legacyApiKey) {
				this.settings.apiKeySecretName = MIGRATION_SECRET_NAME;
				delete (this.settings as { apiKey?: unknown }).apiKey;
				await this.saveData(this.settings);
				this.logger?.log('Migrated API key from settings to secure storage');
			} else {
				this.logger?.error('API key migration failed: verification mismatch, keeping key in settings');
			}
		}

		// One-time migration: move MCP stdio server env vars out of data.json into
		// SecretStorage. Desktop-only — env feeds stdio servers, which never run on
		// mobile; migrating on a mobile device first would strip env from the synced
		// data.json before any desktop copies it into its (non-syncing) keychain.
		if (!(this.app as { isMobile?: boolean }).isMobile) {
			const migrated = migrateServerEnvToSecretStorage(this.app, this.settings.mcpServers, this.logger);
			if (migrated) {
				await this.saveData(this.settings);
				this.logger?.log('Migrated MCP server env vars to secure storage');
			}
		}

		// Migrate: remove deprecated modelDiscovery and modelDiscoveryCache
		if (data.modelDiscovery !== undefined || data.modelDiscoveryCache !== undefined) {
			delete (this.settings as { modelDiscovery?: unknown }).modelDiscovery;
			delete (this.settings as { modelDiscoveryCache?: unknown }).modelDiscoveryCache;
			await this.saveData(this.settings);
			this.logger?.log('Removed deprecated model discovery settings');
		}

		// Note: Stale model reconciliation happens later in LifecycleService.syncModels(),
		// after ModelListProvider has loaded the cached remote model list. Running it here
		// against DEFAULT_GEMINI_MODELS would use a stale list.

		// Migrate legacy alwaysAllowReadWrite → toolPolicy
		const legacyAllowReadWrite = data.alwaysAllowReadWrite;
		if (legacyAllowReadWrite !== undefined && !data.toolPolicy) {
			this.settings.toolPolicy = {
				activePreset: legacyAllowReadWrite ? PolicyPreset.EDIT_MODE : PolicyPreset.CAUTIOUS,
				toolPermissions: {},
			};
			// Clear the legacy setting
			delete (this.settings as { alwaysAllowReadWrite?: unknown }).alwaysAllowReadWrite;
			await this.saveData(this.settings);
			this.logger?.log(
				`Migrated alwaysAllowReadWrite=${legacyAllowReadWrite ? 'true' : 'false'} → toolPolicy.activePreset=${this.settings.toolPolicy.activePreset}`
			);
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);

		// Check if we need to re-initialize
		const apiKeyChanged = this.previousApiKey !== this.apiKey;
		const providerChanged = this.previousProvider !== this.settings.provider;
		const ollamaUrlChanged =
			this.settings.provider === 'ollama' && this.previousOllamaBaseUrl !== this.settings.ollamaBaseUrl;
		const customBaseUrlChanged =
			this.settings.provider === 'gemini' && this.previousCustomBaseUrl !== this.settings.customBaseUrl;
		// Ollama needs no API key, so first-time init triggers on provider switch alone.
		const hasCredentials = this.settings.provider === 'ollama' || !!this.apiKey;
		const needsInit = !this.isGeminiInitialized && hasCredentials;

		if (apiKeyChanged || providerChanged || ollamaUrlChanged || customBaseUrlChanged || needsInit) {
			try {
				await this.lifecycle.setup();
				this.isGeminiInitialized = true;
				this.lastInitError = null;
				this.previousApiKey = this.apiKey;
				this.previousRagEnabled = this.settings.ragIndexing.enabled;
				this.previousProvider = this.settings.provider;
				this.previousOllamaBaseUrl = this.settings.ollamaBaseUrl;
				this.previousCustomBaseUrl = this.settings.customBaseUrl;
				this.previousHooksEnabled = this.settings.hooksEnabled;

				// If this is the first successful initialization, we may need to
				// re-register UI components to make them functional
				if (needsInit && !apiKeyChanged && !providerChanged) {
					new Notice(t('notice.main.readyToUse'));
				}
			} catch (error) {
				this.logger.error('Failed to re-initialize after settings change:', error);
				this.lastInitError = getRawErrorMessage(error);
				this.isGeminiInitialized = false;
			}
		}

		// Re-create plugin state folders if historyFolder changed (idempotent)
		if (this.isGeminiInitialized && this.app.workspace.layoutReady) {
			await this.lifecycle.initializePluginFolders();
		}

		// Handle RAG indexing state changes independently of full re-initialization
		if (this.isGeminiInitialized && this.app.workspace.layoutReady) {
			const ragStateChanged = this.previousRagEnabled !== this.settings.ragIndexing.enabled;
			if (ragStateChanged) {
				const nextRagEnabled = this.settings.ragIndexing.enabled;
				await this.lifecycle.initializeRagIndexing();

				// Advance tracker only if runtime state now matches requested state
				const transitioned = nextRagEnabled ? this.ragIndexing !== null : this.ragIndexing === null;
				if (transitioned) {
					this.previousRagEnabled = nextRagEnabled;
				}
			}
		}

		// Handle hooksEnabled toggle without a full plugin reload — flipping
		// the setting triggers a HookManager.initialize({ refresh: true })
		// which tears down and re-registers vault listeners against the
		// freshly-loaded enabled state.
		if (this.isGeminiInitialized && this.app.workspace.layoutReady) {
			const hooksStateChanged = this.previousHooksEnabled !== this.settings.hooksEnabled;
			if (hooksStateChanged && this.hookManager) {
				await this.hookManager.initialize({ refresh: true });
				this.previousHooksEnabled = this.settings.hooksEnabled;
			}
		}

		// Reconcile ToolExecutionLogger with the current logToolExecution setting.
		// The logger is a persistent service, but this flag can be toggled at runtime.
		this.lifecycle.syncToolExecutionLogger();

		// Sync file log writer with current fileLogging setting
		if (this.settings.fileLogging && !this.fileLogWriter) {
			this.fileLogWriter = new FileLogWriter(this);
		} else if (!this.settings.fileLogging && this.fileLogWriter) {
			await this.fileLogWriter.destroy();
			this.fileLogWriter = null;
		}
	}

	/**
	 * Get the model manager instance
	 */
	getModelManager(): ModelManager {
		return this.modelManager;
	}

	// Clean up resources on unload.
	//
	// NOTE: Obsidian's Plugin.onunload is typed as `() => void` and is NOT
	// awaited by the host — returning a Promise here would not delay teardown.
	// lifecycle.onUnload() is still async internally so tests and internal
	// callers can await it, but from the plugin entry point we invoke it as
	// fire-and-forget with an error handler. Disposables that truly need
	// deterministic cleanup should be registered via plugin.register*
	// helpers (registerEvent, registerDomEvent, addCommand, etc.) so that
	// Obsidian cleans them up automatically.
	onunload() {
		this.ribbonIcon?.remove();
		this.lifecycle?.onUnload().catch((err) => {
			this.logger.error('Error during plugin unload cleanup:', err);
		});
	}
}
