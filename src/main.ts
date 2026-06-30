import { Plugin, WorkspaceLeaf, Editor, MarkdownView, MarkdownFileInfo, Platform } from 'obsidian';
import ObsidianGeminiSettingTab from './ui/settings';
import { refreshGeminiModelList } from './ui/settings-general';
import { AgentView, VIEW_TYPE_AGENT } from './ui/agent-view/agent-view';
import { GeminiDiffView, VIEW_TYPE_DIFF } from './ui/agent-view/gemini-diff-view';
import { GeminiSummary } from './summary';
import { ImageGeneration } from './services/image-generation';
import { ScribeFile } from './files';
import { GeminiHistory } from './history/history';
import { GeminiCompletions } from './completions';
import { Notice } from 'obsidian';
import { getDefaultModelForRole, GeminiModel, ModelProvider } from './models';
import { ModelManager } from './services/model-manager';
import { PromptManager, GeminiPrompts } from './prompts';
import { SelectionRewriter } from './rewrite-selection';
import { RewriteInstructionsModal } from './ui/rewrite-modal';
import { UpdateNotificationModal } from './ui/update-notification-modal';
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
import { RagIndexingService } from './services/rag-indexing';
import { SelectionActionService } from './services/selection-action-service';
import { MCPManager } from './mcp/mcp-manager';
import { MCPServerConfig } from './mcp/types';
import { migrateServerEnvToSecretStorage } from './mcp/mcp-secrets';
import { ContextManager } from './services/context-manager';
import { SkillManager } from './services/skill-manager';
import { FolderInitializer } from './services/folder-initializer';
import { ToolPolicySettings, DEFAULT_TOOL_POLICY, PolicyPreset } from './types/tool-policy';
import { ProjectManager } from './services/project-manager';
import { AgentEventBus } from './agent/agent-event-bus';
import { ToolExecutionLogger } from './subscribers/tool-execution-logger';
import { LifecycleService } from './services/lifecycle-service';
import { BackgroundTaskManager } from './services/background-task-manager';
import { BackgroundStatusBar } from './services/background-status-bar';
import { ScheduledTaskManager } from './services/scheduled-task-manager';
import { HookManager } from './services/hook-manager';
import { getErrorMessage, getRawErrorMessage } from './utils/error-utils';
import { openPluginSettingsTab } from './utils/obsidian-settings';
import { t } from './i18n';

export interface RagIndexingSettings {
	enabled: boolean;
	fileSearchStoreName: string | null;
	excludeFolders: string[];
	autoSync: boolean;
	includeAttachments: boolean;
}

export interface ObsidianGeminiSettings {
	/** Active model provider. 'gemini' is the cloud default; 'ollama' targets a local Ollama daemon. */
	provider: ModelProvider;
	/** Base URL for the Ollama HTTP API. Only used when provider === 'ollama'. */
	ollamaBaseUrl: string;
	/** Optional custom base URL to override the default Google Gemini API endpoint. */
	customBaseUrl: string;
	apiKeySecretName: string;
	chatModelName: string;
	summaryModelName: string;
	completionsModelName: string;
	imageModelName: string;
	summaryFrontmatterKey: string;
	userName: string;
	chatHistory: boolean;
	historyFolder: string;
	debugMode: boolean;
	fileLogging: boolean;
	maxRetries: number;
	initialBackoffDelay: number;
	streamingEnabled: boolean;
	/**
	 * Use Google's GA Interactions API (`client.interactions.create`) as the
	 * Gemini transport instead of the legacy `generateContent`. Runs stateless
	 * (`store: false`); we still own and replay conversation history. Opt-in
	 * while the SDK surface settles — see epic #1013.
	 */
	useInteractionsApi: boolean;
	allowSystemPromptOverride: boolean;
	temperature: number;
	topP: number;
	stopOnToolError: boolean;
	// Tool loop detection settings
	loopDetectionEnabled: boolean;
	loopDetectionThreshold: number;
	loopDetectionTimeWindowSeconds: number;
	// Trusted Mode (legacy — migrated to toolPolicy)
	alwaysAllowReadWrite: boolean;
	// Tool policy settings
	toolPolicy: ToolPolicySettings;
	// Version tracking for update notifications
	lastSeenVersion: string;
	// RAG Indexing settings
	ragIndexing: RagIndexingSettings;
	// MCP server settings
	mcpEnabled: boolean;
	mcpServers: MCPServerConfig[];
	// Context management
	contextCompactionThreshold: number;
	showTokenUsage: boolean;
	// Diff review
	alwaysShowDiffView: boolean;
	// Tool execution logging
	logToolExecution: boolean;
	// Scheduled task catch-up
	autoRunCatchUp: boolean;
	// Lifecycle hooks (opt-in: AI runs triggered by vault events)
	hooksEnabled: boolean;
	// IDs of collapsible settings sections currently expanded; persists across reloads.
	expandedSettingsSections: string[];
	// Cached remote model list (managed by ModelListProvider)
	remoteModelCache?: { models: GeminiModel[]; timestamp: number };
}

