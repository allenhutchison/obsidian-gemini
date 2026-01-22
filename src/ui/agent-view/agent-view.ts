import { ItemView, WorkspaceLeaf, TFile, Notice, TFolder, setIcon } from 'obsidian';
import { ChatSession, SessionModelConfig } from '../../types/agent';
import { GeminiConversationEntry } from '../../types/conversation';
import type ObsidianGemini from '../../main';
import { ToolExecutionContext } from '../../tools/types';
import { ExtendedModelRequest } from '../../api/interfaces/model-api';
import { CustomPrompt } from '../../prompts/types';
import { AgentFactory } from '../../agent/agent-factory';
import { getErrorMessage } from '../../utils/error-utils';

// Import all component modules
import { AgentViewProgress } from './agent-view-progress';
import { AgentViewFileChips } from './agent-view-file-chips';
import { AgentViewMessages } from './agent-view-messages';
import { AgentViewContext } from './agent-view-context';
import { AgentViewSession, SessionUICallbacks, SessionState } from './agent-view-session';
import { AgentViewTools, AgentViewContext as ToolsContext } from './agent-view-tools';
import { AgentViewUI, UICallbacks } from './agent-view-ui';
import { ImageAttachment } from './image-attachment';

// Import modals from agent-view directory
import { FilePickerModal } from './file-picker-modal';
import { SessionListModal } from './session-list-modal';
import { FileMentionModal } from './file-mention-modal';
import { SessionSettingsModal } from './session-settings-modal';

export const VIEW_TYPE_AGENT = 'gemini-agent-view';

// Progress bar text truncation constants
const PROGRESS_THOUGHT_MAX_LENGTH = 150;
const PROGRESS_THOUGHT_DISPLAY_LENGTH = 147; // Leave room for "..."

/**
 * AgentView is the main coordinator for the Agent Mode interface.
 * It delegates functionality to specialized components and manages their interactions.
 */
export class AgentView extends ItemView {
	private plugin: InstanceType<typeof ObsidianGemini>;

	// UI components
	private progress: AgentViewProgress;
	private fileChips: AgentViewFileChips;
	private messages: AgentViewMessages;
	private context: AgentViewContext;
	private session: AgentViewSession;
	private tools: AgentViewTools;
	private ui: AgentViewUI;

	// UI element references
	private chatContainer: HTMLElement;
	private userInput: HTMLDivElement;
	private sendButton: HTMLButtonElement;
	private contextPanel: HTMLElement;
	private sessionHeader: HTMLElement;

	// State
	private currentSession: ChatSession | null = null;
	private currentStreamingResponse: { cancel: () => void } | null = null;
	private isExecuting: boolean = false;
	private cancellationRequested: boolean = false;
	private allowedWithoutConfirmation: Set<string> = new Set(); // Session-level allowed tools
	private activeFileChangeHandler: () => void;
	private pendingImageAttachments: ImageAttachment[] = [];
	private imagePreviewContainer: HTMLElement;

	constructor(leaf: WorkspaceLeaf, plugin: InstanceType<typeof ObsidianGemini>) {
		super(leaf);
		this.plugin = plugin;

		// Initialize components (actual UI setup happens in onOpen)
		this.progress = new AgentViewProgress();
		this.context = new AgentViewContext(this.app, this.plugin);
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

		// Register active file change listener to update context panel and header
		this.activeFileChangeHandler = async () => {
			await this.context.addActiveFileToContext(this.currentSession);
			this.updateContextFilesList(this.contextPanel.querySelector('.gemini-agent-files-list') as HTMLElement);
			this.updateSessionHeader();
		};
		this.registerEvent(this.app.workspace.on('active-leaf-change', this.activeFileChangeHandler));

		// Create default agent session
		await this.createNewSession();
	}

