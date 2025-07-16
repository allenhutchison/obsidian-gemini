import { Plugin, WorkspaceLeaf, Editor, MarkdownView } from 'obsidian';
import ObsidianGeminiSettingTab from './ui/settings';
import { GeminiView, VIEW_TYPE_GEMINI } from './ui/gemini-view';
import { AgentView, VIEW_TYPE_AGENT } from './ui/agent-view';
import { GeminiSummary } from './summary';
import { ApiFactory, ModelApi, ApiProvider } from './api/index';
import { ScribeFile } from './files';
import { GeminiHistory } from './history/history';
import { GeminiCompletions } from './completions';
import { Notice } from 'obsidian';
import { GEMINI_MODELS, getDefaultModelForRole, getUpdatedModelSettings } from './models';
import { ModelManager } from './services/model-manager';
import { PromptManager } from './prompts/prompt-manager';
import { GeminiPrompts } from './prompts';
import { SelectionRewriter } from './rewrite-selection';
import { RewriteInstructionsModal } from './ui/rewrite-modal';
import { SessionManager } from './agent/session-manager';
import { ToolRegistry } from './tools/tool-registry';
import { ToolExecutionEngine } from './tools/execution-engine';
import { getVaultTools } from './tools/vault-tools';
import { SessionHistory } from './agent/session-history';

export interface ModelDiscoverySettings {
	enabled: boolean;
	autoUpdateInterval: number; // hours
	lastUpdate: number;
	fallbackToStatic: boolean;
}

export interface ObsidianGeminiSettings {
	apiKey: string;
	apiProvider: string;
	chatModelName: string;
	summaryModelName: string;
	completionsModelName: string;
	sendContext: boolean;
	maxContextDepth: number;
	searchGrounding: boolean;
	summaryFrontmatterKey: string;
	userName: string;
	chatHistory: boolean;
	historyFolder: string;
	showModelPicker: boolean;
	debugMode: boolean;
	maxRetries: number;
	initialBackoffDelay: number;
	streamingEnabled: boolean;
	modelDiscovery: ModelDiscoverySettings;
	enableCustomPrompts: boolean;
	allowSystemPromptOverride: boolean;
	temperature: number;
	topP: number;
	stopOnToolError: boolean;
	// Tool loop detection settings
	loopDetectionEnabled: boolean;
	loopDetectionThreshold: number;
	loopDetectionTimeWindowSeconds: number;
}

const DEFAULT_SETTINGS: ObsidianGeminiSettings = {
	apiKey: '',
	apiProvider: ApiProvider.GEMINI,
	chatModelName: getDefaultModelForRole('chat'),
	summaryModelName: getDefaultModelForRole('summary'),
	completionsModelName: getDefaultModelForRole('completions'),
	sendContext: false,
	maxContextDepth: 2,
	searchGrounding: false,
	summaryFrontmatterKey: 'summary',
	userName: 'User',
	chatHistory: false,
	historyFolder: 'gemini-scribe',
	showModelPicker: false,
	debugMode: false,
	maxRetries: 3,
	initialBackoffDelay: 1000,
	streamingEnabled: true,
	modelDiscovery: {
		enabled: false, // Start disabled by default
		autoUpdateInterval: 24, // Check daily
		lastUpdate: 0,
		fallbackToStatic: true,
	},
	enableCustomPrompts: false,
	allowSystemPromptOverride: false,
	temperature: 0.7,
	topP: 1,
	stopOnToolError: true,
	// Tool loop detection settings
	loopDetectionEnabled: true,
	loopDetectionThreshold: 3,
	loopDetectionTimeWindowSeconds: 30,
};

export default class ObsidianGemini extends Plugin {
	settings: ObsidianGeminiSettings;

	// Public members
	public geminiApi: ModelApi;
	public gfile: ScribeFile;
	public geminiView: GeminiView;
	public agentView: AgentView;
	public history: GeminiHistory;
	public sessionHistory: SessionHistory;
	public promptManager: PromptManager;
	public prompts: GeminiPrompts;
	public sessionManager: SessionManager;
	public toolRegistry: ToolRegistry;
	public toolExecutionEngine: ToolExecutionEngine;

	// Private members
	private summarizer: GeminiSummary;
	private ribbonIcon: HTMLElement;
	private completions: GeminiCompletions;
	private modelManager: ModelManager;