const DEFAULT_SETTINGS: ObsidianGeminiSettings = {
	provider: 'gemini',
	ollamaBaseUrl: 'http://localhost:11434',
	customBaseUrl: '',
	apiKeySecretName: '',
	chatModelName: getDefaultModelForRole('chat'),
	summaryModelName: getDefaultModelForRole('summary'),
	completionsModelName: getDefaultModelForRole('completions'),
	imageModelName: getDefaultModelForRole('image'),
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

export default class ObsidianGemini extends Plugin {
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
	private checkInitialized(): boolean {
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
		if (this.settings.provider === 'ollama') {
			// Surface the captured init error when we have one \u2014 connectivity is the
			// most common Ollama failure but far from the only one (no model
			// selected, model not pulled, base URL points at a non-Ollama HTTP
			// server). The init-time Notice may have already disappeared by the
			// time the user invokes a guarded command, so reuse the error here
			// instead of always defaulting to "make sure the daemon is running".
			if (this.lastInitError) {
				return t('notice.main.initFailedFix', { error: this.lastInitError });
			}
			return t('notice.main.ollamaUnreachable', { url: this.settings.ollamaBaseUrl });
		}
		if (!this.settings.apiKeySecretName) {
			return t('notice.main.noApiKey');
		}
		return t('notice.main.apiKeyRetrieveFailed');
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
			this.activateAgentView();
		});

		// Register views
		// eslint-disable-next-line obsidianmd/no-view-references-in-plugin -- TODO: replace `this.agentView` reads with `app.workspace.getLeavesOfType(VIEW_TYPE_AGENT)`
		this.registerView(VIEW_TYPE_AGENT, (leaf) => (this.agentView = new AgentView(leaf, this)));
		this.registerView(VIEW_TYPE_DIFF, (leaf) => new GeminiDiffView(leaf, this));

		// Add command
		this.addCommand({
			id: 'gemini-scribe-open-agent-view',
			name: t('command.openAgentView'),
			callback: () => {
				if (!this.checkInitialized()) return;
				this.activateAgentView();
			},
		});

		// Refresh remote Gemini model list (bypass 24h cache)
		this.addCommand({
			id: 'gemini-scribe-refresh-model-list',
			name: t('command.refreshModelList'),
			callback: async () => {
				if (!this.checkInitialized()) return;
				await refreshGeminiModelList(this);
			},
		});

		// View background tasks
		this.addCommand({
			id: 'gemini-scribe-view-background-tasks',
			name: t('command.viewBackgroundTasks'),
			callback: async () => {
				const { BackgroundTasksModal } = await import('./ui/background-tasks-modal');
				// Command name is unambiguous, so always land on the Tasks tab.
				// The status-bar entry uses its own context-aware default.
				new BackgroundTasksModal(this.app, this, 'tasks').open();
			},
		});

		// Open scheduler management modal
		this.addCommand({
			id: 'gemini-scribe-open-scheduler',
			name: t('command.openScheduler'),
			callback: async () => {
				const { SchedulerManagementModal } = await import('./ui/scheduler-management-modal');
				new SchedulerManagementModal(this.app, this, 'list').open();
			},
		});

		// New scheduled task — jump straight to create form
		this.addCommand({
			id: 'gemini-scribe-new-scheduled-task',
			name: t('command.newScheduledTask'),
			callback: async () => {
				const { SchedulerManagementModal } = await import('./ui/scheduler-management-modal');
				new SchedulerManagementModal(this.app, this, 'create').open();
			},
		});

		// Open lifecycle hook management modal
		this.addCommand({
			id: 'gemini-scribe-open-hook-manager',
			name: t('command.openHookManager'),
			callback: async () => {
				const { HookManagementModal } = await import('./ui/hook-management-modal');
				new HookManagementModal(this.app, this, 'list').open();
			},
		});

		// New lifecycle hook — jump straight to create form
		this.addCommand({
			id: 'gemini-scribe-new-hook',
			name: t('command.newHook'),
			callback: async () => {
				const { HookManagementModal } = await import('./ui/hook-management-modal');
				new HookManagementModal(this.app, this, 'create').open();
			},
		});

		// View scheduled tasks (read-only legacy — kept for backwards compatibility)
		this.addCommand({
			id: 'gemini-scribe-view-scheduled-tasks',
			name: t('command.viewScheduledTasks'),
			callback: async () => {
				const { ScheduledTasksModal } = await import('./ui/scheduled-tasks-modal');
				new ScheduledTasksModal(this.app, this).open();
			},
		});

		// Switch project for the current agent session
		this.addCommand({
			id: 'gemini-scribe-switch-project',
			name: t('command.switchProject'),
			callback: () => {
				if (!this.checkInitialized()) return;
				this.activateAgentView();
				// The agent view's switchProject is triggered via the project badge in the header
				// or users can click the project indicator once the view is open
			},
		});

		// Create a new project
		this.addCommand({
			id: 'gemini-scribe-create-project',
			name: t('command.createProject'),
			callback: async () => {
				if (!this.checkInitialized()) return;
				const folder = this.app.workspace.getActiveFile()?.parent?.path || '';
				const name = 'New Project';
				try {
					const file = await this.projectManager.createProject(folder, name);
					await this.app.workspace.openLinkText(file.path, '', true);
					new Notice(t('notice.main.projectCreated', { path: file.path }));
				} catch (error) {
					this.logger.error('Failed to create project:', error);
					new Notice(t('notice.main.projectCreateFailed'));
				}
			},
		});

		// Convert current note to a project
		this.addCommand({
			id: 'gemini-scribe-convert-to-project',
			name: t('command.convertToProject'),
			editorCallback: async (_editor: Editor, view: MarkdownView | MarkdownFileInfo) => {
				if (!this.checkInitialized()) return;
				if (!view.file) return;
				try {
					await this.projectManager.convertNoteToProject(view.file);
					new Notice(t('notice.main.convertedToProject', { name: view.file.basename }));
				} catch (error) {
					this.logger.error('Failed to convert note to project:', error);
					new Notice(t('notice.main.convertToProjectFailed'));
				}
			},
		});

		// Open project settings (the project file itself)
		this.addCommand({
			id: 'gemini-scribe-open-project-settings',
			name: t('command.openProjectSettings'),
			callback: async () => {
				if (!this.checkInitialized()) return;
				const projects = this.projectManager?.discoverProjects() ?? [];
				if (projects.length === 0) {
					new Notice(t('notice.main.noProjectsFound'));
					return;
				}
				// If only one project, open it directly
				if (projects.length === 1) {
					await this.app.workspace.openLinkText(projects[0].filePath, '', true);
					return;
				}
				// Show picker for multiple projects
				const { ProjectPickerModal } = await import('./ui/agent-view/project-picker-modal');
				const modal = new ProjectPickerModal(this.app, this, {
					onSelect: async (project) => {
						if (project) {
							await this.app.workspace.openLinkText(project.filePath, '', true);
						}
					},
				});
				modal.open();
			},
		});

		// Resume the most recent session for a project
		this.addCommand({
			id: 'gemini-scribe-resume-project-session',
			name: t('command.resumeProjectSession'),
			callback: async () => {
				if (!this.checkInitialized()) return;
				const projects = this.projectManager?.discoverProjects() ?? [];
				if (projects.length === 0) {
					new Notice(t('notice.main.noProjectsFound'));
					return;
				}
				const { ProjectPickerModal } = await import('./ui/agent-view/project-picker-modal');
				const modal = new ProjectPickerModal(this.app, this, {
					onSelect: async (project) => {
						if (!project) return;
						// Find most recent session linked to this project
						const sessions = await this.sessionManager.getRecentAgentSessions(50);
						const projectSession = sessions.find((s) => s.projectPath === project.filePath);
						if (projectSession) {
							await this.activateAgentView();
							// The agent view will load the session
							if (this.agentView) {
								await this.agentView.loadSession(projectSession);
							}
						} else {
							new Notice(t('notice.main.noSessionsForProject', { name: project.name }));
						}
					},
				});
				modal.open();
			},
		});

		// Remove project status from a file
		this.addCommand({
			id: 'gemini-scribe-remove-project',
			name: t('command.removeProject'),
			editorCallback: async (_editor: Editor, view: MarkdownView | MarkdownFileInfo) => {
				if (!this.checkInitialized()) return;
				if (!view.file) return;
				try {
					await this.projectManager.removeProject(view.file);
					new Notice(t('notice.main.projectRemoved', { name: view.file.basename }));
				} catch (error) {
					this.logger.error('Failed to remove project:', error);
					new Notice(t('notice.main.projectRemoveFailed'));
				}
			},
		});

		// Add rewrite command (works with selection or full file)
		this.addCommand({
			id: 'gemini-scribe-rewrite-selection',
			name: t('command.rewriteSelection'),
			editorCallback: (editor: Editor, _view: MarkdownView | MarkdownFileInfo) => {
				if (!this.checkInitialized()) return;
				const selection = editor.getSelection();

				if (!selection || selection.trim().length === 0) {
					new Notice(t('notice.main.selectTextFirst'));
					return;
				}

				const textToRewrite = selection;
				const isFullFile = false;

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
			name: t('command.explainSelection'),
			editorCallback: async (editor: Editor, view: MarkdownView | MarkdownFileInfo) => {
				if (!this.checkInitialized()) return;
				await this.selectionActionService.handleExplainSelection(editor, view.file);
			},
		});

		// Add ask about selection command
		this.addCommand({
			id: 'gemini-scribe-ask-selection',
			name: t('command.askSelection'),
			editorCallback: async (editor: Editor, view: MarkdownView | MarkdownFileInfo) => {
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
									async (instructions) => {
										const rewriter = new SelectionRewriter(this);
										await rewriter.rewriteSelection(editor, selection, instructions);
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

		// Add command to view release notes
		this.addCommand({
			id: 'gemini-scribe-view-release-notes',
			name: t('command.viewReleaseNotes'),
			callback: () => {
				const modal = new UpdateNotificationModal(this.app, this.manifest.version);
				modal.open();
			},
		});

		// Image generation command (Gemini-only). Registered unconditionally so
		// the palette entry stays stable across runtime provider switches; the
		// callback gates on provider before touching the (potentially null)
		// `imageGeneration` service.
		this.addCommand({
			id: 'gemini-scribe-generate-image',
			name: t('command.generateImage'),
			callback: async () => {
				if (!this.checkInitialized()) return;
				if (this.settings.provider === 'ollama') {
					new Notice(t('notice.main.imageGenOllama'));
					return;
				}
				if (!this.imageGeneration) {
					new Notice(t('notice.main.imageGenUnavailable'));
					return;
				}
				const prompt = await this.imageGeneration.promptForImageDescription();
				if (prompt) {
					await this.imageGeneration.generateAndInsertImage(prompt);
				}
			},
		});

		// RAG indexing commands. Same pattern as image generation: register
		// unconditionally and gate at execution time so the palette stays
		// consistent and the user gets a clear "not available" notice on the
		// Ollama path (RAG depends on Gemini's File Search Store in Phase 1).
		this.addCommand({
			id: 'gemini-scribe-rag-pause',
			name: t('command.ragPause'),
			callback: () => {
				if (this.settings.provider === 'ollama') {
					new Notice(t('notice.main.ragOllamaUnavailable'));
					return;
				}
				if (!this.ragIndexing) {
					new Notice(t('notice.main.ragNotEnabled'));
					return;
				}
				if (this.ragIndexing.isPaused()) {
					new Notice(t('notice.main.ragAlreadyPaused'));
					return;
				}
				if (this.ragIndexing.isIndexing()) {
					new Notice(t('notice.main.ragCannotPauseWhileIndexing'));
					return;
				}
				this.ragIndexing.pause();
				new Notice(t('notice.main.ragPaused'));
			},
		});

		this.addCommand({
			id: 'gemini-scribe-rag-resume',
			name: t('command.ragResume'),
			callback: () => {
				if (this.settings.provider === 'ollama') {
					new Notice(t('notice.main.ragOllamaUnavailable'));
					return;
				}
				if (!this.ragIndexing) {
					new Notice(t('notice.main.ragNotEnabled'));
					return;
				}
				if (!this.ragIndexing.isPaused()) {
					new Notice(t('notice.main.ragNotPaused'));
					return;
				}
				this.ragIndexing.resume();
				new Notice(t('notice.main.ragResumed'));
			},
		});

		this.addCommand({
			id: 'gemini-scribe-rag-status',
			name: t('command.ragStatus'),
			callback: async () => {
				if (this.settings.provider === 'ollama') {
					new Notice(t('notice.main.ragOllamaUnavailable'));
					return;
				}
				if (!this.ragIndexing) {
					new Notice(t('notice.main.ragNotEnabled'));
					return;
				}
				// Trigger the same modal as clicking the status bar
				const { RagStatusModal } = await import('./ui/rag-status-modal');
				const modal = new RagStatusModal(
					this.app,
					this.ragIndexing.getDetailedStatus(),
					() => {
						// Open settings to RAG section
						openPluginSettingsTab(this.app, this.manifest.id);
					},
					async () => {
						// Reindex
						const { RagProgressModal } = await import('./ui/rag-progress-modal');
						const progressModal = new RagProgressModal(this.app, this.ragIndexing!, (result) => {
							new Notice(t('notice.main.ragIndexComplete', { indexed: result.indexed, skipped: result.skipped }));
						});
						progressModal.open();
						this.ragIndexing!.indexVault().catch((error: unknown) => {
							new Notice(t('notice.main.ragIndexFailed', { error: getErrorMessage(error) }));
						});
					},
					async () => {
						// Sync now
						const synced = await this.ragIndexing!.syncPendingChanges();
						if (synced) {
							new Notice(t('notice.main.ragSyncingPending'));
						}
						return synced;
					}
				);
				modal.open();
			},
		});

		// Agent session management commands
		this.addCommand({
			id: 'gemini-scribe-new-session',
			name: t('command.newSession'),
			callback: async () => {
				if (!this.checkInitialized()) return;
				// Check if the agent view already exists before activating it.
				// AgentView.onOpen() automatically creates a default session, so we only
				// call createNewSession() if the view was already open (user is asking for
				// a fresh session, not the existing default).
				const viewAlreadyExists = !!this.agentView;
				await this.activateAgentView();
				if (viewAlreadyExists && this.agentView) {
					await this.agentView.createNewSession();
				}
			},
		});

		this.addCommand({
			id: 'gemini-scribe-browse-sessions',
			name: t('command.browseSessions'),
			callback: async () => {
				if (!this.checkInitialized()) return;
				await this.activateAgentView();
				if (this.agentView) {
					await this.agentView.showSessionList();
				}
			},
		});

		this.addCommand({
			id: 'gemini-scribe-link-project',
			name: t('command.linkProject'),
			callback: async () => {
				if (!this.checkInitialized()) return;
				await this.activateAgentView();
				if (this.agentView) {
					this.agentView.switchProject();
				}
			},
		});

		this.addCommand({
			id: 'gemini-scribe-session-settings',
			name: t('command.sessionSettings'),
			callback: async () => {
				if (!this.checkInitialized()) return;
				await this.activateAgentView();
				if (this.agentView) {
					await this.agentView.showSessionSettings();
				}
			},
		});

		this.addCommand({
			id: 'gemini-scribe-toggle-plan-mode',
			name: t('command.togglePlanMode'),
			callback: async () => {
				if (!this.checkInitialized()) return;
				await this.activateAgentView();
				if (this.agentView) {
					this.agentView.togglePlanMode();
				}
			},
		});
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
		const data = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);

		// One-time migration: move API key from data.json to secret storage
		if (!this.settings.apiKeySecretName && data?.apiKey) {
			this.app.secretStorage.setSecret(MIGRATION_SECRET_NAME, data.apiKey);
			// Verify the secret was stored before deleting the original
			const stored = this.app.secretStorage.getSecret(MIGRATION_SECRET_NAME);
			if (stored === data.apiKey) {
				this.settings.apiKeySecretName = MIGRATION_SECRET_NAME;
				delete (this.settings as any).apiKey;
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
		if (data?.modelDiscovery !== undefined || data?.modelDiscoveryCache !== undefined) {
			delete (this.settings as any).modelDiscovery;
			delete (this.settings as any).modelDiscoveryCache;
			await this.saveData(this.settings);
			this.logger?.log('Removed deprecated model discovery settings');
		}

		// Note: Stale model reconciliation happens later in LifecycleService.syncModels(),
		// after ModelListProvider has loaded the cached remote model list. Running it here
		// against DEFAULT_GEMINI_MODELS would use a stale list.

		// Migrate legacy alwaysAllowReadWrite → toolPolicy
		if (data?.alwaysAllowReadWrite !== undefined && !data?.toolPolicy) {
			this.settings.toolPolicy = {
				activePreset: data.alwaysAllowReadWrite ? PolicyPreset.EDIT_MODE : PolicyPreset.CAUTIOUS,
				toolPermissions: {},
			};
			// Clear the legacy setting
			delete (this.settings as any).alwaysAllowReadWrite;
			await this.saveData(this.settings);
			this.logger?.log(
				`Migrated alwaysAllowReadWrite=${data.alwaysAllowReadWrite} → toolPolicy.activePreset=${this.settings.toolPolicy.activePreset}`
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