	private async createAgentInterface(container: HTMLElement) {
		// Create UI callbacks for components
		const callbacks: UICallbacks = {
			showFilePicker: () => this.showFilePicker(),
			showFileMention: () => this.showFileMention(),
			showSessionList: () => this.showSessionList(),
			showSessionSettings: () => this.showSessionSettings(),
			createNewSession: () => this.createNewSession(),
			sendMessage: () => this.sendMessage(),
			stopAgentLoop: () => this.stopAgentLoop(),
			removeContextFile: (file: TFile) => this.removeContextFile(file),
			updateContextFilesList: (container: HTMLElement) => this.updateContextFilesList(container),
			updateSessionHeader: () => this.updateSessionHeader(),
			updateSessionMetadata: () => this.updateSessionMetadata(),
			loadSession: (session: ChatSession) => this.loadSession(session),
			isCurrentSession: (session: ChatSession) => this.isCurrentSession(session),
			addImageAttachment: (attachment: ImageAttachment) => this.addImageAttachment(attachment),
			removeImageAttachment: (id: string) => this.removeImageAttachment(id),
			getImageAttachments: () => this.pendingImageAttachments,
		};

		// Create the main interface using AgentViewUI
		const elements = this.ui.createAgentInterface(container, this.currentSession, callbacks);

		// Store element references
		this.sessionHeader = elements.sessionHeader;
		this.contextPanel = elements.contextPanel;
		this.chatContainer = elements.chatContainer;
		this.userInput = elements.userInput;
		this.sendButton = elements.sendButton;
		this.imagePreviewContainer = elements.imagePreviewContainer;

		// Initialize progress bar with the created elements
		this.progress.createProgressBar(elements.progressContainer);

		// Initialize file chips component
		this.fileChips = new AgentViewFileChips(this.app, this.userInput);

		// Initialize messages component
		this.messages = new AgentViewMessages(
			this.app,
			this.chatContainer,
			this.plugin,
			this.userInput,
			this // View context for MarkdownRenderer
		);

		// Initialize tools component with context
		const toolsContext: ToolsContext = {
			getCurrentSession: () => this.currentSession,
			isCancellationRequested: () => this.cancellationRequested,
			updateProgress: (statusText: string, state?: 'thinking' | 'tool' | 'waiting' | 'streaming') =>
				this.progress.update(statusText, state),
			hideProgress: () => this.progress.hide(),
			displayMessage: (entry: GeminiConversationEntry) => this.displayMessage(entry),
			autoLabelSessionIfNeeded: () => this.autoLabelSessionIfNeeded(),
		};
		this.tools = new AgentViewTools(this.app, this.chatContainer, this.plugin, toolsContext);

		// Initialize session component with callbacks and state
		const sessionCallbacks: SessionUICallbacks = {
			clearChat: () => this.chatContainer.empty(),
			displayMessage: (entry: GeminiConversationEntry) => this.displayMessage(entry),
			updateSessionHeader: () => this.updateSessionHeader(),
			updateContextPanel: () => this.updateContextPanel(),
			showEmptyState: () => this.showEmptyState(),
			addActiveFileToContext: () => this.context.addActiveFileToContext(this.currentSession),
			focusInput: () => this.userInput.focus(),
		};

		// Create session state with direct callback references to context
		const sessionState: SessionState = {
			mentionedFiles: this.fileChips.getMentionedFiles(),
			allowedWithoutConfirmation: this.allowedWithoutConfirmation,
			getAutoAddedActiveFile: () => this.context.getAutoAddedActiveFile(),
			clearAutoAddedActiveFile: () => this.context.clearAutoAddedActiveFile(),
			userInput: this.userInput,
		};

		this.session = new AgentViewSession(this.app, this.plugin, sessionCallbacks, sessionState);

		// Create the header and context panel
		this.ui.createCompactHeader(this.sessionHeader, this.contextPanel, this.currentSession, callbacks);
		this.ui.createContextPanel(this.contextPanel, this.currentSession, callbacks);

		// Show empty state initially
		await this.showEmptyState();
	}