	async onload() {
		await this.setupGeminiScribe();

		// Add ribbon icons
		this.ribbonIcon = this.addRibbonIcon('sparkles', 'Open Gemini Chat', () => {
			this.activateView();
		});

		this.addRibbonIcon('bot', 'Open Agent Mode', () => {
			this.activateAgentView();
		});

		// Register views
		this.registerView(VIEW_TYPE_GEMINI, (leaf) => (this.geminiView = new GeminiView(leaf, this)));
		this.registerView(VIEW_TYPE_AGENT, (leaf) => (this.agentView = new AgentView(leaf, this)));

		// Add commands
		this.addCommand({
			id: 'gemini-scribe-open-view',
			name: 'Open Gemini Chat',
			callback: () => this.activateView(),
		});

		this.addCommand({
			id: 'gemini-scribe-open-agent-view',
			name: 'Open Agent Mode',
			callback: () => this.activateAgentView(),
		});

		// Add selection rewrite command
		this.addCommand({
			id: 'gemini-scribe-rewrite-selection',
			name: 'Rewrite selected text with AI',
			editorCheckCallback: (checking: boolean, editor: Editor, view: MarkdownView) => {
				const selection = editor.getSelection();
				
				if (checking) {
					// Command only available when text is selected
					return selection.length > 0;
				}
				
				// Show modal for instructions
				const modal = new RewriteInstructionsModal(
					this.app,
					selection,
					async (instructions) => {
						const rewriter = new SelectionRewriter(this);
						await rewriter.rewriteSelection(
							editor,
							selection,
							instructions
						);
					}
				);
				modal.open();
			}
		});

		// Add context menu item for selection rewrite
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu, editor, view) => {
				const selection = editor.getSelection();
				if (selection) {
					menu.addItem((item) => {
						item
							.setTitle('Rewrite with Gemini')
							.setIcon('bot-message-square')
							.onClick(() => {
								const modal = new RewriteInstructionsModal(
									this.app,
									selection,
									async (instructions) => {
										const rewriter = new SelectionRewriter(this);
										await rewriter.rewriteSelection(
											editor,
											selection,
											instructions
										);
									}
								);
								modal.open();
							});
					});
				}
			})
		);

		this.addSettingTab(new ObsidianGeminiSettingTab(this.app, this));

		this.app.workspace.onLayoutReady(() => this.onLayoutReady());
	}

	async setupGeminiScribe() {
		await this.loadSettings();

		// Initialize prompts
		this.prompts = new GeminiPrompts(this);

		// Initialize prompt manager
		this.promptManager = new PromptManager(this, this.app.vault);

		this.geminiApi = ApiFactory.createApi(this);
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
		
		// Register web tools (Google Search and Web Fetch)
		const { getWebTools } = await import('./tools/web-tools');
		const webTools = getWebTools();
		for (const tool of webTools) {
			this.toolRegistry.registerTool(tool);
		}

		// Initialize completions
		this.completions = new GeminiCompletions(this);
		await this.completions.setupCompletions();
		await this.completions.setupCompletionsCommands();

		// Initialize summarization
		this.summarizer = new GeminiSummary(this);
		await this.summarizer.setupSummarizaitonCommand();
	}

	async activateView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_GEMINI);

		if (leaves.length > 0) {
			// A leaf with our view already exists, use that
			leaf = leaves[0];
			await workspace.revealLeaf(leaf);
		} else {
			// Our view could not be found in the workspace, create a new leaf
			// in the right sidebar for it
			leaf = workspace.getLeftLeaf(false);
			if (leaf) {
				await leaf.setViewState({ type: VIEW_TYPE_GEMINI, active: true });
				// "Reveal" the leaf in case it is in a collapsed sidebar
				await workspace.revealLeaf(leaf);
			} else {
				console.error('Could not find a leaf to open the view');
			}
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
				console.error('Could not find a leaf to open the agent view');
			}
		}
	}

	async onLayoutReady() {
		// Setup prompts directory and commands after layout is ready
		if (this.settings.enableCustomPrompts && this.promptManager) {
			await this.promptManager.ensurePromptsDirectory();
			await this.promptManager.createDefaultPrompts();
			// Setup prompt commands
			this.promptManager.setupPromptCommands();
		}
		
		await this.history.onLayoutReady();
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
			console.log('ObsidianGemini: Updating model versions in settings...');
			changedSettingsInfo.forEach((info) => console.log(`- ${info}`));
			await this.saveData(this.settings);
			new Notice('Gemini model settings updated to current defaults.');
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
		await this.setupGeminiScribe();

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
						console.log('Model settings updated:', result.changedSettingsInfo.join(', '));
					}
				}

				// Update last update time
				this.settings.modelDiscovery.lastUpdate = now;
				await this.saveData(this.settings);
			} catch (error) {
				console.warn('Failed to update models during auto-update:', error);
			}
		}
	}

	/**
	 * Get the model manager instance
	 */
	getModelManager(): ModelManager {
		return this.modelManager;
	}

	// Optional: Clean up ribbon icon on unload
	onunload() {
		console.debug('Unloading Gemini Scribe');
		this.history?.onUnload();
		this.ribbonIcon?.remove();
	}
}
