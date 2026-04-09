import { ItemView, WorkspaceLeaf, TFile, Notice } from 'obsidian';
import { ChatSession, SessionModelConfig } from '../../types/agent';
import { GeminiConversationEntry } from '../../types/conversation';
import type ObsidianGemini from '../../main';
import { HandlerPriority } from '../../types/agent-events';

// Import all component modules
import { AgentViewProgress } from './agent-view-progress';
import { shouldExcludePathForPlugin } from '../../utils/file-utils';
import { AgentViewMessages } from './agent-view-messages';
import { AgentViewContext } from './agent-view-context';
import { AgentViewSession, SessionUICallbacks, SessionState } from './agent-view-session';
import { AgentViewTools, AgentViewContext as ToolsContext } from './agent-view-tools';
import { AgentViewUI, UICallbacks } from './agent-view-ui';
import { InlineAttachment } from './inline-attachment';
import { AgentViewShelf } from './agent-view-shelf';
import { AgentViewSend } from './agent-view-send';
import { AgentViewAttachments } from './agent-view-attachments';
import { ProjectPickerModal } from './project-picker-modal';

// Import modals from agent-view directory
import { FilePickerModal } from './file-picker-modal';
import { SessionListModal } from './session-list-modal';
import { SkillMentionModal } from './skill-mention-modal';
import { SessionSettingsModal } from './session-settings-modal';
import { moveCursorToEnd } from '../../utils/dom-context';

export const VIEW_TYPE_AGENT = 'gemini-agent-view';

/**
 * AgentView is the main coordinator for the Agent Mode interface.
 * It delegates functionality to specialized components and manages their interactions.
 */
export class AgentView extends ItemView {
	private plugin: InstanceType<typeof ObsidianGemini>;

	// UI components
	private progress: AgentViewProgress;
	private messages!: AgentViewMessages;
	private context: AgentViewContext;
	private session!: AgentViewSession;
	private tools!: AgentViewTools;
	private ui: AgentViewUI;
	private send!: AgentViewSend;
	private attachments!: AgentViewAttachments;

	// UI element references
	private chatContainer!: HTMLElement;
	private userInput!: HTMLDivElement;
	private sendButton!: HTMLButtonElement;
	private sessionHeader!: HTMLElement;

	// State
	private currentSession: ChatSession | null = null;
	private eventBusUnsubscribers: (() => void)[] = [];
	private allowedWithoutConfirmation: Set<string> = new Set(); // Session-level allowed tools
	private shelf!: AgentViewShelf;
	private tokenUsageContainer!: HTMLElement;

	constructor(leaf: WorkspaceLeaf, plugin: InstanceType<typeof ObsidianGemini>) {
		super(leaf);
		this.plugin = plugin;

		// Initialize components (actual UI setup happens in onOpen)
		this.progress = new AgentViewProgress(this.app, this);
		this.context = new AgentViewContext();
		this.ui = new AgentViewUI(this.app, this.plugin);
	}

	getViewType(): string {
		return VIEW_TYPE_AGENT;
	}

	getDisplayText(): string {
		return 'Agent Mode';
	}

	getIcon(): string {
		return 'sparkles';
	}

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('gemini-agent-container');

		await this.createAgentInterface(container as HTMLElement);

		// Register link click handler for internal links
		this.registerLinkClickHandler();