	/**
	 * Main orchestration method for sending messages and handling tool calls
	 */
	private async sendMessage() {
		if (!this.currentSession) {
			new Notice('No active session');
			return;
		}

		const { text: message, files, formattedMessage } = this.fileChips.extractMessageContent();
		// Allow sending with only images (no text)
		if (!message && files.length === 0 && this.pendingImageAttachments.length === 0) return;

		// Capture pending images and clear them
		const imageAttachments = [...this.pendingImageAttachments];
		this.pendingImageAttachments = [];
		this.ui.updateImagePreview(this.imagePreviewContainer, [], (id) => this.removeImageAttachment(id));

		// Save images to vault and get their paths
		const savedImagePaths: string[] = [];
		for (const attachment of imageAttachments) {
			try {
				const { saveImageToVault } = await import('./image-attachment');
				const path = await saveImageToVault(this.app, attachment);
				attachment.vaultPath = path;
				savedImagePaths.push(path);
			} catch (err) {
				this.plugin.logger.error('Failed to save image to vault:', err);
			}
		}

		// Clear input and mentioned files
		this.userInput.innerHTML = '';
		this.fileChips.clearMentionedFiles();

		// Set execution state and change button to "Stop"
		this.isExecuting = true;
		this.cancellationRequested = false;
		this.sendButton.empty();
		setIcon(this.sendButton, 'square');
		this.sendButton.addClass('gemini-agent-stop-btn');
		this.sendButton.disabled = false; // Re-enable so user can click stop
		this.sendButton.setAttribute('aria-label', 'Stop agent execution');

		// Show progress bar
		this.progress.show('Thinking...', 'thinking');

		// Build message with image thumbnails for display (use wikilinks for saved images)
		let displayMessage = formattedMessage;
		if (savedImagePaths.length > 0) {
			const imageLinks = savedImagePaths.map((path) => `![[${path}]]`).join('\n');
			// Explicitly show the path context to ensure AI reliability (User preference: reliability > hidden)
			const contextNote = `\n> [!info] Image Source\n> ${savedImagePaths.map((p) => `\`${p}\``).join('\n> ')}`;
			displayMessage = displayMessage + '\n\n' + imageLinks + contextNote;
		}

		// Display user message with formatted version (includes markdown links and images)
		const userEntry: GeminiConversationEntry = {
			role: 'user',
			message: displayMessage, // Use formatted message with images for display
			notePath: '',
			created_at: new Date(),
		};
		await this.displayMessage(userEntry);

		try {
			// Start with session context files (active file is already included if present)
			const allContextFiles = [...this.currentSession.context.contextFiles];

			// Add mentioned files to context temporarily
			files.forEach((file) => {
				if (!allContextFiles.includes(file)) {
					allContextFiles.push(file);
				}
			});

			// Get conversation history
			const conversationHistory = await this.plugin.sessionHistory.getHistoryForSession(this.currentSession);

			// Build context for AI request including mentioned files
			const contextInfo = await this.plugin.gfile.buildFileContext(
				allContextFiles,
				true // renderContent
			);

			// Load custom prompt if session has one configured
			let customPrompt: CustomPrompt | undefined;
			if (this.currentSession?.modelConfig?.promptTemplate) {
				try {
					// Use the promptManager to robustly load the custom prompt
					const loadedPrompt = await this.plugin.promptManager.loadPromptFromFile(
						this.currentSession.modelConfig.promptTemplate
					);
					if (loadedPrompt) {
						customPrompt = loadedPrompt;
					} else {
						this.plugin.logger.warn(
							'Custom prompt file not found or failed to load:',
							this.currentSession.modelConfig.promptTemplate
						);
					}
				} catch (error) {
					this.plugin.logger.error('Error loading custom prompt:', error);
				}
			}

			// Build additional prompt instructions (not part of system prompt)
			let additionalInstructions = '';

			// Add mention note if files were mentioned
			if (files.length > 0) {
				const fileNames = files.map((f) => f.basename).join(', ');
				additionalInstructions += `\n\nIMPORTANT: The user has specifically referenced the following files using @ mentions: ${fileNames}
These files are included in the context below. When the user asks you to write data to or modify these files, you should:
1. First use the read_file tool to examine their current contents
2. Then use the write_file tool to update them with the new or modified content
3. If adding new data, integrate it appropriately with the existing content rather than creating a new file`;
			}

			// Add image path information if images were attached
			if (savedImagePaths.length > 0) {
				const pathList = savedImagePaths.map((p) => `- ${p}`).join('\n');
				additionalInstructions += `\n\nIMAGE ATTACHMENTS: The user has attached ${savedImagePaths.length} image(s) to this message. The images have been saved to the vault at these paths:
${pathList}
To embed any of these images in a note, use the wikilink format: ![[path/to/image.png]]
To reference an image in your response, use the path shown above.`;
			}

			// Add context information if available
			if (contextInfo) {
				additionalInstructions += `\n\n${contextInfo}`;
			}

			// Get available tools for this session
			const toolContext: ToolExecutionContext = {
				plugin: this.plugin,
				session: this.currentSession,
			};
			const availableTools = this.plugin.toolRegistry.getEnabledTools(toolContext);
			this.plugin.logger.log('Available tools from registry:', availableTools);
			this.plugin.logger.log('Number of tools:', availableTools.length);
			this.plugin.logger.log(
				'Tool names:',
				availableTools.map((t) => t.name)
			);

			try {
				// Get model config from session or use defaults
				const modelConfig = this.currentSession?.modelConfig || {};

				const request: ExtendedModelRequest = {
					userMessage: message,
					conversationHistory: conversationHistory,
					model: modelConfig.model || this.plugin.settings.chatModelName,
					temperature: modelConfig.temperature ?? this.plugin.settings.temperature,
					topP: modelConfig.topP ?? this.plugin.settings.topP,
					prompt: additionalInstructions, // Additional context and instructions
					customPrompt: customPrompt, // Custom prompt template (if configured)
					renderContent: false, // We already rendered content above
					availableTools: availableTools,
					imageAttachments: imageAttachments.map((a) => ({ base64: a.base64, mimeType: a.mimeType })),
				};

				// Create model API for this session
				const modelApi = AgentFactory.createAgentModel(this.plugin, this.currentSession!);

				// Check if streaming is supported and enabled
				if (modelApi.generateStreamingResponse && this.plugin.settings.streamingEnabled !== false) {
					// Use streaming API with tool support
					let modelMessageContainer: HTMLElement | null = null;
					let accumulatedMarkdown = '';
					let accumulatedThoughts = '';
					let progressUpdated = false;

					const streamResponse = modelApi.generateStreamingResponse(request, (chunk) => {
						// Handle thought content - show in progress bar
						if (chunk.thought) {
							const chunkPreview = chunk.thought.length > 100 ? chunk.thought.substring(0, 100) + '...' : chunk.thought;
							this.plugin.logger.debug(`[AgentView] Received thought chunk: ${chunkPreview}`);
							accumulatedThoughts += chunk.thought;

							// Store full thought as title for hover
							this.progress.setStatusTitle(accumulatedThoughts);

							// Truncate for display, showing the latest part
							const displayThought =
								accumulatedThoughts.length > PROGRESS_THOUGHT_MAX_LENGTH
									? '...' + accumulatedThoughts.slice(-PROGRESS_THOUGHT_DISPLAY_LENGTH)
									: accumulatedThoughts;
							const displayPreview =
								displayThought.length > 50 ? displayThought.substring(0, 50) + '...' : displayThought;
							this.plugin.logger.debug(`[AgentView] Updating progress with thought: ${displayPreview}`);
							this.progress.update(displayThought, 'thinking');
						}

						// Handle text content
						if (chunk.text) {
							accumulatedMarkdown += chunk.text;

							// Update progress to streaming state when first text chunk arrives
							if (!progressUpdated) {
								this.progress.update('Generating response...', 'streaming');
								progressUpdated = true;
							}

							// Create or update the model message container
							if (!modelMessageContainer) {
								// First chunk - create the container
								modelMessageContainer = this.messages.createStreamingMessageContainer('model');
								this.messages.updateStreamingMessage(modelMessageContainer, chunk.text);
							} else {
								// Update existing container with new chunk
								this.messages.updateStreamingMessage(modelMessageContainer, chunk.text);
								// Use debounced scroll to avoid stuttering
								this.messages.debouncedScrollToBottom();
							}
						}
					});

					// Store the streaming response for potential cancellation
					this.currentStreamingResponse = streamResponse;

					try {
						const response = await streamResponse.complete;
						this.currentStreamingResponse = null;

						// Check if the model requested tool calls
						if (response.toolCalls && response.toolCalls.length > 0) {
							// Save user message to history first
							if (this.plugin.settings.chatHistory) {
								await this.plugin.sessionHistory.addEntryToSession(this.currentSession, userEntry);
							}

							// If there was any streamed text before tool calls, finalize it
							if (modelMessageContainer && accumulatedMarkdown.trim()) {
								const aiEntry: GeminiConversationEntry = {
									role: 'model',
									message: accumulatedMarkdown,
									notePath: '',
									created_at: new Date(),
								};
								await this.messages.finalizeStreamingMessage(
									modelMessageContainer,
									accumulatedMarkdown,
									aiEntry,
									this.currentSession
								);

								// Save partial response to history before executing tools
								if (this.plugin.settings.chatHistory) {
									await this.plugin.sessionHistory.addEntryToSession(this.currentSession, aiEntry);
								}
							}

							// Execute tools and handle results
							await this.tools.handleToolCalls(
								response.toolCalls,
								message,
								conversationHistory,
								userEntry,
								customPrompt
							);
						} else {
							// Normal response without tool calls
							// Only finalize and save if response has content
							if (response.markdown && response.markdown.trim()) {
								const aiEntry: GeminiConversationEntry = {
									role: 'model',
									message: response.markdown,
									notePath: '',
									created_at: new Date(),
								};

								// Finalize the streaming message with proper rendering
								if (modelMessageContainer) {
									await this.messages.finalizeStreamingMessage(
										modelMessageContainer,
										response.markdown,
										aiEntry,
										this.currentSession
									);
								}

								// Save to history
								if (this.plugin.settings.chatHistory) {
									await this.plugin.sessionHistory.addEntryToSession(this.currentSession, userEntry);
									await this.plugin.sessionHistory.addEntryToSession(this.currentSession, aiEntry);

									// Auto-label session after first exchange
									await this.autoLabelSessionIfNeeded();
								}

								// Ensure we're scrolled to bottom after streaming completes
								this.messages.scrollToBottom();

								// Hide progress bar after successful response
								this.progress.hide();
							} else {
								// Empty response - might be thinking tokens
								this.plugin.logger.warn('Model returned empty response');
								new Notice(
									'Model returned an empty response. This might happen with thinking models. Try rephrasing your question.'
								);

								// Hide progress bar
								this.progress.hide();

								// Still save the user message to history
								if (this.plugin.settings.chatHistory) {
									await this.plugin.sessionHistory.addEntryToSession(this.currentSession, userEntry);
								}
							}
						}
					} catch (error) {
						this.currentStreamingResponse = null;
						// Hide progress bar on error
						this.progress.hide();
						throw error;
					}
				} else {
					// Fall back to non-streaming API
					this.plugin.logger.log('Agent view using non-streaming API');
					const response = await modelApi.generateModelResponse(request);

					// Update progress to show response received
					this.progress.update('Processing response...', 'waiting');

					// Check if the model requested tool calls
					if (response.toolCalls && response.toolCalls.length > 0) {
						// Execute tools and handle results
						await this.tools.handleToolCalls(response.toolCalls, message, conversationHistory, userEntry, customPrompt);
					} else {
						// Normal response without tool calls
						// Only display if response has content
						if (response.markdown && response.markdown.trim()) {
							// Display AI response
							const aiEntry: GeminiConversationEntry = {
								role: 'model',
								message: response.markdown,
								notePath: '',
								created_at: new Date(),
							};
							await this.displayMessage(aiEntry);

							// Save to history
							if (this.plugin.settings.chatHistory) {
								await this.plugin.sessionHistory.addEntryToSession(this.currentSession, userEntry);
								await this.plugin.sessionHistory.addEntryToSession(this.currentSession, aiEntry);

								// Auto-label session after first exchange
								await this.autoLabelSessionIfNeeded();
							}

							// Hide progress bar after successful response
							this.progress.hide();
						} else {
							// Empty response - might be thinking tokens
							this.plugin.logger.warn('Model returned empty response');
							new Notice(
								'Model returned an empty response. This might happen with thinking models. Try rephrasing your question.'
							);

							// Still save the user message to history
							if (this.plugin.settings.chatHistory) {
								await this.plugin.sessionHistory.addEntryToSession(this.currentSession, userEntry);
							}

							// Hide progress bar
							this.progress.hide();
						}
					}
				}
			} catch (error) {
				// Hide progress bar on error
				this.progress.hide();
				throw error;
			}
		} catch (error) {
			this.plugin.logger.error('Failed to send message:', error);
			const errorMessage = getErrorMessage(error);
			new Notice(errorMessage, 8000); // Show for 8 seconds to give user time to read
		} finally {
			// Reset execution state and button (unless already reset by stopAgentLoop)
			// The check prevents redundant resets if user clicked stop
			if (this.isExecuting) {
				this.resetExecutionUiState();
			}
		}
	}

	/**
	 * Stops the current agent execution loop
	 */
	private stopAgentLoop() {
		this.plugin.logger.debug('[AgentView] stopAgentLoop called');

		// Set cancellation flag
		this.cancellationRequested = true;

		// Cancel streaming response if active
		if (this.currentStreamingResponse) {
			this.plugin.logger.debug('[AgentView] Cancelling streaming response');
			this.currentStreamingResponse.cancel();
			this.currentStreamingResponse = null;
		}

		// Update UI immediately
		this.resetExecutionUiState();

		// Hide progress bar
		this.progress.hide();

		// Show cancellation notice
		new Notice('Agent execution cancelled');
	}

	/**
	 * Resets execution UI state after completion or cancellation
	 */
	private resetExecutionUiState() {
		this.isExecuting = false;
		// Note: Don't reset cancellationRequested here - it needs to stay true
		// so that tool loops can see it. It's reset in sendMessage() when starting
		// a new execution.
		this.sendButton.disabled = false;
		this.sendButton.empty();
		setIcon(this.sendButton, 'play');
		this.sendButton.removeClass('gemini-agent-stop-btn');
		this.sendButton.setAttribute('aria-label', 'Send message to agent');
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
			() => this.sendMessage()
		);
	}

	/**
	 * Update context panel UI
	 */
	private updateContextPanel() {
		this.ui.createContextPanel(this.contextPanel, this.currentSession, this.getUICallbacks());
	}

	/**
	 * Update session header UI
	 */
	private updateSessionHeader() {
		this.ui.createCompactHeader(this.sessionHeader, this.contextPanel, this.currentSession, this.getUICallbacks());
	}

	/**
	 * Update context files list display
	 */
	private updateContextFilesList(container: HTMLElement) {
		this.context.updateContextFilesList(container, this.currentSession, (file: TFile) => this.removeContextFile(file));
	}

	/**
	 * Remove a file from context
	 */
	private removeContextFile(file: TFile) {
		this.context.removeContextFile(file, this.currentSession);
		this.updateContextFilesList(this.contextPanel.querySelector('.gemini-agent-files-list') as HTMLElement);
		this.updateSessionHeader();
	}

	/**
	 * Show file picker modal
	 */
	private async showFilePicker() {
		if (!this.currentSession) return;

		const modal = new FilePickerModal(
			this.app,
			async (files: TFile[]) => {
				this.context.addFilesToContext(files, this.currentSession);
				this.updateContextFilesList(this.contextPanel.querySelector('.gemini-agent-files-list') as HTMLElement);
				this.updateSessionHeader();
			},
			this.plugin
		);
		modal.open();
	}

	/**
	 * Show file mention modal for @ mentions
	 */
	private async showFileMention() {
		const modal = new FileMentionModal(
			this.app,
			(fileOrFolder: TFile | TFolder) => {
				if (fileOrFolder instanceof TFile) {
					this.insertFileChip(fileOrFolder);
				} else if (fileOrFolder instanceof TFolder) {
					this.insertFolderChip(fileOrFolder);
				}
			},
			this.plugin
		);
		modal.open();
	}

	/**
	 * Insert a file chip at cursor position
	 */
	private insertFileChip(file: TFile) {
		const chip = this.fileChips.createFileChip(file, (removedFile: TFile) => {
			// Callback when chip is removed
		});
		this.fileChips.insertChipAtCursor(chip);
		this.fileChips.addMentionedFile(file);
	}

	/**
	 * Insert a folder chip at cursor position
	 */
	private insertFolderChip(folder: TFolder) {
		const files = this.fileChips.getFilesFromFolder(folder);
		const chip = this.fileChips.createFolderChip(folder, files.length, (removedFiles: TFile[]) => {
			// Callback when chip is removed
		});
		this.fileChips.insertChipAtCursor(chip);

		// Add all files from folder to mentioned files
		files.forEach((file) => this.fileChips.addMentionedFile(file));
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
	}

	/**
	 * Load an existing session (delegates to session component)
	 */
	private async loadSession(session: ChatSession) {
		await this.session.loadSession(session);
		this.currentSession = this.session.getCurrentSession();
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
	 * Auto-label session after first exchange
	 */
	private async autoLabelSessionIfNeeded() {
		await this.session.autoLabelSessionIfNeeded();
	}

	/**
	 * Get current session for tool execution
	 */
	getCurrentSessionForToolExecution(): ChatSession | null {
		return this.currentSession;
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
		executionId: string
	): Promise<{ confirmed: boolean; allowWithoutConfirmation: boolean }> {
		// Delegate to messages component
		return this.messages.displayConfirmationRequest(tool, parameters, executionId);
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
			showFileMention: () => this.showFileMention(),
			showSessionList: () => this.showSessionList(),
			showSessionSettings: () => this.showSessionSettings(),
			createNewSession: () => this.createNewSession(),
			sendMessage: () => this.sendMessage(),
			stopAgentLoop: () => this.stopAgentLoop(),
			removeContextFile: (file: TFile) => this.removeContextFile(file),
			updateContextFilesList: (container: HTMLElement) => this.updateContextFilesList(container),
			updateSessionHeader: () => this.updateSessionHeader(),
			updateSessionMetadata: () => this.updateSessionMetadata(),
			loadSession: (session: ChatSession) => this.loadSession(session),
			isCurrentSession: (session: ChatSession) => this.isCurrentSession(session),
			addImageAttachment: (attachment: ImageAttachment) => this.addImageAttachment(attachment),
			removeImageAttachment: (id: string) => this.removeImageAttachment(id),
			getImageAttachments: () => this.pendingImageAttachments,
		};
	}

	/**
	 * Add an image attachment to pending list
	 */
	private addImageAttachment(attachment: ImageAttachment): void {
		this.pendingImageAttachments.push(attachment);
		this.ui.updateImagePreview(this.imagePreviewContainer, this.pendingImageAttachments, (id) =>
			this.removeImageAttachment(id)
		);
	}

	/**
	 * Remove an image attachment from pending list
	 */
	private removeImageAttachment(id: string): void {
		this.pendingImageAttachments = this.pendingImageAttachments.filter((a) => a.id !== id);
		this.ui.updateImagePreview(this.imagePreviewContainer, this.pendingImageAttachments, (id) =>
			this.removeImageAttachment(id)
		);
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

		const toolsContext: ToolsContext = {
			getCurrentSession: () => this.currentSession,
			isCancellationRequested: () => this.cancellationRequested,
			updateProgress: (statusText: string, state?: 'thinking' | 'tool' | 'waiting' | 'streaming') =>
				this.progress.update(statusText, state),
			hideProgress: () => this.progress.hide(),
			displayMessage: (entry: GeminiConversationEntry) => this.displayMessage(entry),
			autoLabelSessionIfNeeded: () => this.autoLabelSessionIfNeeded(),
		};

		this.tools = new AgentViewTools(this.app, this.chatContainer, this.plugin, toolsContext);
	}

	async onClose() {
		// Cleanup components
		if (this.messages) {
			this.messages.cleanup();
		}
		if (this.progress) {
			this.progress.hide();
		}

		// Unregister event handlers
		this.app.workspace.off('active-leaf-change', this.activeFileChangeHandler);
	}
}