		// Create default agent session
		await this.createNewSession();
	}

	private async createAgentInterface(container: HTMLElement) {
		// Reuse getUICallbacks() to avoid maintaining a duplicate literal.
		// The arrow-function closures capture `this`, so this.send / this.attachments
		// resolve correctly when the callbacks are eventually invoked (after init below).
		const callbacks = this.getUICallbacks();

		// Create the main interface using AgentViewUI
		const elements = this.ui.createAgentInterface(container, this.currentSession, callbacks);

		// Store element references
		this.sessionHeader = elements.sessionHeader;
		this.chatContainer = elements.chatContainer;
		this.userInput = elements.userInput;
		this.sendButton = elements.sendButton;
		this.tokenUsageContainer = elements.tokenUsageContainer;

		// Initialize the unified file shelf above the input row
		const shelfParent = elements.imagePreviewContainer.parentElement!;
		const inputRow = elements.userInput.parentElement!; // .gemini-agent-input-row
		elements.imagePreviewContainer.remove(); // Remove the old preview container
		this.shelf = new AgentViewShelf(
			this.app,
			shelfParent,
			{
				onRemoveTextFile: (file: TFile) => {
					this.context.removeContextFile(file, this.currentSession);
					this.updateSessionHeader();
					this.updateSessionMetadata();
				},
				onRemoveFolder: (files: TFile[]) => {
					for (const file of files) {
						this.context.removeContextFile(file, this.currentSession);
					}
					this.updateSessionHeader();
					this.updateSessionMetadata();
				},
				onRemoveAttachment: () => {
					// Shelf handles its own state; nothing else to sync
				},
			},
			inputRow,
			(path) => shouldExcludePathForPlugin(path, this.plugin)
		);

		// Initialize progress bar with the created elements
		this.progress.createProgressBar(elements.progressContainer);

		// Initialize file chips component

		// Initialize messages component
		this.messages = new AgentViewMessages(
			this.app,
			this.chatContainer,
			this.plugin,
			this.userInput,
			this // View context for MarkdownRenderer
		);

		// Initialize tools component with context
		this.tools = new AgentViewTools(this.chatContainer, this.plugin, this.createToolsContext());

		// Initialize session component with callbacks and state
		const sessionCallbacks: SessionUICallbacks = {
			clearChat: () => this.chatContainer.empty(),
			displayMessage: (entry: GeminiConversationEntry) => this.displayMessage(entry),
			updateSessionHeader: () => this.updateSessionHeader(),
			updateContextPanel: () => this.updateContextPanel(),
			showEmptyState: () => this.showEmptyState(),
			focusInput: () => this.userInput.focus(),
		};

		// Create session state with direct callback references to context
		const sessionState: SessionState = {
			allowedWithoutConfirmation: this.allowedWithoutConfirmation,
			userInput: this.userInput,
		};

		this.session = new AgentViewSession(this.app, this.plugin, sessionCallbacks, sessionState);

		// Initialize attachments component
		this.attachments = new AgentViewAttachments({
			plugin: this.plugin,
			app: this.app,
			getCurrentSession: () => this.currentSession,
			getShelf: () => this.shelf,
			getUserInput: () => this.userInput,
			context: this.context,
			updateSessionHeader: () => this.updateSessionHeader(),
			updateSessionMetadata: () => this.updateSessionMetadata(),
		});

		// Initialize send component
		this.send = new AgentViewSend({
			plugin: this.plugin,
			app: this.app,
			getCurrentSession: () => this.currentSession,
			getShelf: () => this.shelf,
			getUserInput: () => this.userInput,
			getSendButton: () => this.sendButton,
			getChatContainer: () => this.chatContainer,
			progress: this.progress,
			messages: this.messages,
			tools: this.tools,
			session: this.session,
			displayMessage: (entry: GeminiConversationEntry) => this.displayMessage(entry),
			updateTokenUsage: () => this.updateTokenUsage(),
			isToolAllowedWithoutConfirmation: (toolName: string) => this.isToolAllowedWithoutConfirmation(toolName),
			allowToolWithoutConfirmation: (toolName: string) => this.allowToolWithoutConfirmation(toolName),
			showConfirmationInChat: (tool, parameters, executionId, diffContext) =>
				this.showConfirmationInChat(tool, parameters, executionId, diffContext),
		});

		// Register session lifecycle event bus subscribers for token display
		const createdUnsub = this.plugin.agentEventBus?.on(
			'sessionCreated',
			async () => {
				await this.updateTokenUsage();
			},
			HandlerPriority.NORMAL
		);
		if (createdUnsub) this.eventBusUnsubscribers.push(createdUnsub);

		const loadedUnsub = this.plugin.agentEventBus?.on(
			'sessionLoaded',
			async () => {
				await this.refreshTokenUsageFromHistory();
			},
			HandlerPriority.NORMAL
		);
		if (loadedUnsub) this.eventBusUnsubscribers.push(loadedUnsub);

		// Create the header and context panel
		this.ui.createCompactHeader(this.sessionHeader, this.currentSession, callbacks);

		// Show empty state initially
		await this.showEmptyState();
	}

	/**
	 * Display a message in the chat (delegates to messages component)
	 */
	private async displayMessage(entry: GeminiConversationEntry) {
		await this.messages.displayMessage(entry, this.currentSession);
	}

	/**
	 * Show empty state (delegates to messages component)
	 */
	private async showEmptyState() {
		await this.messages.showEmptyState(
			this.currentSession,
			(session) => this.loadSession(session),
			() => this.send.sendMessage()
		);
	}

	/**
	 * Update context panel UI and sync shelf with session context
	 */
	private updateContextPanel() {
		// Sync shelf with current session's context files
		if (this.currentSession) {
			this.shelf.loadFromSession(this.currentSession.context.contextFiles);
		} else {
			this.shelf.clear();
		}
	}

	/**
	 * Update session header UI
	 */
	private updateSessionHeader() {
		this.ui.createCompactHeader(this.sessionHeader, this.currentSession, this.getUICallbacks());
	}

	/**
	 * Remove a file from context
	 */
	private removeContextFile(file: TFile) {
		this.context.removeContextFile(file, this.currentSession);
		this.updateSessionHeader();
	}

	/**
	 * Show file picker modal
	 */
	private async showFilePicker() {
		if (!this.currentSession) return;
		const session = this.currentSession;
		const initialFiles = [...session.context.contextFiles];

		const modal = new FilePickerModal(
			this.app,
			(newFiles: TFile[]) => {
				const newSet = new Set(newFiles);
				const oldSet = new Set(initialFiles);
				// Remove files no longer selected
				initialFiles
					.filter((f) => !newSet.has(f))
					.forEach((f) => {
						this.context.removeContextFile(f, session);
						const shelfItems = this.shelf.getItems();
						const match = shelfItems.find((item) => item.type === 'text' && item.path === f.path);
						if (match) this.shelf.removeItem(match.id);
					});
				// Add newly selected files
				newFiles
					.filter((f) => !oldSet.has(f))
					.forEach((f) => {
						this.context.addFileToContext(f, session);
						this.shelf.addTextFile(f);
					});
				this.updateSessionHeader();
			},
			this.plugin,
			initialFiles
		);
		modal.open();
	}

	/**
	 * Show skill picker modal for / slash commands
	 */
	private async showSkillPicker() {
		const summaries = await this.plugin.skillManager.getSkillSummaries();
		if (summaries.length === 0) {
			new Notice('No skills available');
			return;
		}
		const modal = new SkillMentionModal(
			this.app,
			(skill) => {
				this.attachments.removeTrailingTriggerChar('/');
				if (this.userInput) {
					this.userInput.innerText = `Use the "${skill.name}" skill to help me with: `;
					moveCursorToEnd(this.userInput);
				}
			},
			summaries
		);
		modal.open();
	}

	/**
	 * Show session list modal
	 */
	private async showSessionList() {
		const modal = new SessionListModal(
			this.app,
			this.plugin,
			{
				onSelect: async (session: ChatSession) => {
					await this.loadSession(session);
				},
				onDelete: (session: ChatSession) => {
					// If the deleted session is the current one, create a new session
					if (this.currentSession && this.currentSession.id === session.id) {
						this.createNewSession();
					}
				},
			},
			this.currentSession?.id || null
		);
		modal.open();
	}

	/**
	 * Show session settings modal
	 */
	private async showSessionSettings() {
		if (!this.currentSession) {
			new Notice('No active session');
			return;
		}

		const modal = new SessionSettingsModal(
			this.app,
			this.plugin,
			this.currentSession,
			async (config: SessionModelConfig) => {
				// Update current session's model config with new settings
				if (this.currentSession) {
					this.currentSession.modelConfig = config;
					await this.updateSessionMetadata();
					this.updateSessionHeader();
				}
			}
		);
		modal.open();
	}

	/**
	 * Create a new agent session (delegates to session component)
	 */
	private async createNewSession() {
		await this.session.createNewSession();
		this.currentSession = this.session.getCurrentSession();
		// Re-render header now that currentSession is updated — the header
		// rendered inside createNewSession() used the stale reference.
		this.updateSessionHeader();
		// Emit after this.currentSession is updated so subscribers see the correct session
		if (this.currentSession) {
			await this.plugin.agentEventBus?.emit('sessionCreated', { session: this.currentSession });
		}
	}

	/**
	 * Load an existing session (delegates to session component)
	 */
	async loadSession(session: ChatSession) {
		await this.session.loadSession(session);
		this.currentSession = this.session.getCurrentSession();
		this.updateSessionHeader();
		// Emit after this.currentSession is updated so subscribers see the correct session
		if (this.currentSession) {
			await this.plugin.agentEventBus?.emit('sessionLoaded', { session: this.currentSession });
		}
	}

	/**
	 * Open the project picker and switch the current session's project
	 */
	private switchProject() {
		if (!this.currentSession) return;

		const modal = new ProjectPickerModal(
			this.app,
			this.plugin,
			{
				onSelect: async (project) => {
					if (!this.currentSession) return;

					const previousProjectPath = this.currentSession.projectPath;
					this.currentSession.projectPath = project?.filePath ?? undefined;

					try {
						await this.plugin.sessionHistory.updateSessionMetadata(this.currentSession);
						this.updateSessionHeader();
						this.plugin.logger.log(`Switched project to: ${project?.name ?? 'none'}`);
					} catch (error) {
						// Rollback on persistence failure
						this.currentSession.projectPath = previousProjectPath;
						this.updateSessionHeader();
						this.plugin.logger.error('Failed to persist project change:', error);
					}
				},
			},
			this.currentSession.projectPath ?? null
		);
		modal.open();
	}

	/**
	 * Check if a session is the current session
	 * Compares both session ID and history path for robustness
	 */
	private isCurrentSession(session: ChatSession): boolean {
		if (!this.currentSession) return false;
		return session.id === this.currentSession.id || session.historyPath === this.currentSession.historyPath;
	}

	/**
	 * Update session metadata
	 */
	private async updateSessionMetadata() {
		await this.session.updateSessionMetadata();
	}

	/**
	 * Get current session for tool execution
	 */
	getCurrentSessionForToolExecution(): ChatSession | null {
		return this.currentSession;
	}

	/**
	 * Add a context file to the shelf (called by tools that auto-add files, e.g. write_file).
	 */
	addContextFileToShelf(file: TFile): void {
		this.shelf.addTextFile(file);
	}

	/**
	 * Check if a tool is allowed without confirmation (permission system)
	 */
	isToolAllowedWithoutConfirmation(toolName: string): boolean {
		return this.allowedWithoutConfirmation.has(toolName);
	}

	/**
	 * Allow a tool to run without confirmation for this session
	 */
	allowToolWithoutConfirmation(toolName: string) {
		this.allowedWithoutConfirmation.add(toolName);
	}

	/**
	 * Show confirmation request in chat with interactive buttons
	 * Returns Promise that resolves when user clicks a button
	 */
	public async showConfirmationInChat(
		tool: any,
		parameters: any,
		executionId: string,
		diffContext?: import('../../tools/types').DiffContext
	): Promise<import('../../tools/types').ConfirmationResult> {
		// Delegate to messages component
		return this.messages.displayConfirmationRequest(tool, parameters, executionId, diffContext);
	}

	/**
	 * Register link click handler for internal Obsidian links
	 */
	private registerLinkClickHandler() {
		this.registerDomEvent(this.chatContainer, 'click', (evt: MouseEvent) => {
			const target = evt.target as HTMLElement;
			if (target.tagName === 'A' && target.hasClass('internal-link')) {
				evt.preventDefault();
				const href = target.getAttribute('href');
				if (href) {
					this.app.workspace.openLinkText(href, '', false);
				}
			}
		});
	}

	/**
	 * Get UI callbacks for components
	 */
	private getUICallbacks(): UICallbacks {
		return {
			showFilePicker: () => this.showFilePicker(),
			showFileMention: () => this.attachments.showFileMention(),
			showSkillPicker: () => this.showSkillPicker(),
			showSessionList: () => this.showSessionList(),
			showSessionSettings: () => this.showSessionSettings(),
			createNewSession: () => this.createNewSession(),
			sendMessage: () => this.send.sendMessage(),
			stopAgentLoop: () => this.send.stopAgentLoop(),
			removeContextFile: (file: TFile) => this.removeContextFile(file),
			updateSessionHeader: () => this.updateSessionHeader(),
			updateSessionMetadata: () => this.updateSessionMetadata(),
			loadSession: (session: ChatSession) => this.loadSession(session),
			isCurrentSession: (session: ChatSession) => this.isCurrentSession(session),
			addAttachment: (attachment: InlineAttachment) => this.attachments.addAttachment(attachment),
			removeAttachment: (id: string) => this.attachments.removeAttachment(id),
			getAttachments: () => this.shelf?.getPendingAttachments() || [],
			handleDroppedFiles: (files: TFile[]) => this.attachments.handleDroppedFiles(files),
			switchProject: () => this.switchProject(),
		};
	}

	/**
	 * Build the context object required by AgentViewTools.
	 * Shared between createAgentInterface() and ensureToolsInitialized().
	 */
	private createToolsContext(): ToolsContext {
		return {
			getCurrentSession: () => this.currentSession,
			isCancellationRequested: () => this.send?.isCancellationRequested() ?? false,
			updateProgress: (statusText: string, state?: 'thinking' | 'tool' | 'waiting' | 'streaming') =>
				this.progress.update(statusText, state),
			hideProgress: () => this.progress.hide(),
			displayMessage: (entry: GeminiConversationEntry) => this.displayMessage(entry),
			incrementToolCallCount: (count: number) => {
				this.send?.incrementToolCallCount(count);
			},
		};
	}

	/**
	 * Public method to show tool execution (delegates to tools component)
	 * Used by tests and external components
	 */
	async showToolExecution(toolName: string, parameters: any, executionId?: string): Promise<void> {
		// Lazy initialization for tests that don't call onOpen()
		if (!this.tools) {
			this.ensureToolsInitialized();
		}
		return this.tools.showToolExecution(toolName, parameters, executionId);
	}

	/**
	 * Public method to show tool result (delegates to tools component)
	 * Used by tests and external components
	 */
	async showToolResult(toolName: string, result: any, executionId?: string): Promise<void> {
		// Lazy initialization for tests that don't call onOpen()
		if (!this.tools) {
			this.ensureToolsInitialized();
		}
		return this.tools.showToolResult(toolName, result, executionId);
	}

	/**
	 * Ensure tools component is initialized (for lazy initialization in tests)
	 */
	private ensureToolsInitialized(): void {
		if (this.tools) return;

		if (!this.chatContainer) {
			throw new Error('Cannot initialize tools component: chatContainer is not set');
		}

		this.tools = new AgentViewTools(this.chatContainer, this.plugin, this.createToolsContext());
	}

	/**
	 * Updates the token usage display if the setting is enabled.
	 * Uses cached usageMetadata from the latest API response for fast, reliable updates.
	 * Falls back to countTokens API if no cached metadata is available.
	 */
	private async updateTokenUsage(): Promise<void> {
		if (!this.plugin.contextManager || !this.plugin.settings.showTokenUsage || !this.tokenUsageContainer) {
			if (this.tokenUsageContainer) {
				this.tokenUsageContainer.style.display = 'none';
			}
			return;
		}

		try {
			const modelName = this.currentSession?.modelConfig?.model || this.plugin.settings.chatModelName;
			let usage = await this.plugin.contextManager.getTokenUsage(modelName);

			// If no cached data, try counting from conversation history as fallback
			if (usage.estimatedTokens === 0 && this.currentSession) {
				const conversationHistory = await this.plugin.sessionHistory.getHistoryForSession(this.currentSession);
				if (conversationHistory && conversationHistory.length > 0) {
					this.plugin.logger.debug('[AgentView] No cached token usage, falling back to countTokens API');
					const tokenCount = await this.plugin.contextManager.countTokens(modelName, conversationHistory);
					if (tokenCount > 0) {
						this.plugin.contextManager.setUsageMetadata({
							promptTokenCount: tokenCount,
							totalTokenCount: tokenCount,
						});
						usage = await this.plugin.contextManager.getTokenUsage(modelName);
					}
				}
			}

			// Still no data (e.g., new session with no messages)
			if (usage.estimatedTokens === 0) {
				this.tokenUsageContainer.style.display = 'none';
				return;
			}

			this.tokenUsageContainer.style.display = '';
			this.tokenUsageContainer.empty();

			const tokenText = this.tokenUsageContainer.createSpan({ cls: 'gemini-agent-token-text' });
			const uncached = usage.estimatedTokens - usage.cachedTokens;
			if (usage.cachedTokens > 0) {
				tokenText.textContent = `Tokens: ~${usage.estimatedTokens.toLocaleString()} (${uncached.toLocaleString()} new) / ${usage.inputTokenLimit.toLocaleString()} (${usage.percentUsed}%)`;
			} else {
				tokenText.textContent = `Tokens: ~${usage.estimatedTokens.toLocaleString()} / ${usage.inputTokenLimit.toLocaleString()} (${usage.percentUsed}%)`;
			}

			// Add warning class if approaching threshold
			const threshold = this.plugin.settings.contextCompactionThreshold;
			if (usage.percentUsed >= threshold) {
				this.tokenUsageContainer.addClass('gemini-agent-token-usage-warning');
				this.tokenUsageContainer.removeClass('gemini-agent-token-usage-caution');
			} else if (usage.percentUsed >= threshold * 0.8) {
				this.tokenUsageContainer.addClass('gemini-agent-token-usage-caution');
				this.tokenUsageContainer.removeClass('gemini-agent-token-usage-warning');
			} else {
				this.tokenUsageContainer.removeClass('gemini-agent-token-usage-warning');
				this.tokenUsageContainer.removeClass('gemini-agent-token-usage-caution');
			}
		} catch (error) {
			this.plugin.logger.debug('[AgentView] Failed to update token usage:', error);
		}
	}

	/**
	 * Refreshes token usage by counting tokens from the stored session history.
	 * Used when loading/switching sessions where we don't have cached API metadata.
	 */
	private async refreshTokenUsageFromHistory(): Promise<void> {
		if (!this.plugin.contextManager || !this.plugin.settings.showTokenUsage || !this.currentSession) {
			await this.updateTokenUsage();
			return;
		}

		try {
			const modelName = this.currentSession?.modelConfig?.model || this.plugin.settings.chatModelName;
			const conversationHistory = await this.plugin.sessionHistory.getHistoryForSession(this.currentSession);
			if (conversationHistory && conversationHistory.length > 0) {
				const tokenCount = await this.plugin.contextManager.countTokens(modelName, conversationHistory);
				if (tokenCount > 0) {
					this.plugin.contextManager.setUsageMetadata({
						promptTokenCount: tokenCount,
						totalTokenCount: tokenCount,
					});
				}
			}
		} catch (error) {
			this.plugin.logger.debug('[AgentView] Failed to refresh token usage from history:', error);
		}

		await this.updateTokenUsage();
	}

	async onClose() {
		// Cancel any in-flight execution before tearing down the view
		this.send?.stopAgentLoop();

		// Cleanup event bus subscriptions
		this.session?.destroy();
		for (const unsub of this.eventBusUnsubscribers) {
			unsub();
		}
		this.eventBusUnsubscribers = [];

		// Cleanup components
		if (this.messages) {
			this.messages.cleanup();
		}
		if (this.progress) {
			this.progress.hide();
		}
	}
}
